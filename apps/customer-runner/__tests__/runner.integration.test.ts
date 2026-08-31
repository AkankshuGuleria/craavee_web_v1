// Phase 7 §25 — runner + last-mile delivery, against the real Edge
// Functions and the real database. Not mocks: the handlers under
// supabase/functions/*/handler.ts are served by _dev/serve.ts, talk to
// the local Postgres, and are reached over HTTP with real JWTs.
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
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FN_PORT = 8794; // dev 8790, order 8791, payment 8792, fulfilment 8793 - each suite owns its own
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
  pA: "d7000000-0000-4000-8000-000000000201",
  addr: "d7000000-0000-4000-8000-000000000301",
};

let runnerAJwt = "";
let runnerBJwt = "";
let offlineJwt = "";
let otherStoreJwt = "";
let packerJwt = "";
let adminJwt = "";
let customerJwt = "";
let serverProc: ChildProcess | null = null;

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

  runnerAJwt = (await signIn("+919000001201")).jwt;
  runnerBJwt = (await signIn("+919000001202")).jwt;
  offlineJwt = (await signIn("+919000001203")).jwt;
  otherStoreJwt = (await signIn("+919000001204")).jwt;
  packerJwt = (await signIn("+919000001102")).jwt;
  adminJwt = (await signIn("+919000001301")).jwt;
  const cust = await signIn("+919990000011"); // dedicated to this suite
  customerJwt = cust.jwt;
  CUSTOMER = cust.id;

  await must(
    svc.from("products").upsert([
      { id: F.pA, store_id: SEED_STORE, name: "P7 Item A", mrp: 6000, sale_price: 5000, category: "Snacks", is_listed: true },
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
      { id: F.addr, customer_id: CUSTOMER, zone_id: ZONE, block: "R", floor: "1", room: "7", landmark: "phase 7" },
    ]),
    "address",
  );
});

after(async () => {
  // Leave no live assignment behind for a re-run or a parallel suite.
  const { data } = await svc.from("orders").select("id").in("runner_id", [RUNNER_A, RUNNER_B]).in("status", ["assigned", "picked_up"]);
  for (const o of (data ?? []) as { id: string }[]) {
    await svc.from("orders").update({ status: "packed", runner_id: null, assigned_at: null }).eq("id", o.id);
  }
  serverProc?.kill("SIGTERM");
});

// ============================================================
// A. Authentication and authorization (§25.1-4, §22)
// ============================================================
test("claim_job rejects an unauthenticated caller (§25.1)", async () => {
  const orderId = await makePackedOrder();
  const r = await callFn("claim_job", { orderId }, null);
  assert.equal(r.ok, false);
  assert.equal(r.code, "AUTH_REQUIRED");
  assert.equal(r.status, 401);
});

test("a customer cannot perform any runner operation (§25.4)", async () => {
  const orderId = await makePackedOrder();
  for (const fn of ["claim_job", "mark_picked_up", "release_job"]) {
    const r = await callFn(fn, { orderId }, customerJwt);
    assert.equal(r.ok, false, `${fn} must refuse a customer`);
    assert.equal(r.code, "FORBIDDEN", `${fn} must answer FORBIDDEN`);
  }
  const v = await callFn("verify_delivery_code", { orderId, code: "1234" }, customerJwt);
  assert.equal(v.code, "FORBIDDEN");
});

