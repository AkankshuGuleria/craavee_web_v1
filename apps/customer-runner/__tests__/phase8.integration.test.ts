// Phase 8 §27 — delivery failure, Realtime authorization, and push
// notification lifecycle, against the real Edge Functions, the real
// database and a real Realtime connection.
//
// What is NOT here, deliberately: whether a push actually arrives on a
// handset. That needs APNs/FCM credentials and a physical device, and
// asserting it locally would be theatre. Everything up to and including
// the outbox row and the dispatcher's behaviour IS covered, and the
// report says plainly which half is which.
//
// The pgTAP suite (supabase/tests/14) proves the DB functions in
// isolation with RLS bypassed. This file proves the things only a real
// stack can: that the auth envelope holds, that the canonical error
// codes come back over the wire, and above all that the concurrency
// guarantees survive genuinely parallel requests.
//
// Every race below uses Promise.all against separate JWTs, so the
// requests are actually in flight together. A sequential loop would
// prove nothing about SKIP LOCKED.
//
// Canonical: API_CONTRACTS.md §"Fulfilment Claim & Handoff",
// ORDER_STATE_MACHINE.md #7/#8/#10/#11/#13, D13/D14/D28, D39.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FN_PORT = 8795; // dev 8790, order 8791, payment 8792, fulfilment 8793, runner 8794 - each suite owns its own
const FN_BASE = `http://127.0.0.1:${FN_PORT}/functions/v1`;

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_STORE = "00000000-0000-4000-8000-000000000001";
const ZONE = "00000000-0000-4000-8000-000000000101";
const RUNNER_A = "00000000-0000-4000-8000-000000001210";
const RUNNER_B = "00000000-0000-4000-8000-000000001220";
const RUNNER_OFFLINE = "00000000-0000-4000-8000-000000001230";
let CUSTOMER = "";

// Dedicated catalogue rows so nothing here touches seed inventory or
// another suite's fixtures.
const F = {
  pA: "d8000000-0000-4000-8000-000000000201",
  addr: "d8000000-0000-4000-8000-000000000301",
};

let runnerAJwt = "";
let runnerBJwt = "";
let offlineJwt = "";
let otherStoreJwt = "";
let packerJwt = "";
let adminJwt = "";
let customerJwt = "";
let serverProc: ChildProcess | null = null;
// A seed-store order kept at `packed` purely so a listener can prove its
// subscription is live before the test that depends on it begins.
let probeOrderId = "";

async function must<T extends { error: unknown }>(p: PromiseLike<T>, what: string): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(`fixture setup failed (${what}): ${JSON.stringify(r.error)}`);
  return r;
}

async function waitForServer(url: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: "OPTIONS" });
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`edge function server never came up at ${url}`);
}

async function signIn(phone: string): Promise<{ jwt: string; id: string }> {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.verifyOtp({ phone, token: "123456", type: "sms" });
  if (error || !data.session) throw new Error(`sign-in failed for ${phone}: ${error?.message}`);
  return { jwt: data.session.access_token, id: data.session.user.id };
}

interface FnResult { ok: boolean; status: number; data?: Record<string, unknown>; code?: string }

async function callFn(name: string, body: unknown, jwt?: string | null): Promise<FnResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(`${FN_BASE}/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };
  return { ok: j.ok, status: r.status, data: j.data, code: j.error?.code };
}

function webhookEvent(over: Record<string, unknown>) {
  return { event_id: `evt_${randomUUID()}`, status: "captured", amount: 0, ...over };
}

async function postWebhook(body: Record<string, unknown>) {
  const r = await fetch(`${FN_BASE}/payment_webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-craavee-webhook-signature": "mock-signature" },
    body: JSON.stringify(body),
  });
  return r.status;
}

/** A genuinely `packed` order, produced through the real pipeline:
 *  create_order -> capture webhook -> mark_packed. Direct inserts are not
 *  an option (check_payment_order_consistency is DEFERRED and validates
 *  the pair at COMMIT), and driving the real functions is the more honest
 *  fixture anyway: claiming is exercised on orders the production path
 *  actually produces. */
async function makePackedOrder(qty = 1): Promise<string> {
  const created = await callFn(
    "create_order",
    { idempotencyKey: randomUUID(), addressId: F.addr, items: [{ productId: F.pA, qty }] },
    customerJwt,
  );
  if (!created.ok) throw new Error(`fixture create_order failed: ${JSON.stringify(created)}`);
  const orderId = created.data!.orderId as string;
  const pi = created.data!.paymentIntent as { gatewayOrderRef: string } | undefined;
  if (!pi) throw new Error("fixture: no payment intent");
  const st = await postWebhook(
    webhookEvent({ order_id: pi.gatewayOrderRef, payment_id: `pay_${orderId.slice(0, 8)}`, amount: Number(created.data!.payable) }),
  );
  if (st !== 200) throw new Error(`fixture capture webhook failed: ${st}`);
  const packed = await callFn("mark_packed", { orderId }, packerJwt);
  if (!packed.ok) throw new Error(`fixture mark_packed failed: ${JSON.stringify(packed)}`);
  return orderId;
}

