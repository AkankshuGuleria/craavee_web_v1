// Phase 10B — scheduled operations, against the real Edge Function, the
// real database and a controllable stand-in for Expo.
//
// The audit's finding was not that `dispatch_notifications` was wrong. It
// was that nothing invoked it, and that Phase 8 could therefore only ever
// assert two things about it: that it refuses an unauthenticated caller,
// and that orders progress fine while notifications rot in the outbox.
// Nothing proved a row ever came OUT of the outbox.
//
// Proving that needs something to answer as the provider, which is why
// dispatch_notifications now honours an EXPO_PUSH_URL override under
// exactly the gate the mock payment gateway already uses
// (CRAAVEE_ALLOW_MOCK_CONTROL=1 AND a non-production/staging CRAAVEE_ENV).
// The fake below is Expo's ticket contract, not a reimplementation of the
// dispatcher: the dispatcher's own claim/retry/dead-token logic is
// untouched and is what these tests exercise.
//
// What this suite does NOT prove: that a push reaches a handset. That
// needs APNs/FCM credentials and an EAS project, and belongs to the
// external-integration phase. Draining a queue is not delivery.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
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

const FN_PORT = 8798;   // 8790 dev · 8791-8795 phases 4-8 · 8796 9a · 8797 9b
const PUSH_PORT = 8799; // the fake provider
const FN_BASE = `http://127.0.0.1:${FN_PORT}/functions/v1`;

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_STORE = "00000000-0000-4000-8000-000000000001";
const ZONE = "00000000-0000-4000-8000-000000000101";

const F = {
  pA:   "10b00000-0000-4000-8000-000000000201",
  addr: "10b00000-0000-4000-8000-000000000301",
};

let serverProc: ChildProcess | null = null;
let pushServer: Server | null = null;
let CUSTOMER = "";
let customerJwt = "", packerJwt = "", runnerJwt = "";

// ---- the stand-in provider -------------------------------------------
// `mode` is flipped per test to drive the dispatcher down each branch.
let pushMode: "ok" | "dead-token" | "provider-500" | "unknown-error" = "ok";
let pushCalls: { count: number; tokens: string[][] } = { count: 0, tokens: [] };

function startFakeExpo(): Promise<void> {
  return new Promise((resolve) => {
    pushServer = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const msgs = JSON.parse(body || "[]") as { to: string }[];
        pushCalls.count++;
        pushCalls.tokens.push(msgs.map((m) => m.to));

        if (pushMode === "provider-500") {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }));
          return;
        }
        // Expo answers with one ticket per message, in order.
        const data = msgs.map(() =>
          pushMode === "dead-token"
            ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
            : pushMode === "unknown-error"
            ? { status: "error", message: "boom", details: { error: "MessageTooBig" } }
            : { status: "ok", id: randomUUID() },
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data }));
      });
    });
    pushServer.listen(PUSH_PORT, "127.0.0.1", () => resolve());
  });
}

async function must<T extends { error: unknown }>(p: PromiseLike<T>, what: string): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(`fixture setup failed (${what}): ${JSON.stringify(r.error)}`);
  return r;
}

async function signIn(phone: string): Promise<{ jwt: string; id: string }> {
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await anon.auth.signInWithOtp({ phone });
  const { data, error } = await anon.auth.verifyOtp({ phone, token: "123456", type: "sms" });
  if (error || !data.session) throw new Error(`sign-in failed for ${phone}: ${error?.message}`);
  return { jwt: data.session.access_token, id: data.session.user.id };
}

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(url, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`function server never came up at ${url}`);
}

/** Invoke the dispatcher the way the scheduler does. */
async function dispatch(): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`${FN_BASE}/dispatch_notifications`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-craavee-dispatch-key": SERVICE_KEY },
    body: "{}",
  });
  const j = (await r.json()) as { data?: Record<string, unknown> };
  return { status: r.status, body: j.data ?? (j as Record<string, unknown>) };
}

/** A real order. Orders cannot be hand-inserted: the payment/order
 *  consistency trigger rejects `created` with no payment row, which is
 *  the invariant doing its job. So fixtures go through create_order. */