test("a packer cannot claim a delivery job (§25.4)", async () => {
  const orderId = await makePackedOrder();
  const r = await callFn("claim_job", { orderId }, packerJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
});

test("a runner from another store cannot claim this store's job (§25.3, store isolation)", async () => {
  const orderId = await makePackedOrder();
  const r = await callFn("claim_job", { orderId }, otherStoreJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  assert.equal((await orderRow(orderId)).status, "packed");
});

test("an offline runner cannot claim (§8, runner must be active)", async () => {
  const orderId = await makePackedOrder();
  const r = await callFn("claim_job", { orderId }, offlineJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
});

test("identity comes from the JWT: a forged runnerId in the body is ignored (§22)", async () => {
  const orderId = await makePackedOrder();
  // Runner A claims, but the body claims to be runner B. The schema has
  // no runnerId field and the DB resolves identity from the JWT, so the
  // job must land on runner A regardless of what was sent.
  const r = await callFn("claim_job", { orderId, runnerId: RUNNER_B, role: "admin", storeId: SEED_STORE }, runnerAJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await orderRow(orderId)).runner_id, RUNNER_A);
  await freeRunner(runnerAJwt, orderId);
});

// ============================================================
// B. The queue (§5, §25.2)
// ============================================================
test("a runner sees eligible packed jobs at their own store, and not other stores' (§25.2, §25.27)", async () => {
  const orderId = await makePackedOrder();
  const asRunner = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${runnerAJwt}` } },
  });
  const { data, error } = await asRunner.from("orders").select("id, store_id, status").eq("status", "packed");
  assert.equal(error, null);
  const rows = (data ?? []) as { id: string; store_id: string }[];
  assert.ok(rows.some((o) => o.id === orderId), "the packed order is visible to the runner");
  assert.ok(rows.every((o) => o.store_id === SEED_STORE), "no other store's orders are visible");
});

test("a runner cannot read the delivery code, even for their own job (D14, §25.16)", async () => {
  const orderId = await makePackedOrder();
  const claim = await callFn("claim_job", { orderId }, runnerAJwt);
  assert.equal(claim.ok, true);

  const asRunner = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${runnerAJwt}` } },
  });
  const { data } = await asRunner.from("order_delivery_codes").select("code").eq("order_id", orderId);
  assert.deepEqual(data ?? [], [], "order_delivery_codes is empty for the runner - they submit a guess, never read the answer");

  // The customer who owns the order can.
  const asCustomer = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${customerJwt}` } },
  });
  const { data: mine } = await asCustomer.from("order_delivery_codes").select("code").eq("order_id", orderId);
  assert.equal((mine ?? []).length, 1, "the owning customer can read their own code");
  assert.match(((mine ?? [])[0] as { code: string }).code, /^\d{4}$/);

  await freeRunner(runnerAJwt, orderId);
});

// ============================================================
// C. Claim (§25.5-6) and the concurrency guarantees (§19)
// ============================================================
test("claim succeeds and returns the delivery payload (§25.5)", async () => {
  const orderId = await makePackedOrder();
  const r = await callFn("claim_job", { orderId }, runnerAJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.status, "assigned");
  const addr = r.data!.address as Record<string, unknown>;
  assert.equal(addr.block, "R");
  assert.equal(addr.room, "7");
  assert.ok(String(r.data!.itemSummary).includes("P7 Item A"), "the runner gets an item summary");
  // Nothing about money reaches the runner (§16).
  assert.equal(r.data!.payable, undefined);
  assert.equal(r.data!.walletApplied, undefined);
  await freeRunner(runnerAJwt, orderId);
});

test("§19.A two runners claim the same order concurrently - exactly one wins", async () => {
  const orderId = await makePackedOrder();
  const [a, b] = await Promise.all([
    callFn("claim_job", { orderId }, runnerAJwt),
    callFn("claim_job", { orderId }, runnerBJwt),
  ]);
  const wins = [a, b].filter((r) => r.ok);
  const losses = [a, b].filter((r) => !r.ok);
  assert.equal(wins.length, 1, `exactly one claim must succeed, got ${JSON.stringify([a, b])}`);
  assert.equal(losses.length, 1);
  assert.ok(
    ["JOB_ALREADY_CLAIMED", "RUNNER_ALREADY_ASSIGNED"].includes(losses[0].code!),
    `the loser gets a canonical already-claimed error, got ${losses[0].code}`,
  );

  const row = await orderRow(orderId);
  assert.equal(row.status, "assigned");
  assert.ok([RUNNER_A, RUNNER_B].includes(row.runner_id as string));

  const winnerJwt = row.runner_id === RUNNER_A ? runnerAJwt : runnerBJwt;
  await freeRunner(winnerJwt, orderId);
});

test("§19.B same runner claims two different orders concurrently - only one live job", async () => {
  const [o1, o2] = await Promise.all([makePackedOrder(), makePackedOrder()]);
  const [a, b] = await Promise.all([
    callFn("claim_job", { orderId: o1 }, runnerAJwt),
    callFn("claim_job", { orderId: o2 }, runnerAJwt),
  ]);
  const wins = [a, b].filter((r) => r.ok);
  assert.equal(wins.length, 1, `a runner may hold exactly one live job, got ${JSON.stringify([a, b])}`);

  const { count } = await svc
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("runner_id", RUNNER_A)
    .in("status", ["assigned", "picked_up"]);
  assert.equal(count, 1, "the database shows exactly one live job for this runner");

  const live = await svc.from("orders").select("id").eq("runner_id", RUNNER_A).in("status", ["assigned", "picked_up"]).single();
  await freeRunner(runnerAJwt, (live.data as { id: string }).id);
});

test("a runner holding a live job is refused a second (§25.8)", async () => {
  const o1 = await makePackedOrder();
  const o2 = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId: o1 }, runnerAJwt)).ok, true);
  const second = await callFn("claim_job", { orderId: o2 }, runnerAJwt);
  assert.equal(second.ok, false);
  assert.equal(second.code, "RUNNER_ALREADY_ASSIGNED");
  assert.equal(second.status, 409);
  assert.equal((await orderRow(o2)).status, "packed", "the refused order is untouched");
  await freeRunner(runnerAJwt, o1);
});

test("a duplicate claim on an already-assigned order fails safely (§25.6)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const dup = await callFn("claim_job", { orderId }, runnerBJwt);
  assert.equal(dup.ok, false);
  assert.equal(dup.code, "JOB_ALREADY_CLAIMED");
  assert.equal((await orderRow(orderId)).runner_id, RUNNER_A, "the original assignment is unchanged");
  await freeRunner(runnerAJwt, orderId);
});

// ============================================================
// D. Pickup (§25.10-12, §19.D)
// ============================================================
test("assigned -> picked_up, and a wrong runner cannot (§25.10, §25.12)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);

  const wrong = await callFn("mark_picked_up", { orderId }, runnerBJwt);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, "FORBIDDEN", "having the runner role is not enough - ownership is checked");

  const r = await callFn("mark_picked_up", { orderId }, runnerAJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.status, "picked_up");
  const row = await orderRow(orderId);
  assert.equal(row.status, "picked_up");
  assert.ok(row.picked_up_at, "picked_up_at was stamped server-side");

  await svc.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
});

test("packed -> picked_up is rejected: the claim step cannot be skipped (§25.17, §20)", async () => {
  const orderId = await makePackedOrder();
  const r = await callFn("mark_picked_up", { orderId }, runnerAJwt);
  assert.equal(r.ok, false);
  // Not the assignee (runner_id is null), so ownership fails first -
  // either answer proves the transition did not happen.
  assert.ok(["FORBIDDEN", "INVALID_ORDER_TRANSITION"].includes(r.code!), `unexpected code: ${r.code}`);
  assert.equal((await orderRow(orderId)).status, "packed");
});

test("§19.D duplicate mark_picked_up has no duplicate side effect", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const [a, b] = await Promise.all([
    callFn("mark_picked_up", { orderId }, runnerAJwt),
    callFn("mark_picked_up", { orderId }, runnerAJwt),
  ]);
  assert.ok(a.ok && b.ok, "both concurrent calls are safe");
  const flagged = [a, b].filter((r) => r.data!.alreadyPickedUp === true);
  assert.equal(flagged.length, 1, "exactly one call reports it was a replay");
  assert.equal((await orderRow(orderId)).status, "picked_up");

  await svc.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
});

// ============================================================
// E. Delivery verification (§25.13-19, §19.E/F, D14)
// ============================================================
test("the correct code delivers the order and credits earnings (§25.13, §25.18)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_picked_up", { orderId }, runnerAJwt)).ok, true);

  const code = await codeFor(orderId);
  const r = await callFn("verify_delivery_code", { orderId, code }, runnerAJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.status, "delivered");

  const row = await orderRow(orderId);
  assert.equal(row.status, "delivered");
  assert.ok(row.delivered_at);

  const { data: earn } = await svc.from("runner_earnings").select("runner_id, amount, settled_at").eq("order_id", orderId).single();
  assert.equal((earn as { runner_id: string }).runner_id, RUNNER_A);
  assert.equal((earn as { settled_at: string | null }).settled_at, null, "earnings start unsettled");

  const { data: gone } = await svc.from("order_delivery_codes").select("order_id").eq("order_id", orderId);
  assert.deepEqual(gone ?? [], [], "the plaintext code is destroyed once the delivery is complete");
});

test("an incorrect code is rejected and does not change state (§25.14)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_picked_up", { orderId }, runnerAJwt)).ok, true);

  const real = await codeFor(orderId);
  const wrong = real === "0000" ? "1111" : "0000";
  const r = await callFn("verify_delivery_code", { orderId, code: wrong }, runnerAJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "DELIVERY_CODE_INVALID");
  assert.equal(r.status, 400);
  assert.equal((await orderRow(orderId)).status, "picked_up", "a wrong guess changes nothing");

  await svc.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
});

test("brute force is stopped at 5 attempts, even with the correct code (§25.15, D14)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_picked_up", { orderId }, runnerAJwt)).ok, true);

  const real = await codeFor(orderId);
  const guesses = ["0001", "0002", "0003", "0004", "0005"].map((g) => (g === real ? "9999" : g));
  for (const g of guesses) {
    const r = await callFn("verify_delivery_code", { orderId, code: g }, runnerAJwt);
    assert.equal(r.code, "DELIVERY_CODE_INVALID", `guess ${g} should be invalid, got ${r.code}`);
  }

  // The 6th is refused outright. This is the assertion that makes a
  // 10,000-wide code safe: without it the space is trivially scriptable.
  const blocked = await callFn("verify_delivery_code", { orderId, code: real }, runnerAJwt);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "RATE_LIMITED");
  assert.equal(blocked.status, 429);
  assert.equal((await orderRow(orderId)).status, "picked_up", "the rate-limited attempt did not deliver the order");

  await svc.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
});

test("a runner cannot verify delivery for an order that is not theirs (§25.16, §12)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_picked_up", { orderId }, runnerAJwt)).ok, true);

  const code = await codeFor(orderId);
  const r = await callFn("verify_delivery_code", { orderId, code }, runnerBJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN", "even with a correct code, a non-assignee cannot deliver");
  assert.equal((await orderRow(orderId)).status, "picked_up");

  await svc.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
});

test("assigned -> delivered is rejected: pickup cannot be skipped (§25.17, §20)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const code = await codeFor(orderId);
  const r = await callFn("verify_delivery_code", { orderId, code }, runnerAJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "INVALID_ORDER_TRANSITION");
  assert.equal((await orderRow(orderId)).status, "assigned");
  await freeRunner(runnerAJwt, orderId);
});

test("§19.F concurrent verifications produce exactly one terminal transition and one earnings row", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_picked_up", { orderId }, runnerAJwt)).ok, true);
  const code = await codeFor(orderId);

  const results = await Promise.all([
    callFn("verify_delivery_code", { orderId, code }, runnerAJwt),
    callFn("verify_delivery_code", { orderId, code }, runnerAJwt),
    callFn("verify_delivery_code", { orderId, code }, runnerAJwt),
  ]);
  assert.ok(results.every((r) => r.ok), `all three should be safe, got ${JSON.stringify(results.map((r) => r.code))}`);
  const fresh = results.filter((r) => r.data!.alreadyDelivered !== true);
  assert.equal(fresh.length, 1, "exactly one call performed the real transition");

  const { count } = await svc.from("runner_earnings").select("id", { count: "exact", head: true }).eq("order_id", orderId);
  assert.equal(count, 1, "exactly one earnings row - no double credit");
  assert.equal((await orderRow(orderId)).status, "delivered");
});

test("delivered is terminal: no further transition is accepted (§25.25)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_picked_up", { orderId }, runnerAJwt)).ok, true);
  const code = await codeFor(orderId);
  assert.equal((await callFn("verify_delivery_code", { orderId, code }, runnerAJwt)).ok, true);

  const pick = await callFn("mark_picked_up", { orderId }, runnerAJwt);
  assert.equal(pick.ok, false);
  assert.equal(pick.code, "INVALID_ORDER_TRANSITION");
  const rel = await callFn("release_job", { orderId }, runnerAJwt);
  assert.equal(rel.ok, false);
  assert.equal(rel.code, "INVALID_ORDER_TRANSITION");
});

// ============================================================
// F. Release and reassignment (§25.20-24, §19.C)
// ============================================================
test("a runner releases their own job and it returns to the queue (§25.20)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const before = await codeFor(orderId);
  assert.match(before, /^\d{4}$/);

  const r = await callFn("release_job", { orderId, reason: "phone dying" }, runnerAJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.status, "packed");

  const row = await orderRow(orderId);
  assert.equal(row.runner_id, null, "runner_id was cleared");
  assert.equal(row.assigned_at, null, "assigned_at was cleared");
  assert.equal(row.delivery_code_hash, null, "the released runner's code no longer works");

  const { data: gone } = await svc.from("order_delivery_codes").select("order_id").eq("order_id", orderId);
  assert.deepEqual(gone ?? [], [], "the plaintext code was destroyed on release");

  // And it is genuinely claimable again.
  assert.equal((await callFn("claim_job", { orderId }, runnerBJwt)).ok, true);
  await freeRunner(runnerBJwt, orderId);
});

test("a runner cannot release someone else's job (§25.21)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const r = await callFn("release_job", { orderId }, runnerBJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  assert.equal((await orderRow(orderId)).runner_id, RUNNER_A);
  await freeRunner(runnerAJwt, orderId);
});

test("admin reassigns an assigned job from one runner to another (§25.22, §15)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const codeBefore = await codeFor(orderId);

  const r = await callFn("admin_reassign", { orderId, runnerId: RUNNER_B }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const row = await orderRow(orderId);
  assert.equal(row.runner_id, RUNNER_B, "runner B owns it");
  assert.equal(row.status, "assigned", "the order remains in a legal state");

  const { count: aStill } = await svc
    .from("orders").select("id", { count: "exact", head: true })
    .eq("runner_id", RUNNER_A).in("status", ["assigned", "picked_up"]);
  assert.equal(aStill, 0, "runner A no longer holds the job");

  const { count: bLive } = await svc
    .from("orders").select("id", { count: "exact", head: true })
    .eq("runner_id", RUNNER_B).in("status", ["assigned", "picked_up"]);
  assert.equal(bLive, 1, "runner B has exactly one live job - no duplicate assignment");

  // The replaced runner's code must stop working.
  const codeAfter = await codeFor(orderId);
  assert.notEqual(codeAfter, codeBefore, "a fresh code was minted for the new runner");
  await callFn("mark_picked_up", { orderId }, runnerBJwt);
  const stale = await callFn("verify_delivery_code", { orderId, code: codeBefore }, runnerBJwt);
  assert.equal(stale.code, "DELIVERY_CODE_INVALID", "the pre-reassignment code no longer completes the delivery");

  await svc.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
});

test("reassignment to a busy runner is refused (§25.23)", async () => {
  const o1 = await makePackedOrder();
  const o2 = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId: o1 }, runnerAJwt)).ok, true);
  assert.equal((await callFn("claim_job", { orderId: o2 }, runnerBJwt)).ok, true);

  const r = await callFn("admin_reassign", { orderId: o2, runnerId: RUNNER_A }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "RUNNER_ALREADY_ASSIGNED");
  assert.equal((await orderRow(o2)).runner_id, RUNNER_B, "the refused reassignment changed nothing");

  await freeRunner(runnerAJwt, o1);
  await freeRunner(runnerBJwt, o2);
});

test("a runner cannot reassign; only an admin can (§25.21, §14)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const r = await callFn("admin_reassign", { orderId, runnerId: RUNNER_B }, runnerAJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  assert.equal((await orderRow(orderId)).runner_id, RUNNER_A);
  await freeRunner(runnerAJwt, orderId);
});

test("reassigning across stores is refused (§14, store scope survives)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const r = await callFn("admin_reassign", { orderId, runnerId: "00000000-0000-4000-8000-000000001240" }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  await freeRunner(runnerAJwt, orderId);
});

test("admin reassign with no runnerId releases to the general queue (§14)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const r = await callFn("admin_reassign", { orderId }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.status, "packed");
  assert.equal((await orderRow(orderId)).runner_id, null);
});

test("§19.C a claim racing an admin reassign leaves a valid final state", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);

  // Runner B tries to claim (it is already assigned, so should lose)
  // while the admin simultaneously hands it to runner B.
  const [claim, reassign] = await Promise.all([
    callFn("claim_job", { orderId }, runnerBJwt),
    callFn("admin_reassign", { orderId, runnerId: RUNNER_B }, adminJwt),
  ]);

  const row = await orderRow(orderId);
  assert.ok(["assigned", "packed"].includes(row.status as string), `final status must be legal, got ${row.status}`);

  // Whatever the interleaving, no runner may end up with two live jobs
  // and the order may not be owned by two runners.
  for (const rid of [RUNNER_A, RUNNER_B]) {
    const { count } = await svc
      .from("orders").select("id", { count: "exact", head: true })
      .eq("runner_id", rid).in("status", ["assigned", "picked_up"]);
    assert.ok((count ?? 0) <= 1, `runner ${rid} must never hold more than one live job (had ${count})`);
  }
  // The claim must not have silently succeeded on an already-assigned order.
  if (claim.ok) {
    assert.equal(row.runner_id, RUNNER_B, "if the claim won, runner B owns it");
  }
  assert.ok(reassign.ok || reassign.code !== undefined, "the reassign either applied or returned a canonical error");

  if (row.status === "assigned") {
    await freeRunner(row.runner_id === RUNNER_A ? runnerAJwt : runnerBJwt, orderId);
  }
});

// ============================================================
// G. Direct-write and audit (§25.26, §25.28, §21)
// ============================================================
test("a runner cannot mutate an order directly through PostgREST (§25.26, §21)", async () => {
  const orderId = await makePackedOrder();
  const asRunner = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${runnerAJwt}` } },
  });

  // No UPDATE policy exists for orders, so this must not take effect.
  await asRunner.from("orders").update({ status: "delivered" }).eq("id", orderId);
  assert.equal((await orderRow(orderId)).status, "packed", "a direct status write must not succeed");

  await asRunner.from("orders").update({ runner_id: RUNNER_A }).eq("id", orderId);
  assert.equal((await orderRow(orderId)).runner_id, null, "a direct assignment write must not succeed");

  // Nor may a runner award themselves earnings.
  const { error } = await asRunner.from("runner_earnings").insert({ runner_id: RUNNER_A, order_id: orderId, amount: 99999 });
  assert.ok(error, "a runner cannot insert their own earnings");
});