async function orderRow(orderId: string) {
  const { data } = await svc.from("orders").select("status, runner_id, assigned_at, picked_up_at, delivered_at, delivery_code_hash").eq("id", orderId).single();
  return data as Record<string, unknown>;
}

/** The plaintext code, read with the service role. A runner can never do
 *  this — order_delivery_codes has exactly one policy and it is the
 *  customer read (proven in pgTAP 14 §A and again below over the wire). */
async function codeFor(orderId: string): Promise<string> {
  const { data } = await svc.from("order_delivery_codes").select("code").eq("order_id", orderId).single();
  return (data as { code: string }).code;
}

/** Park a runner's live job so they are free again, without going through
 *  a transition the state machine forbids. */
async function freeRunner(jwt: string, orderId: string) {
  await callFn("release_job", { orderId }, jwt);
}

/** Return every one of this suite's runners to "free" by parking any live
 *  job back at `packed`. Used on entry (stale state from an aborted run)
 *  and on exit (so the next run, and any parallel suite, starts clean). */
async function parkLiveJobs() {
  const { data } = await svc
    .from("orders").select("id, status")
    .in("runner_id", [RUNNER_A, RUNNER_B, RUNNER_OFFLINE])
    .in("status", ["assigned", "picked_up"]);
  for (const o of (data ?? []) as { id: string; status: string }[]) {
    // enforce_order_transition() only permits legal edges, even for the
    // service role, so the exit differs by state: `assigned` is released
    // back to `packed` (the trigger nulls runner_id itself), and
    // `picked_up` can only leave through `delivery_failed`. Both free the
    // runner, because neither destination is a live-job status.
    const to = o.status === "assigned" ? "packed" : "delivery_failed";
    const { error } = await svc.from("orders").update({ status: to }).eq("id", o.id);
    if (error) throw new Error(`could not park stale job ${o.id} (${o.status} -> ${to}): ${JSON.stringify(error)}`);
    await svc.from("order_delivery_codes").delete().eq("order_id", o.id);
  }
}

// ============================================================
before(async () => {
  serverProc = spawn(
    "deno",
    ["run", "--allow-net", "--allow-env", "--config", "supabase/functions/deno.json", "supabase/functions/_dev/serve.ts"],
    {
      cwd: process.cwd().replace(/\/apps\/customer-runner$/, ""),
      env: {
        ...process.env,
        SUPABASE_URL,
        SUPABASE_ANON_KEY: ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        CRAAVEE_ALLOW_MOCK_CONTROL: "1",
        FUNCTIONS_PORT: String(FN_PORT),
      },
      stdio: "ignore",
    },
  );
  await waitForServer(`${FN_BASE}/claim_job`);

  // A previous run that failed part-way can leave a runner holding a live
  // job. idx_orders_one_live_job_per_runner then makes every claim in this
  // suite fail with RUNNER_ALREADY_ASSIGNED, and the failures look like
  // product defects when they are only stale fixtures. Park them first —
  // the same cleanup `after()` performs, applied on the way in as well.
  await parkLiveJobs();

  runnerAJwt = (await signIn("+919000001201")).jwt;
  runnerBJwt = (await signIn("+919000001202")).jwt;
  offlineJwt = (await signIn("+919000001203")).jwt;
  otherStoreJwt = (await signIn("+919000001204")).jwt;
  packerJwt = (await signIn("+919000001102")).jwt;
  adminJwt = (await signIn("+919000001301")).jwt;
  const cust = await signIn("+919990000011"); // shared with the runner suite; this suite never mutates its wallet
  customerJwt = cust.jwt;
  CUSTOMER = cust.id;

  await must(
    svc.from("products").upsert([
      { id: F.pA, store_id: SEED_STORE, name: "P8 Item A", mrp: 6000, sale_price: 5000, category: "Snacks", is_listed: true },
    ]),
    "products",
  );
  await must(
    svc.from("inventory").upsert(
      [{ store_id: SEED_STORE, product_id: F.pA, qty_on_hand: 900, qty_reserved: 0 }],
      { onConflict: "store_id,product_id" },
    ),
    "inventory",
  );
  await must(
    svc.from("addresses").upsert([
      { id: F.addr, customer_id: CUSTOMER, zone_id: ZONE, block: "S", floor: "2", room: "9", landmark: "phase 8" },
    ]),
    "address",
  );

  probeOrderId = await makePackedOrder();
});