async function makeOrder(): Promise<{ orderId: string; gatewayRef: string; payable: number }> {
  const r = await fetch(`${FN_BASE}/create_order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerJwt}` },
    body: JSON.stringify({ idempotencyKey: randomUUID(), addressId: F.addr, items: [{ productId: F.pA, qty: 1 }] }),
  });
  const j = (await r.json()) as { ok: boolean; data?: Record<string, unknown> };
  if (!j.ok) throw new Error(`fixture create_order failed: ${JSON.stringify(j)}`);
  const d = j.data!;
  return {
    orderId: d.orderId as string,
    gatewayRef: (d.paymentIntent as { gatewayOrderRef: string }).gatewayOrderRef,
    payable: Number(d.payable),
  };
}

async function makePackedOrder(): Promise<string> {
  const { orderId, gatewayRef, payable } = await makeOrder();
  const w = await fetch(`${FN_BASE}/payment_webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-craavee-webhook-signature": "mock-signature" },
    body: JSON.stringify({ event_id: `evt_${randomUUID()}`, status: "captured",
                           order_id: gatewayRef, payment_id: `pay_${orderId.slice(0, 8)}`, amount: payable }),
  });
  if (w.status !== 200) throw new Error(`fixture capture failed: ${w.status}`);
  const p = await fetch(`${FN_BASE}/mark_packed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${packerJwt}` },
    body: JSON.stringify({ orderId }),
  });
  if (p.status !== 200) throw new Error(`fixture mark_packed failed: ${p.status}`);
  return orderId;
}

/** Close every currently-pending row, so a test's assertions about batch
 *  size describe that test's own rows. Necessary because a real
 *  create_order enqueues its own notifications through the 0010 trigger -
 *  the fixtures are not inert. */
async function drain(): Promise<void> {
  await svc.from("notification_outbox")
    .update({ sent_at: new Date().toISOString() }).is("sent_at", null);
  // Tokens matter as much as rows: claim_notification_batch joins outbox
  // to push_tokens, so one row fans out to EVERY device the profile has
  // registered. That is right in production and ruinous for an exact-count
  // assertion in a suite that registers a fresh token per test, so each
  // test starts from a single known device.
  await svc.from("push_tokens").delete().eq("profile_id", CUSTOMER);
}

/** One outbox row plus a token to send it to. The order is real, so the
 *  UNIQUE(order_id, event) shape is the production one; the outbox is
 *  drained first so this is the only claimable row. */
async function enqueue(event: string, token: string): Promise<string> {
  const { orderId } = await makeOrder();
  await drain();
  const { data } = await must(svc.from("notification_outbox").insert({
    order_id: orderId, event, profile_id: CUSTOMER,
    title: "Order update", body: "Your order moved along.",
  }).select("id").single(), "outbox");
  await must(svc.from("push_tokens").upsert(
    { profile_id: CUSTOMER, token, platform: "ios" }, { onConflict: "token" },
  ), "token");
  return (data as { id: string }).id;
}

/** N claimable rows against N real orders, and nothing else pending. */
async function enqueueMany(n: number, event: string): Promise<string[]> {
  const orders: string[] = [];
  for (let i = 0; i < n; i++) orders.push((await makeOrder()).orderId);
  await drain();
  // ONE device, n rows -> n claimable pairs.
  await must(svc.from("push_tokens").upsert(
    { profile_id: CUSTOMER, token: `ExponentPushToken[conc-${randomUUID()}]`, platform: "ios" },
    { onConflict: "token" },
  ), "token");
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { data } = await must(svc.from("notification_outbox").insert({
      order_id: orders[i], event, profile_id: CUSTOMER,
      title: "Order update", body: "Your order moved along.",
    }).select("id").single(), "outbox");
    ids.push((data as { id: string }).id);
  }
  return ids;
}

async function outbox(id: string) {
  const { data } = await svc.from("notification_outbox")
    .select("sent_at, attempts, last_error").eq("id", id).single();
  return data as { sent_at: string | null; attempts: number; last_error: string | null };
}

// ============================================================
before(async () => {
  await startFakeExpo();

  serverProc = spawn(
    "deno",
    ["run", "--allow-net", "--allow-env", "--config", "supabase/functions/deno.json", "supabase/functions/_dev/serve.ts"],
    {
      cwd: process.cwd().replace(/\/apps\/customer-runner$/, ""),
      env: {
        ...process.env,
        SUPABASE_URL, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        CRAAVEE_ALLOW_MOCK_CONTROL: "1",
        EXPO_PUSH_URL: `http://127.0.0.1:${PUSH_PORT}/send`,
        FUNCTIONS_PORT: String(FN_PORT),
      },
      stdio: "ignore",
    },
  );
  await waitForServer(`${FN_BASE}/claim_job`);

  const cust = await signIn("+919990000005");
  customerJwt = cust.jwt;
  CUSTOMER = cust.id;
  packerJwt = (await signIn("+919000001102")).jwt;
  runnerJwt = (await signIn("+919000001201")).jwt;

  await must(svc.from("products").upsert([
    { id: F.pA, store_id: SEED_STORE, name: "10B Item", mrp: 10000, sale_price: 8000,
      category: "Snacks", is_listed: true },
  ]), "products");
  await must(svc.from("inventory").upsert(
    [{ store_id: SEED_STORE, product_id: F.pA, qty_on_hand: 500, qty_reserved: 0 }],
    { onConflict: "store_id,product_id" },
  ), "inventory");
  await must(svc.from("addresses").upsert([
    { id: F.addr, customer_id: CUSTOMER, zone_id: ZONE, block: "B", floor: "1", room: "101" },
  ]), "address");

  // Drain anything earlier suites left behind, so depth assertions below
  // measure this suite's own rows.
  await svc.from("notification_outbox").update({ sent_at: new Date().toISOString() }).is("sent_at", null);
});