test("audit events are recorded for the whole delivery lifecycle, without the code (§25.28, §33)", async () => {
  const orderId = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  const code = await codeFor(orderId);
  assert.equal((await callFn("mark_picked_up", { orderId }, runnerAJwt)).ok, true);
  assert.equal((await callFn("verify_delivery_code", { orderId, code }, runnerAJwt)).ok, true);

  const { data } = await svc.from("audit_logs").select("action, metadata").eq("entity_id", orderId);
  const rows = (data ?? []) as { action: string; metadata: Record<string, unknown> }[];
  const actions = rows.map((r) => r.action);
  for (const a of ["order.assigned", "order.picked_up", "order.delivered"]) {
    assert.ok(actions.includes(a), `expected an ${a} audit row, got ${JSON.stringify(actions)}`);
  }
  // The delivery code must appear nowhere in the audit trail.
  const blob = JSON.stringify(rows);
  assert.ok(!blob.includes(code), "the delivery code must never reach audit_logs");
});

test("malformed input is rejected with VALIDATION_FAILED and no state change (§22)", async () => {
  const orderId = await makePackedOrder();
  const bad = await callFn("claim_job", { orderId: "not-a-uuid" }, runnerAJwt);
  assert.equal(bad.code, "VALIDATION_FAILED");
  assert.equal(bad.status, 400);

  assert.equal((await callFn("claim_job", { orderId }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_picked_up", { orderId }, runnerAJwt)).ok, true);

  // A 5-digit code is not a valid delivery code and must not even reach
  // the rate limiter.
  const badCode = await callFn("verify_delivery_code", { orderId, code: "12345" }, runnerAJwt);
  assert.equal(badCode.code, "VALIDATION_FAILED");
  assert.equal((await orderRow(orderId)).status, "picked_up");

  await svc.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
});