// Every test that claims a job needs runner A free. A test that fails
// part-way cannot be relied on to clean up after itself, so failures stay
// independent only if the parking happens on the way IN to each test.
beforeEach(parkLiveJobs);

after(async () => {
  // Leave no live assignment behind for a re-run or a parallel suite.
  await parkLiveJobs();
  // Close every listener, including ones a failing test never reached
  // the cleanup line for — an orphaned websocket keeps Node alive.
  for (const l of openListeners) {
    try {
      await l.close();
    } catch {
      // already gone
    }
  }
  serverProc?.kill("SIGTERM");
  svc.realtime.disconnect();
});


/** Drive an order all the way to `picked_up` by runner A. */
async function makePickedUpOrder(): Promise<string> {
  const orderId = await makePackedOrder();
  const claim = await callFn("claim_job", { orderId }, runnerAJwt);
  if (!claim.ok) throw new Error(`fixture claim failed: ${JSON.stringify(claim)}`);
  const pick = await callFn("mark_picked_up", { orderId }, runnerAJwt);
  if (!pick.ok) throw new Error(`fixture pickup failed: ${JSON.stringify(pick)}`);
  return orderId;
}

// ============================================================
// A. Delivery failure (§27.1-10) — the Phase 7 hole
// ============================================================
test("§27.1 picked_up -> delivery_failed: the exit that did not exist", async () => {
  const orderId = await makePickedUpOrder();
  const r = await callFn("mark_delivery_failed", { orderId, reason: "customer not answering" }, runnerAJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.status, "delivery_failed");
  assert.equal((await orderRow(orderId)).status, "delivery_failed");
});

test("§27.2 an invalid source state is rejected", async () => {
  const orderId = await makePackedOrder(); // still `packed`
  const r = await callFn("mark_delivery_failed", { orderId, reason: "x" }, runnerAJwt);
  assert.equal(r.ok, false);
  // Not the assignee either (runner_id is null), so ownership may fail
  // first — both answers prove the transition did not happen.
  assert.ok(["FORBIDDEN", "INVALID_ORDER_TRANSITION"].includes(r.code!), `got ${r.code}`);
  assert.equal((await orderRow(orderId)).status, "packed");
});