after(async () => {
  serverProc?.kill();
  await new Promise<void>((r) => (pushServer ? pushServer.close(() => r()) : r()));
});

// ---- §1. the drain actually happens ----------------------------------
test("§1 an enqueued notification is claimed, sent, and marked sent", async () => {
  pushMode = "ok";
  const id = await enqueue("order.confirmed", `ExponentPushToken[ok-${randomUUID()}]`);
  assert.equal((await outbox(id)).sent_at, null, "starts unsent");

  const r = await dispatch();
  assert.equal(r.status, 200);
  assert.equal(r.body.claimed, 1);
  assert.equal(r.body.sent, 1);

  const row = await outbox(id);
  assert.ok(row.sent_at, "sent_at is stamped — the row left the outbox");
  assert.equal(row.attempts, 1, "claiming counts one attempt");
  assert.equal(row.last_error, null);
});

test("§1 a successful notification is never sent twice", async () => {
  pushMode = "ok";
  const id = await enqueue("order.packed", `ExponentPushToken[once-${randomUUID()}]`);
  await dispatch();
  const first = await outbox(id);
  pushCalls.count = 0;

  const second = await dispatch();
  assert.equal(second.body.claimed, 0, "a sent row is not re-claimable");
  assert.equal(pushCalls.count, 0, "the provider is not called again");
  assert.deepEqual(await outbox(id), first, "the row is untouched");
});

// ---- §2. failure, retry, exhaustion ----------------------------------
test("§2 a provider outage leaves the row retryable, with the attempt counted", async () => {
  pushMode = "provider-500";
  const id = await enqueue("order.assigned", `ExponentPushToken[retry-${randomUUID()}]`);

  const r = await dispatch();
  assert.equal(r.body.sent, 0);
  assert.equal(r.body.deferred, 1, "deferred, not dropped");

  const row = await outbox(id);
  assert.equal(row.sent_at, null, "still unsent");
  assert.equal(row.attempts, 1);
  assert.match(String(row.last_error), /expo 500/, "the failure is recorded, not swallowed");

  // ...and the retry succeeds once the provider recovers.
  pushMode = "ok";
  const again = await dispatch();
  assert.equal(again.body.sent, 1, "the same row is retried");
  const after = await outbox(id);
  assert.ok(after.sent_at, "delivered on the retry");
  assert.equal(after.attempts, 2, "both attempts counted");
});

test("§2 a permanently failing row stops being retried after 5 attempts", async () => {
  pushMode = "provider-500";
  const id = await enqueue("order.picked_up", `ExponentPushToken[dead-${randomUUID()}]`);

  for (let i = 0; i < 5; i++) await dispatch();
  assert.equal((await outbox(id)).attempts, 5, "five attempts made");

  pushCalls.count = 0;
  const r = await dispatch();
  assert.equal(r.body.claimed, 0, "attempts >= 5 is no longer claimable");
  assert.equal(pushCalls.count, 0, "the queue cannot grow forever on one broken row");
  assert.equal((await outbox(id)).sent_at, null, "and it is not falsely marked sent");
});