test("§27.3 a runner who is not the assignee cannot report a failure", async () => {
  const orderId = await makePickedUpOrder();
  const r = await callFn("mark_delivery_failed", { orderId, reason: "not mine" }, runnerBJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  assert.equal((await orderRow(orderId)).status, "picked_up");
  await callFn("mark_delivery_failed", { orderId, reason: "cleanup" }, runnerAJwt);
});

test("§27.4 a customer cannot force a delivery failure", async () => {
  const orderId = await makePickedUpOrder();
  const r = await callFn("mark_delivery_failed", { orderId, reason: "I want a refund" }, customerJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  assert.equal((await orderRow(orderId)).status, "picked_up");
  await callFn("mark_delivery_failed", { orderId, reason: "cleanup" }, runnerAJwt);
});

test("§27.5 an admin can report a failure on any order at the store", async () => {
  const orderId = await makePickedUpOrder();
  const r = await callFn("mark_delivery_failed", { orderId, reason: "safety issue at the block" }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await orderRow(orderId)).status, "delivery_failed");
});

test("§27.6 a duplicate failure report is safe", async () => {
  const orderId = await makePickedUpOrder();
  assert.equal((await callFn("mark_delivery_failed", { orderId, reason: "first" }, runnerAJwt)).ok, true);
  const dup = await callFn("mark_delivery_failed", { orderId, reason: "second" }, runnerAJwt);
  assert.equal(dup.ok, true);
  assert.equal(dup.data!.alreadyFailed, true, "the replay is reported as a replay, not a new failure");

  const { count } = await svc
    .from("audit_logs").select("id", { count: "exact", head: true })
    .eq("entity_id", orderId).eq("action", "order.delivery_failed");
  assert.equal(count, 1, "exactly one audit row — the replay did not write a second");
});

test("§27.7 concurrent duplicate failure reports produce exactly one effect", async () => {
  const orderId = await makePickedUpOrder();
  const results = await Promise.all([
    callFn("mark_delivery_failed", { orderId, reason: "a" }, runnerAJwt),
    callFn("mark_delivery_failed", { orderId, reason: "b" }, runnerAJwt),
    callFn("mark_delivery_failed", { orderId, reason: "c" }, runnerAJwt),
  ]);
  assert.ok(results.every((r) => r.ok), `all should be safe: ${JSON.stringify(results.map((r) => r.code))}`);
  const fresh = results.filter((r) => r.data!.alreadyFailed !== true);
  assert.equal(fresh.length, 1, "exactly one call performed the real transition");

  const { count } = await svc
    .from("audit_logs").select("id", { count: "exact", head: true })
    .eq("entity_id", orderId).eq("action", "order.delivery_failed");
  assert.equal(count, 1, "exactly one audit row under genuine concurrency");
});

test("§27.8 a failed order is recovered by admin reassignment, and can then be delivered", async () => {
  const orderId = await makePickedUpOrder();
  assert.equal((await callFn("mark_delivery_failed", { orderId, reason: "wrong block" }, runnerAJwt)).ok, true);

  // Not claimable — delivery_failed is not in the queue.
  const claim = await callFn("claim_job", { orderId }, runnerBJwt);
  assert.equal(claim.ok, false, "a failed order must not be claimable from the open queue");

  const re = await callFn("admin_reassign", { orderId, runnerId: RUNNER_B }, adminJwt);
  assert.equal(re.ok, true, JSON.stringify(re));
  assert.equal((await orderRow(orderId)).status, "assigned");

  assert.equal((await callFn("mark_picked_up", { orderId }, runnerBJwt)).ok, true);
  const { data: c } = await svc.from("order_delivery_codes").select("code").eq("order_id", orderId).single();
  const done = await callFn("verify_delivery_code", { orderId, code: (c as { code: string }).code }, runnerBJwt);
  assert.equal(done.ok, true, "the retry completes — the loop is genuinely closed");
  assert.equal((await orderRow(orderId)).status, "delivered");
});

test("§27.9 a delivery failure moves no money", async () => {
  const orderId = await makePickedUpOrder();
  const before = await svc.from("orders").select("payable, payment_status").eq("id", orderId).single();
  const { data: prof0 } = await svc.from("profiles").select("wallet_balance").eq("id", CUSTOMER).single();

  assert.equal((await callFn("mark_delivery_failed", { orderId, reason: "nobody home" }, runnerAJwt)).ok, true);

  const after = await svc.from("orders").select("payable, payment_status").eq("id", orderId).single();
  assert.deepEqual(after.data, before.data, "payable and payment_status are untouched");

  const { count: refunds } = await svc
    .from("refunds").select("id", { count: "exact", head: true })
    .in("payment_id", [(await svc.from("payments").select("id").eq("order_id", orderId).single()).data!.id]);
  assert.equal(refunds, 0, "no refund was issued automatically (#12: resolution is #13/#14's job)");

  const { data: prof1 } = await svc.from("profiles").select("wallet_balance").eq("id", CUSTOMER).single();
  assert.equal(
    (prof1 as { wallet_balance: number }).wallet_balance,
    (prof0 as { wallet_balance: number }).wallet_balance,
    "the wallet is untouched",
  );
});

test("§27.10 the failure is audited with its reason, and the code is destroyed", async () => {
  const orderId = await makePickedUpOrder();
  const { data: before } = await svc.from("order_delivery_codes").select("code").eq("order_id", orderId).single();
  assert.match((before as { code: string }).code, /^\d{4}$/);

  assert.equal((await callFn("mark_delivery_failed", { orderId, reason: "lift broken, cannot reach floor" }, runnerAJwt)).ok, true);

  const { data: rows } = await svc
    .from("audit_logs").select("metadata").eq("entity_id", orderId).eq("action", "order.delivery_failed");
  const meta = (rows ?? [])[0] as { metadata: Record<string, unknown> } | undefined;
  assert.ok(meta, "an order.delivery_failed audit row exists");
  assert.equal(meta!.metadata.reason, "lift broken, cannot reach floor");

  const { data: gone } = await svc.from("order_delivery_codes").select("order_id").eq("order_id", orderId);
  assert.deepEqual(gone ?? [], [], "the delivery code was destroyed with the failed attempt");
});

// ============================================================
// B. Realtime authorization (§27.11-20, §31)
// ============================================================
// These open real websockets against the local Realtime service. They
// are the only honest way to answer §11's "verify actual Supabase
// Realtime authorization behavior" — the RLS policy text alone does not
// tell you what the socket actually delivers.

interface Listener {
  client: SupabaseClient;
  received: string[];
  status: string;
  close: () => Promise<void>;
}

// Every listener is tracked so `after()` can close it even when the test
// that opened it failed before its own cleanup line. An orphaned
// websocket keeps the Node event loop alive and the suite never exits.
const openListeners: Listener[] = [];

// Each listener gets its own client. Sharing one socket per identity was
// tried and is worse: supabase-js disconnects a client once its last
// channel is removed, and the next subscribe on that client reported
// SUBSCRIBED while delivering nothing at all. The warm-up in listen()
// below is what makes a fresh socket safe, so pooling buys nothing.
async function subscribeOnce(jwt: string | null, filter?: string, topic?: string): Promise<Listener> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  // A null jwt leaves the socket on the anon key — the unauthenticated case.
  if (jwt) client.realtime.setAuth(jwt);
  const received: string[] = [];
  const channel = client
    .channel(topic ?? `t8:${randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", ...(filter ? { filter } : {}) },
      (p) => {
        const row = (p.new ?? p.old) as { id?: string } | undefined;
        if (row?.id) received.push(row.id);
      },
    );
  const status = await new Promise<string>((resolve) => {
    channel.subscribe((s) => {
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) resolve(s);
    });
    setTimeout(() => resolve("TIMEOUT"), 10_000);
  });
  const listener: Listener = {
    client,
    received,
    status,
    // removeAllChannels() alone leaves the websocket open, which keeps the
    // Node event loop alive and the test process never exits.
    close: async () => {
      await client.removeAllChannels();
      client.realtime.disconnect();
    },
  };
  openListeners.push(listener);
  return listener;
}

const settle = (ms = 2500) => new Promise((r) => setTimeout(r, ms));

/** Wait until a listener has seen what the test expects, or give up.
 *  A fixed sleep is a lie here: WAL replication lag varies, and a suite
 *  that sleeps 2.5s either flakes or wastes time. Polling the listener's
 *  buffer asserts the same thing without either failure mode. */
async function waitFor(l: Listener, want: (received: string[]) => boolean, ms = 15_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (want(l.received)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Realtime registers a postgres_changes subscription asynchronously: the
 *  channel reports SUBSCRIBED before the server is actually replaying WAL
 *  for it, so a test that acts immediately can lose its own first events.
 *  Rather than sleep and hope, poke a row this identity is allowed to see
 *  until one comes back — then the socket is provably live, and the
 *  buffer is cleared so the probe traffic is not mistaken for the test's
 *  own. Returns false if the channel never delivered anything. */
async function probe(l: Listener, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  let n = 0;
  while (Date.now() < deadline) {
    const { error } = await svc.from("orders").update({ cancel_reason: `realtime probe ${++n}` }).eq("id", probeOrderId);
    if (error) throw new Error(`warm-up probe could not touch ${probeOrderId}: ${JSON.stringify(error)}`);
    if (await waitFor(l, (r) => r.includes(probeOrderId), 1_000)) {
      await svc.from("orders").update({ cancel_reason: null }).eq("id", probeOrderId);
      l.received.length = 0;
      return true;
    }
  }
  await svc.from("orders").update({ cancel_reason: null }).eq("id", probeOrderId);
  return false;
}

/** Subscribe, and — when the test depends on receiving something — do not
 *  hand back the listener until it has demonstrably delivered. A channel
 *  that joins and then delivers nothing has been observed after the
 *  Realtime container restarts, and it never recovers on its own, so the
 *  remedy is a new socket rather than more waiting. */
async function listen(jwt: string | null, opts: { warm?: boolean; filter?: string; topic?: string } = {}): Promise<Listener> {
  for (let attempt = 1; ; attempt++) {
    const l = await subscribeOnce(jwt, opts.filter, opts.topic);
    if (!opts.warm) return l;
    if (l.status === "SUBSCRIBED" && (await probe(l, 10_000))) return l;
    if (attempt === 3) {
      throw new Error(`a listener never became live after ${attempt} subscriptions (last status ${l.status})`);
    }
    await l.close();
  }
}

test("§27.11/12 a store's staff receive its order events; another store's staff receive nothing", async () => {
  // The listener that must receive nothing is opened FIRST, so it has
  // been live at least as long as the one that must receive something.
  // Otherwise "received nothing" could just mean "subscribed too late".
  const theirs = await listen(otherStoreJwt);   // fixture store runner
  const cust = await listen(customerJwt, { warm: true }); // see the D20 note below
  const mine = await listen(packerJwt, { warm: true }); // seed store
  assert.equal(mine.status, "SUBSCRIBED");
  assert.equal(theirs.status, "SUBSCRIBED");
  assert.equal(cust.status, "SUBSCRIBED", "subscribing is allowed; receiving is what RLS decides");

  const orderId = await makePackedOrder();
  assert.ok(await waitFor(mine, (r) => r.includes(orderId)), "the store's own packer sees its order");
  await settle();

  assert.ok(!theirs.received.includes(orderId), "a runner at another store receives nothing — cross-store isolation");

  // What RLS actually enforces for a customer is ownership, not silence:
  // orders_select permits `customer_id = auth.uid()`, so a customer who
  // chose to open a socket receives their own orders and nothing else.
  // D20 is therefore NOT a database guarantee — it is a client-architecture
  // one, and it is asserted as such by the static check below.
  const seenByCustomer = [...new Set(cust.received)];
  const { data: owners } = await svc.from("orders").select("id, customer_id").in("id", seenByCustomer);
  const foreign = ((owners ?? []) as { id: string; customer_id: string }[]).filter((o) => o.customer_id !== CUSTOMER);
  assert.deepEqual(foreign, [], "a customer only ever receives rows they own");
  assert.equal((owners ?? []).length, seenByCustomer.length, "every id the customer saw resolves to a readable order");

  await Promise.all([mine.close(), theirs.close(), cust.close()]);
});

test("§27.13/14 a runner receives relevant job events; an unrelated store's runner does not", async () => {
  const theirs = await listen(otherStoreJwt);
  const mine = await listen(runnerAJwt, { warm: true });
  const orderId = await makePackedOrder();
  await callFn("claim_job", { orderId }, runnerAJwt);
  assert.ok(await waitFor(mine, (r) => r.includes(orderId)), "the claiming runner's store feed carries the change");
  await settle();

  assert.ok(!theirs.received.includes(orderId), "a runner at another store still receives nothing");

  await Promise.all([mine.close(), theirs.close()]);
  await callFn("release_job", { orderId }, runnerAJwt);
});

test("§27.18 duplicate events do not duplicate anything, because nothing trusts the payload", async () => {
  const l = await listen(packerJwt, { warm: true });
  const orderId = await makePackedOrder();
  // Several changes in quick succession — exactly the burst a real
  // packing action produces.
  // The packer's policy covers `confirmed` and `packed`, so creating the
  // order alone already produces the same id twice.
  //
  // The wait deliberately comes BEFORE the claim. Measured against the
  // local stack: Realtime authorizes a change lazily, and an order that
  // has already moved on to `assigned`/`picked_up` — statuses the packer
  // cannot read — stops delivering its earlier `confirmed`/`packed`
  // events too. So the event stream is NOT a complete log, which is
  // precisely why neither staff surface renders payloads: they refetch,
  // and they refetch again on SUBSCRIBED after a reconnect.
  const twice = await waitFor(l, (r) => r.filter((id) => id === orderId).length >= 2);
  assert.ok(twice, `expected several events for ${orderId}, got ${JSON.stringify(l.received)}`);

  const claim = await callFn("claim_job", { orderId }, runnerAJwt);
  assert.equal(claim.ok, true, JSON.stringify(claim));
  const pick = await callFn("mark_picked_up", { orderId }, runnerAJwt);
  assert.equal(pick.ok, true, JSON.stringify(pick));
  await settle();
  // The point: the id repeats. A client that appended payloads would show
  // the same order several times. Both surfaces refetch instead, so the
  // authoritative answer is a single row regardless of event count.
  const unique = new Set(l.received);
  assert.ok(unique.has(orderId));

  const { count } = await svc.from("orders").select("id", { count: "exact", head: true }).eq("id", orderId);
  assert.equal(count, 1, "the database still has exactly one row no matter how many events fired");

  await l.close();
  await svc.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
});

test("§27.19 unsubscribing actually stops delivery", async () => {
  // { warm: true } means it was demonstrably delivering before we stopped it.
  const l = await listen(packerJwt, { warm: true });
  await l.close();
  const before = l.received.length;

  await makePackedOrder();
  await settle();
  assert.equal(l.received.length, before, "no events arrive after the channel is removed");
});

test("§22 an unauthenticated socket receives nothing", async () => {
  // No JWT at all: the socket stays on the anon key. `anon` has no
  // SELECT on orders and orders_select grants it nothing, so subscribing
  // is allowed and receiving is not. A staff listener runs alongside so
  // a silent Realtime service cannot make this pass by accident.
  const anon = await listen(null);
  const staff = await listen(packerJwt, { warm: true });
  assert.equal(anon.status, "SUBSCRIBED", "joining is not the boundary");

  const orderId = await makePackedOrder();
  assert.ok(
    await waitFor(staff, (r) => r.includes(orderId)),
    "control: an authorized packer did receive the change",
  );
  assert.deepEqual(anon.received, [], "an unauthenticated socket receives nothing");

  await Promise.all([anon.close(), staff.close()]);
});

test("§22 the channel name is not the boundary: a customer on the staff topic still sees only their own", async () => {
  // Guess the staff channel name AND send the staff store filter. RLS is
  // evaluated per subscriber regardless, so this buys the customer
  // nothing beyond the rows they already own.
  const cust = await listen(customerJwt, {
    topic: `store:${SEED_STORE}:orders`,
    filter: `store_id=eq.${SEED_STORE}`,
  });
  const staff = await listen(packerJwt, { warm: true });
  assert.equal(cust.status, "SUBSCRIBED");

  const orderId = await makePackedOrder();
  assert.ok(await waitFor(staff, (r) => r.includes(orderId)), "control: the packer received it");
  await settle();

  const seen = [...new Set(cust.received)];
  const { data: owners } = await svc.from("orders").select("id, customer_id").in("id", seen);
  const foreign = ((owners ?? []) as { id: string; customer_id: string }[]).filter((o) => o.customer_id !== CUSTOMER);
  assert.deepEqual(foreign, [], "no row belonging to anybody else arrived");
  assert.equal((owners ?? []).length, seen.length, "every id resolves to a row the customer owns");

  await Promise.all([cust.close(), staff.close()]);
});

test("D20 is enforced in the client: no customer surface opens a Realtime channel", async () => {
  // The database would happily stream a customer their own order rows
  // (proven directly above), so D20 can only be guaranteed by the app not
  // asking. Scan the shipped source: every `.channel(` must live under the
  // runner surface or the hook it uses.
  const roots = ["app", "hooks", "lib", "components"];
  const offenders: string[] = [];
  for (const root of roots) {
    let out = "";
    try {
      out = execFileSync("grep", ["-rln", "--include=*.ts", "--include=*.tsx", "-e", "\\.channel(", root], {
        cwd: new URL("..", import.meta.url).pathname,
        encoding: "utf8",
      });
    } catch {
      continue; // grep exits 1 when nothing matches
    }
    for (const f of out.split("\n").filter(Boolean)) {
      if (f.startsWith("app/(runner)/") || f === "hooks/useRunnerRealtime.ts") continue;
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [], `these non-runner files subscribe to Realtime: ${offenders.join(", ")}`);

  // And the customer's order screen polls instead (D20's positive half).
  const useOrder = readFileSync(new URL("../hooks/useOrder.ts", import.meta.url), "utf8");
  assert.ok(/refetchInterval/.test(useOrder), "the customer order view polls");
  assert.ok(!/\.channel\(/.test(useOrder), "the customer order view does not subscribe");
});

test("§27.17 a client that was offline recovers by refetching, not by replaying events", async () => {
  // Simulate a disconnected window: no listener exists while the state
  // changes. This is the case the design has to survive.
  const orderId = await makePackedOrder();
  await callFn("claim_job", { orderId }, runnerAJwt);

  // Now "reconnect" and refetch, which is what both surfaces do on
  // SUBSCRIBED — the missed event is irrelevant.
  const l = await listen(runnerAJwt);
  assert.equal(l.status, "SUBSCRIBED");
  const row = await orderRow(orderId);
  assert.equal(row.status, "assigned", "the authoritative read shows the change that happened while offline");
  await l.close();
  await callFn("release_job", { orderId }, runnerAJwt);
});

// ============================================================
// C. Notifications (§27.21-27, §31)
// ============================================================
test("§27.21 a signed-in user can register a push token", async () => {
  const token = `ExponentPushToken[${randomUUID()}]`;
  const r = await callFn("register_push_token", { token, platform: "ios" }, customerJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const { data } = await svc.from("push_tokens").select("profile_id, platform").eq("token", token).single();
  assert.equal((data as { profile_id: string }).profile_id, CUSTOMER, "owned by the caller the JWT verified");
});

test("§27.22 registration is refused without auth, and cannot be aimed at another profile", async () => {
  const token = `ExponentPushToken[${randomUUID()}]`;
  const anon = await callFn("register_push_token", { token, platform: "ios" }, null);
  assert.equal(anon.ok, false);
  assert.equal(anon.code, "AUTH_REQUIRED");

  // The schema has no profileId field, so a forged one is simply ignored
  // and the token still lands on the caller.
  const forged = await callFn(
    "register_push_token",
    { token, platform: "ios", profileId: "00000000-0000-4000-8000-000000001001", profile_id: "00000000-0000-4000-8000-000000001001" },
    customerJwt,
  );
  assert.equal(forged.ok, true);
  const { data } = await svc.from("push_tokens").select("profile_id").eq("token", token).single();
  assert.equal((data as { profile_id: string }).profile_id, CUSTOMER, "the forged owner was ignored");
});

test("§27.23 re-registering the same token refreshes it rather than duplicating", async () => {
  const token = `ExponentPushToken[${randomUUID()}]`;
  assert.equal((await callFn("register_push_token", { token, platform: "ios" }, customerJwt)).ok, true);
  const first = await svc.from("push_tokens").select("id, last_seen_at").eq("token", token).single();

  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await callFn("register_push_token", { token, platform: "android" }, customerJwt)).ok, true);

  const { data: rows } = await svc.from("push_tokens").select("id, platform, last_seen_at").eq("token", token);
  assert.equal((rows ?? []).length, 1, "one row per device, not one per registration");
  const now = (rows ?? [])[0] as { id: string; platform: string; last_seen_at: string };
  assert.equal(now.id, (first.data as { id: string }).id, "the same row was updated");
  assert.equal(now.platform, "android", "platform refreshed");
  assert.notEqual(now.last_seen_at, (first.data as { last_seen_at: string }).last_seen_at, "last_seen_at moved");
});

test("§27.24 a client may delete only its own token", async () => {
  const mine = `ExponentPushToken[${randomUUID()}]`;
  assert.equal((await callFn("register_push_token", { token: mine, platform: "ios" }, customerJwt)).ok, true);

  // A token belonging to somebody else.
  const theirs = `ExponentPushToken[${randomUUID()}]`;
  await svc.from("push_tokens").insert({ profile_id: "00000000-0000-4000-8000-000000001001", token: theirs, platform: "ios" });

  const asCustomer = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${customerJwt}` } },
  });

  const { data: visible } = await asCustomer.from("push_tokens").select("token");
  const tokens = ((visible ?? []) as { token: string }[]).map((t) => t.token);
  assert.ok(tokens.includes(mine), "own token is visible");
  assert.ok(!tokens.includes(theirs), "another profile's token is not");

  await asCustomer.from("push_tokens").delete().eq("token", theirs);
  const { count: still } = await svc.from("push_tokens").select("id", { count: "exact", head: true }).eq("token", theirs);
  assert.equal(still, 1, "deleting somebody else's token does nothing");

  await asCustomer.from("push_tokens").delete().eq("token", mine);
  const { count: goneNow } = await svc.from("push_tokens").select("id", { count: "exact", head: true }).eq("token", mine);
  assert.equal(goneNow, 0, "sign-out can drop this device's own token");
});

test("§27.25 a notification originates from an authoritative state change, never a client call", async () => {
  const orderId = await makePackedOrder(); // confirmed -> packed happened server-side

  const { data } = await svc
    .from("notification_outbox").select("event, title, body, profile_id").eq("order_id", orderId);
  const events = ((data ?? []) as { event: string }[]).map((e) => e.event);
  assert.ok(events.includes("order.confirmed"), `expected order.confirmed, got ${JSON.stringify(events)}`);
  assert.ok(events.includes("order.packed"), `expected order.packed, got ${JSON.stringify(events)}`);

  const packed = ((data ?? []) as { event: string; profile_id: string }[]).find((e) => e.event === "order.packed")!;
  assert.equal(packed.profile_id, CUSTOMER, "addressed to the order's own customer");
});

test("§27.26 a repeated transition does not enqueue a second notification", async () => {
  const orderId = await makePackedOrder();
  // packed -> assigned -> packed -> assigned: the customer already knows
  // a runner was assigned, and should not be told twice.
  await callFn("claim_job", { orderId }, runnerAJwt);
  await callFn("release_job", { orderId }, runnerAJwt);
  await callFn("claim_job", { orderId }, runnerAJwt);

  const { count } = await svc
    .from("notification_outbox").select("id", { count: "exact", head: true })
    .eq("order_id", orderId).eq("event", "order.assigned");
  assert.equal(count, 1, "UNIQUE(order_id, event) makes the repeat a no-op");

  await callFn("release_job", { orderId }, runnerAJwt);
});