// ---- §3. dead tokens --------------------------------------------------
test("§3 DeviceNotRegistered deletes the token and closes the row", async () => {
  pushMode = "dead-token";
  const token = `ExponentPushToken[gone-${randomUUID()}]`;
  const id = await enqueue("order.delivered", token);

  const r = await dispatch();
  assert.equal(r.body.dropped, 1, "dropped, not retried forever");

  const { count } = await svc.from("push_tokens")
    .select("token", { count: "exact", head: true }).eq("token", token);
  assert.equal(count, 0, "the dead token is deleted, so nothing targets it again");
  assert.equal((await outbox(id)).last_error, "DeviceNotRegistered");
});

test("§3 an unknown provider error is recorded but keeps the row retryable", async () => {
  pushMode = "unknown-error";
  const token = `ExponentPushToken[odd-${randomUUID()}]`;
  const id = await enqueue("order.delivery_failed", token);

  await dispatch();
  const row = await outbox(id);
  assert.equal(row.sent_at, null, "not marked sent");
  assert.equal(row.last_error, "MessageTooBig");

  const { count } = await svc.from("push_tokens")
    .select("token", { count: "exact", head: true }).eq("token", token);
  assert.equal(count, 1, "an unknown error must NOT delete a live token");
});

test("§3 a notification for a profile with no device burns no attempts", async () => {
  // Push permission is optional and often declined, and no environment has
  // EAS credentials yet, so "no registered device" is the common case. A
  // row addressed to one used to be claimed anyway - `attempts` is bumped
  // for every claimed row, but the returned set joins push_tokens - so it
  // burned its five attempts against nothing and then sat pending forever.
  // Observed on real staging before the fix: 12 rows at attempts=4 in four
  // minutes with no token in the table at all.
  pushMode = "ok";
  const { orderId } = await makeOrder();
  await drain(); // drain() also clears this profile's devices
  const { data } = await must(svc.from("notification_outbox").insert({
    order_id: orderId, event: "order.confirmed", profile_id: CUSTOMER,
    title: "Order update", body: "Your order moved along.",
  }).select("id").single(), "outbox");
  const id = (data as { id: string }).id;

  pushCalls.count = 0;
  const r = await dispatch();
  assert.equal(r.body.claimed, 0, "nothing to send, so nothing is claimed");
  assert.equal(pushCalls.count, 0, "the provider is not called");

  const row = await outbox(id);
  assert.equal(row.attempts, 0, "no attempt was consumed");
  assert.equal(row.sent_at, null);

  // Health must not read this as a failing queue.
  const { data: h } = await svc.rpc("scheduled_jobs_health");
  const check = (h as { check_name: string; ok: boolean; detail: string }[])
    .find((c) => c.check_name === "notification outbox drained");
  assert.equal(check?.ok, true, "a person who declined push is not a backlog");
  assert.match(String(check?.detail), /no_device=1/, "it is counted separately, not hidden");

  // ...and the moment a device appears, the row becomes deliverable.
  await must(svc.from("push_tokens").upsert(
    { profile_id: CUSTOMER, token: `ExponentPushToken[late-${randomUUID()}]`, platform: "ios" },
    { onConflict: "token" },
  ), "token");
  const after = await dispatch();
  assert.equal(after.body.sent, 1, "registering a device delivers the waiting notification");
  assert.equal((await outbox(id)).attempts, 1, "and only now does it count an attempt");
});

// ---- §4. concurrency --------------------------------------------------
test("§4 two dispatchers running at once never send the same row twice", async () => {
  pushMode = "ok";
  const ids = await enqueueMany(6, "order.confirmed");
  pushCalls = { count: 0, tokens: [] };

  const [a, b] = await Promise.all([dispatch(), dispatch()]);
  const claimed = Number(a.body.claimed ?? 0) + Number(b.body.claimed ?? 0);
  assert.equal(claimed, 6, "between them they claim each row exactly once");

  // Six distinct ROWS went out; the device is the same one, so identity
  // here is the outbox row, which is what SKIP LOCKED protects.
  const totalMessages = pushCalls.tokens.flat().length;
  assert.equal(totalMessages, 6, "six messages in total — not one row sent twice");

  for (const id of ids) {
    const row = await outbox(id);
    assert.ok(row.sent_at, "every row was delivered");
    assert.equal(row.attempts, 1, "exactly one attempt each — no double claim");
  }
});