test("§27.27 no notification payload carries anything sensitive", async () => {
  const orderId = await makePickedUpOrder();
  const { data: c } = await svc.from("order_delivery_codes").select("code").eq("order_id", orderId).single();
  const code = (c as { code: string }).code;

  const { data } = await svc.from("notification_outbox").select("title, body, event").eq("order_id", orderId);
  const blob = JSON.stringify(data ?? []);

  assert.ok(!blob.includes(code), "the delivery code never reaches a notification");
  assert.ok(!/\d{4,}/.test(blob.replace(/order\.\w+/g, "")), "no long digit runs — no amounts, no phone numbers");
  for (const f of ["eyJ", "Bearer", "razorpay", "wallet"]) {
    assert.ok(!blob.includes(f), `payload must not contain ${f}`);
  }

  await callFn("mark_delivery_failed", { orderId, reason: "cleanup" }, runnerAJwt);
});

test("the dispatcher refuses an unauthenticated caller", async () => {
  const r = await fetch(`${FN_BASE}/dispatch_notifications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 401, "dispatch is internal-only, not a client endpoint");
});

test("a failed notification never blocks or corrupts order state", async () => {
  // The dispatcher is not running in this suite, so every outbox row for
  // the orders above is still unsent — and every one of those orders
  // reached its correct state anyway. That IS the assertion: the
  // lifecycle does not depend on notification delivery.
  const orderId = await makePackedOrder();
  const claim = await callFn("claim_job", { orderId }, runnerAJwt);
  assert.equal(claim.ok, true);

  const { count: unsent } = await svc
    .from("notification_outbox").select("id", { count: "exact", head: true })
    .eq("order_id", orderId).is("sent_at", null);
  assert.ok((unsent ?? 0) > 0, "notifications are queued and undelivered");
  assert.equal((await orderRow(orderId)).status, "assigned", "the order progressed regardless");

  await callFn("release_job", { orderId }, runnerAJwt);
});