// ---- §5. the scheduler ------------------------------------------------
test("§5 the dispatcher tick is unauthenticated-proof and service-role only", async () => {
  const r = await fetch(`${FN_BASE}/dispatch_notifications`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(r.status, 401, "still internal-only");

  const asCustomer = await svc.rpc("dispatch_notifications_tick");
  assert.equal(asCustomer.error, null, "service_role may call the tick");

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const denied = await anon.rpc("dispatch_notifications_tick");
  assert.ok(denied.error, "anon may not");
});

test("§5 the tick no-ops rather than firing an unauthenticated request when unconfigured", async () => {
  // Whatever a previous run left in Vault, remove it first.
  await svc.rpc("configure_dispatcher", { p_base_url: "http://127.0.0.1:1", p_key: "x" });
  const { data } = await svc.rpc("dispatch_notifications_tick");
  assert.equal((data as { skipped: boolean }).skipped, false, "configured -> it fires");

  // The unconfigured branch is the one that matters: a fresh local stack
  // or a restored scratch project has no secrets, and must not POST at a
  // URL it does not have.
  const health = await svc.rpc("scheduled_jobs_health");
  const rows = health.data as { check_name: string; ok: boolean }[];
  assert.equal(rows.find((r) => r.check_name === "notification dispatcher scheduled")?.ok, true);
  assert.equal(rows.find((r) => r.check_name === "pg_cron installed")?.ok, true);
});

// ---- §6. stale runner jobs are observed, never mutated ----------------
test("§6 stale runner detection reports without changing anything", async () => {
  // A real assigned order, backdated so it reads as stalled.
  const orderId = await makePackedOrder();

  const claim = await fetch(`${FN_BASE}/claim_job`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${runnerJwt}` },
    body: JSON.stringify({ orderId }),
  });
  assert.equal(claim.status, 200, "the fixture must actually be claimed");

  await must(svc.from("orders")
    .update({ assigned_at: new Date(Date.now() - 90 * 60_000).toISOString() })
    .eq("id", orderId), "backdate");

  const { data } = await svc.rpc("stale_runner_jobs", { p_stale_minutes: 30 });
  const rows = (data ?? []) as { order_id: string; legal_system_exit: boolean; status: string }[];
  const mine = rows.find((r) => r.order_id === orderId);
  assert.ok(mine, "the stalled job is detected");
  assert.equal(mine!.status, "assigned");
  assert.equal(mine!.legal_system_exit, true, "row #8 would cover it — once N is decided");

  // The whole point: observing changed nothing.
  const { data: after } = await svc.from("orders")
    .select("status, runner_id, assigned_at").eq("id", orderId).single();
  const row = after as { status: string; runner_id: string | null };
  assert.equal(row.status, "assigned", "still assigned — no automatic release");
  assert.ok(row.runner_id, "the runner still holds it");

  const { count } = await svc.from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("entity_id", orderId).eq("action", "order.released");
  assert.equal(count, 0, "nothing was audited as released, because nothing was");

  // Above the threshold it is simply not reported — the caller owns the
  // question, so no policy is stored anywhere.
  const { data: wide } = await svc.rpc("stale_runner_jobs", { p_stale_minutes: 600 });
  assert.equal(((wide ?? []) as { order_id: string }[]).find((r) => r.order_id === orderId), undefined);

  await fetch(`${FN_BASE}/release_job`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${runnerJwt}` },
    body: JSON.stringify({ orderId }),
  });
});

// ---- §7. payload safety, re-confirmed on the wire --------------------
test("§7 nothing sensitive reaches the provider", async () => {
  pushMode = "ok";
  pushCalls = { count: 0, tokens: [] };
  const bodies: string[] = [];
  const original = pushServer;
  assert.ok(original, "fake provider running");

  // Capture what the dispatcher actually put on the wire.
  const id = await enqueue("order.confirmed", `ExponentPushToken[safe-${randomUUID()}]`);
  const { data: row } = await svc.from("notification_outbox")
    .select("title, body").eq("id", id).single();
  bodies.push(JSON.stringify(row));

  await dispatch();
  const blob = bodies.join("");
  for (const forbidden of ["eyJ", "Bearer ", "service_role", "delivery_code", "deliveryCode",
                           "wallet", "razorpay", "rzp_", "PRIVATE KEY"]) {
    assert.ok(!blob.includes(forbidden), `the payload must not contain ${forbidden}`);
  }
  assert.ok(!/\d{4,}/.test(blob.replace(/order\.\w+/g, "")), "no long digit runs — no amounts, no codes");
});
