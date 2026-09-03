// Phase 9A — admin operations against the real Edge Functions, the real
// database and real JWTs.
//
// The pgTAP suite (supabase/tests/16) proves the plpgsql in isolation
// with RLS bypassed. This file proves the things only a real stack can:
// that the HTTP auth envelope actually refuses the wrong caller, that the
// canonical error codes come back over the wire, and that the
// concurrency guarantees survive genuinely parallel requests.
//
// Every race below uses Promise.all against separate JWTs, so the
// requests are actually in flight together.
//
// Canonical: API_CONTRACTS.md §3, RBAC_MATRIX.md, ORDER_STATE_MACHINE.md
// #6/#9/#12/#13/#14.
import { test, before, beforeEach, after } from "node:test";
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

const FN_PORT = 8796; // dev 8790, order 8791, payment 8792, fulfilment 8793, runner 8794, phase8 8795
const FN_BASE = `http://127.0.0.1:${FN_PORT}/functions/v1`;

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_STORE = "00000000-0000-4000-8000-000000000001";
const ZONE = "00000000-0000-4000-8000-000000000101";
const RUNNER_A = "00000000-0000-4000-8000-000000001210";
const RUNNER_B = "00000000-0000-4000-8000-000000001220";
const RUNNER_OTHER_STORE = "00000000-0000-4000-8000-000000001240";
let CUSTOMER = "";

const F = {
  pA: "d9a00000-0000-4000-8000-000000000201",
  addr: "d9a00000-0000-4000-8000-000000000301",
};

let runnerAJwt = "", runnerBJwt = "", packerJwt = "", adminJwt = "", customerJwt = "";
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

async function postWebhook(over: Record<string, unknown>) {
  const r = await fetch(`${FN_BASE}/payment_webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-craavee-webhook-signature": "mock-signature" },
    body: JSON.stringify({ event_id: `evt_${randomUUID()}`, status: "captured", amount: 0, ...over }),
  });
  return r.status;
}

/** A genuinely `packed` order through the real pipeline. */
async function makePackedOrder(qty = 1): Promise<string> {
  const created = await callFn(
    "create_order",
    { idempotencyKey: randomUUID(), addressId: F.addr, items: [{ productId: F.pA, qty }] },
    customerJwt,
  );
  if (!created.ok) throw new Error(`fixture create_order failed: ${JSON.stringify(created)}`);
  const orderId = created.data!.orderId as string;
  const pi = created.data!.paymentIntent as { gatewayOrderRef: string };
  const st = await postWebhook({
    order_id: pi.gatewayOrderRef,
    payment_id: `pay_${orderId.slice(0, 8)}`,
    amount: Number(created.data!.payable),
  });
  if (st !== 200) throw new Error(`fixture capture webhook failed: ${st}`);
  const packed = await callFn("mark_packed", { orderId }, packerJwt);
  if (!packed.ok) throw new Error(`fixture mark_packed failed: ${JSON.stringify(packed)}`);
  return orderId;
}

/** ...and all the way to `delivery_failed`, which is what an admin acts on. */
async function makeFailedDelivery(): Promise<string> {
  const orderId = await makePackedOrder();
  const claim = await callFn("claim_job", { orderId }, runnerAJwt);
  if (!claim.ok) throw new Error(`fixture claim failed: ${JSON.stringify(claim)}`);
  const pick = await callFn("mark_picked_up", { orderId }, runnerAJwt);
  if (!pick.ok) throw new Error(`fixture pickup failed: ${JSON.stringify(pick)}`);
  const fail = await callFn("mark_delivery_failed", { orderId, reason: "9A fixture" }, runnerAJwt);
  if (!fail.ok) throw new Error(`fixture failure failed: ${JSON.stringify(fail)}`);
  return orderId;
}

async function orderRow(orderId: string) {
  const { data } = await svc
    .from("orders")
    .select("status, payment_status, runner_id, payable, delivery_code_hash")
    .eq("id", orderId).single();
  return data as Record<string, unknown>;
}

async function inv() {
  const { data } = await svc.from("inventory")
    .select("qty_on_hand, qty_reserved").eq("store_id", SEED_STORE).eq("product_id", F.pA).single();
  return data as { qty_on_hand: number; qty_reserved: number };
}

/** Free this suite's runners through LEGAL edges. enforce_order_transition
 *  rejects `picked_up -> packed` even for the service role, so a naive
 *  reset is a silent no-op and the stale job poisons the next run. */
async function parkLiveJobs() {
  const { data } = await svc
    .from("orders").select("id, status")
    .in("runner_id", [RUNNER_A, RUNNER_B, RUNNER_OTHER_STORE])
    .in("status", ["assigned", "picked_up"]);
  for (const o of (data ?? []) as { id: string; status: string }[]) {
    const to = o.status === "assigned" ? "packed" : "delivery_failed";
    const { error } = await svc.from("orders").update({ status: to }).eq("id", o.id);
    if (error) throw new Error(`could not park ${o.id} (${o.status} -> ${to}): ${JSON.stringify(error)}`);
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
      env: { ...process.env, SUPABASE_URL, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, CRAAVEE_ALLOW_MOCK_CONTROL: "1", FUNCTIONS_PORT: String(FN_PORT) },
      stdio: "ignore",
    },
  );
  await waitForServer(`${FN_BASE}/claim_job`);
  await parkLiveJobs();

  runnerAJwt = (await signIn("+919000001201")).jwt;
  runnerBJwt = (await signIn("+919000001202")).jwt;
  packerJwt = (await signIn("+919000001102")).jwt;
  adminJwt = (await signIn("+919000001301")).jwt;
  const cust = await signIn("+919990000011");
  customerJwt = cust.jwt;
  CUSTOMER = cust.id;

  await must(svc.from("products").upsert([
    { id: F.pA, store_id: SEED_STORE, name: "9A Item", mrp: 6000, sale_price: 5000, category: "Snacks", is_listed: true },
  ]), "products");
  await must(svc.from("inventory").upsert(
    [{ store_id: SEED_STORE, product_id: F.pA, qty_on_hand: 900, qty_reserved: 0 }],
    { onConflict: "store_id,product_id" },
  ), "inventory");
  await must(svc.from("addresses").upsert([
    { id: F.addr, customer_id: CUSTOMER, zone_id: ZONE, block: "9A", floor: "1", room: "1", landmark: "phase 9a" },
  ]), "address");
  // Never leave the shop shut for another suite.
  await svc.from("stores").update({ is_open: true, pause_reason: null }).eq("id", SEED_STORE);
});

beforeEach(parkLiveJobs);

after(async () => {
  await parkLiveJobs();
  await svc.from("stores").update({ is_open: true, pause_reason: null }).eq("id", SEED_STORE);
  serverProc?.kill("SIGTERM");
});


// ============================================================
// A. Authorization — the wire, not the UI (§15)
// ============================================================
const ADMIN_ONLY: [string, Record<string, unknown>][] = [
  ["admin_cancel_order", { orderId: randomUUID(), reason: "x", idempotencyKey: randomUUID() }],
  ["admin_reassign", { orderId: randomUUID() }],
  ["set_service_pause", { storeId: SEED_STORE, isOpen: false, pauseReason: "x" }],
  ["assign_staff_role", { profileId: randomUUID(), role: "packer", storeId: SEED_STORE }],
  ["settle_runner_earnings", { runnerId: RUNNER_A }],
];

test("§15 every admin function refuses an unauthenticated caller", async () => {
  for (const [fn, body] of ADMIN_ONLY) {
    const r = await callFn(fn, body, null);
    assert.equal(r.ok, false, fn);
    assert.equal(r.code, "AUTH_REQUIRED", fn);
    assert.equal(r.status, 401, fn);
  }
});

test("§15 every admin function refuses a customer, a runner and a packer", async () => {
  for (const [fn, body] of ADMIN_ONLY) {
    for (const [who, jwt] of [["customer", customerJwt], ["runner", runnerAJwt], ["packer", packerJwt]] as const) {
      const r = await callFn(fn, body, jwt);
      assert.equal(r.ok, false, `${fn} / ${who}`);
      assert.equal(r.code, "FORBIDDEN", `${fn} / ${who}`);
      assert.equal(r.status, 403, `${fn} / ${who}`);
    }
  }
});

test("§15 a forged role in the body is ignored — identity comes from the JWT", async () => {
  const orderId = await makeFailedDelivery();
  // Everything a client could possibly lie about, all at once.
  const r = await callFn(
    "admin_cancel_order",
    {
      orderId, reason: "forged", idempotencyKey: randomUUID(),
      role: "admin", actorId: "00000000-0000-4000-8000-000000001301",
      storeId: SEED_STORE, userId: "00000000-0000-4000-8000-000000001301",
      amount: 1,
    },
    customerJwt,
  );
  assert.equal(r.code, "FORBIDDEN", "a customer with an admin-shaped body is still a customer");
  assert.equal((await orderRow(orderId)).status, "delivery_failed", "nothing happened");
});


// ============================================================
// B. Failed-delivery recovery (§6/§7)
// ============================================================
test("§7 an admin re-attempts a failed delivery, and the runner gets a fresh code", async () => {
  const orderId = await makeFailedDelivery();
  const before = await orderRow(orderId);
  assert.equal(before.delivery_code_hash, null, "the failed attempt destroyed the code");

  const r = await callFn("admin_reassign", { orderId, runnerId: RUNNER_B }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const after = await orderRow(orderId);
  assert.equal(after.status, "assigned");
  assert.equal(after.runner_id, RUNNER_B, "it went to the runner the admin named");
  assert.notEqual(after.delivery_code_hash, null, "a fresh delivery code was minted");
  assert.notEqual(after.delivery_code_hash, before.delivery_code_hash);
});

test("§7 an admin cancels a failed delivery and the customer is refunded, server-computed", async () => {
  const orderId = await makeFailedDelivery();
  const { payable } = await orderRow(orderId) as { payable: number };

  const r = await callFn("admin_cancel_order", { orderId, reason: "cannot reach the block", idempotencyKey: randomUUID() }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const after = await orderRow(orderId);
  assert.equal(after.status, "cancelled");
  assert.equal(after.payment_status, "refunded");

  const { data: pay } = await svc.from("payments").select("refunded_amount").eq("order_id", orderId).single();
  assert.equal((pay as { refunded_amount: number }).refunded_amount, payable, "the full captured amount, not a client-supplied one");
});

test("§7 a cancellation without a reason is refused", async () => {
  const orderId = await makeFailedDelivery();
  const r = await callFn("admin_cancel_order", { orderId, reason: "   ", idempotencyKey: randomUUID() }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "VALIDATION_FAILED");
  assert.equal((await orderRow(orderId)).status, "delivery_failed");
});

test("§6 the UI cannot be offered an action the state machine forbids", async () => {
  // A `packed` order: no admin cancel edge exists, so the function must
  // refuse even though the caller is a genuine admin.
  const orderId = await makePackedOrder();
  const r = await callFn("admin_cancel_order", { orderId, reason: "x", idempotencyKey: randomUUID() }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "INVALID_ORDER_TRANSITION");
  assert.equal((await orderRow(orderId)).status, "packed");
});

test("§20.12 a repeated cancellation is safe — the idempotency key replays", async () => {
  const orderId = await makeFailedDelivery();
  const key = randomUUID();
  const first = await callFn("admin_cancel_order", { orderId, reason: "double click", idempotencyKey: key }, adminJwt);
  assert.equal(first.ok, true, JSON.stringify(first));

  const second = await callFn("admin_cancel_order", { orderId, reason: "double click", idempotencyKey: key }, adminJwt);
  // Either the replay returns the original, or the now-cancelled order is
  // refused as an illegal transition. Both are safe; what must NOT happen
  // is a second refund.
  assert.ok(second.ok || second.code === "INVALID_ORDER_TRANSITION", JSON.stringify(second));

  const { count } = await svc
    .from("refunds").select("id", { count: "exact", head: true })
    .eq("payment_id", (await svc.from("payments").select("id").eq("order_id", orderId).single()).data!.id);
  assert.equal(count, 1, "exactly one refund, however many times the button was pressed");
});

test("§20.12 concurrent cancellations of the same order refund exactly once", async () => {
  const orderId = await makeFailedDelivery();
  const [a, b] = await Promise.all([
    callFn("admin_cancel_order", { orderId, reason: "race a", idempotencyKey: randomUUID() }, adminJwt),
    callFn("admin_cancel_order", { orderId, reason: "race b", idempotencyKey: randomUUID() }, adminJwt),
  ]);
  assert.ok(a.ok || b.ok, "at least one succeeded");

  const { data: pay } = await svc.from("payments").select("id, amount, refunded_amount").eq("order_id", orderId).single();
  const p = pay as { id: string; amount: number; refunded_amount: number };
  assert.ok(p.refunded_amount <= p.amount, "never refunded more than was captured");
  const { count } = await svc.from("refunds").select("id", { count: "exact", head: true }).eq("payment_id", p.id);
  assert.equal(count, 1, "exactly one refund row survived the race");
});


// ============================================================
// C. Reassignment (§9/§10) — the runner guarantees must survive
// ============================================================
test("§10 reassigning to a runner who already has a live job is refused", async () => {
  const busyOrder = await makePackedOrder();
  assert.equal((await callFn("claim_job", { orderId: busyOrder }, runnerBJwt)).ok, true);

  const failed = await makeFailedDelivery();
  const r = await callFn("admin_reassign", { orderId: failed, runnerId: RUNNER_B }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "RUNNER_ALREADY_ASSIGNED");
  assert.equal((await orderRow(failed)).status, "delivery_failed", "the order did not move");
});

test("§10 reassigning to a runner at another store is refused", async () => {
  const orderId = await makeFailedDelivery();
  const r = await callFn("admin_reassign", { orderId, runnerId: RUNNER_OTHER_STORE }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  assert.equal((await orderRow(orderId)).runner_id, RUNNER_A, "still with the original runner");
});

test("§10 a runner claiming while an admin reassigns never produces two owners", async () => {
  // The invariant here is NEVER TWO OWNERS. It is deliberately not
  // "exactly one of the two calls must succeed" - that is a stronger
  // claim than the design makes, and asserting it made this test fail
  // roughly a quarter of the time.
  //
  // The two functions take the row lock differently, which is what
  // creates three legitimate outcomes rather than two:
  //
  //   claim_job          `select ... for update SKIP LOCKED` (0007 §5). If
  //                      another transaction already holds the row it gets
  //                      no row back and loses IMMEDIATELY with
  //                      JOB_ALREADY_CLAIMED, by design - "a runner who
  //                      loses should try the next order instantly, not
  //                      block".
  //   admin_reassign     plain `select ... for update`, so it WAITS; and
  //                      with a target runner it requires the order to be
  //                      `assigned` or `delivery_failed` (0007
  //                      process_admin_reassign). `packed` is not a legal
  //                      source - ORDER_STATE_MACHINE.md row 13 describes
  //                      reassignment as replacing a runner who already
  //                      holds the job.
  //
  // So:
  //   * claim takes the lock first  -> order becomes `assigned` to A, then
  //     reassign acquires, sees a legal `assigned`, and hands it to B.
  //   * reassign takes the lock first -> claim is skipped out immediately
  //     (JOB_ALREADY_CLAIMED) and reassign then finds `packed`, which is
  //     illegal, so it rolls back (INVALID_ORDER_TRANSITION). BOTH LOSE,
  //     and that is a correct, safe result: the order is untouched and
  //     still sitting in the queue for whoever asks next.
  //
  // What must never happen is two owners, an illegal resting state, or a
  // half-applied reassignment. That is what this test asserts.
  const orderId = await makePackedOrder();
  const invBefore = await inv();
  const payBefore = (await orderRow(orderId)).payment_status;

  const [claim, reassign] = await Promise.all([
    callFn("claim_job", { orderId }, runnerAJwt),
    callFn("admin_reassign", { orderId, runnerId: RUNNER_B }, adminJwt),
  ]);
  const after = await orderRow(orderId);
  const ctx = JSON.stringify({ claim, reassign, after });

  // ---- A. Never two owners, whatever happened.
  for (const runner of [RUNNER_A, RUNNER_B]) {
    const { count } = await svc
      .from("orders").select("id", { count: "exact", head: true })
      .eq("runner_id", runner).in("status", ["assigned", "picked_up"]);
    assert.ok((count ?? 0) <= 1, `runner ${runner} ended up with ${count} live jobs`);
  }

  // ---- B. No illegal resting state. `packed` (nobody took it) and
  // `assigned` (somebody did) are the only two this race can produce.
  assert.ok(["packed", "assigned"].includes(after.status as string), `illegal resting status: ${ctx}`);
  assert.equal(after.payment_status, payBefore, `payment state moved: ${ctx}`);
  const invAfter = await inv();
  assert.deepEqual(invAfter, invBefore, `inventory moved: ${ctx}`);

  const { data: reassignAudit } = await svc
    .from("audit_logs").select("id").eq("entity_id", orderId).eq("action", "order.reassigned");

  if (reassign.ok) {
    // ---- D. Reassignment won (it can only do so once claim has made the
    // order `assigned`), so B holds it and the handover is complete.
    assert.equal(after.status, "assigned", ctx);
    assert.equal(after.runner_id, RUNNER_B, ctx);
    assert.ok(after.delivery_code_hash, "the new owner must get a fresh code");
    assert.equal(reassignAudit?.length, 1, "exactly one reassignment audit row");
  } else if (claim.ok) {
    // ---- C. Claim won and reassignment did not land: A still holds it,
    // and nothing recorded a handover that never happened.
    assert.equal(after.status, "assigned", ctx);
    assert.equal(after.runner_id, RUNNER_A, ctx);
    assert.equal(reassignAudit?.length ?? 0, 0, "no audit row for a rolled-back reassignment");
  } else {
    // ---- E. Both legitimately lost. This is the outcome the previous
    // version of this test rejected.
    assert.equal(claim.code, "JOB_ALREADY_CLAIMED", `claim lost with the wrong code: ${ctx}`);
    assert.equal(reassign.code, "INVALID_ORDER_TRANSITION", `reassign lost with the wrong code: ${ctx}`);
    assert.equal(after.status, "packed", `the order should be untouched: ${ctx}`);
    assert.equal(after.runner_id, null, `no runner should own it: ${ctx}`);
    assert.equal(reassignAudit?.length ?? 0, 0, "a failed reassignment must not be audited as one");

    // ...and "still claimable" is proven by claiming it, not asserted.
    const retry = await callFn("claim_job", { orderId }, runnerAJwt);
    assert.ok(retry.ok, `the order was left unclaimable: ${JSON.stringify(retry)}`);
    assert.equal((await orderRow(orderId)).runner_id, RUNNER_A);
  }
});

test("§10 two admins reassigning at once leave exactly one runner holding it", async () => {
  const orderId = await makeFailedDelivery();
  const [a, b] = await Promise.all([
    callFn("admin_reassign", { orderId, runnerId: RUNNER_A }, adminJwt),
    callFn("admin_reassign", { orderId, runnerId: RUNNER_B }, adminJwt),
  ]);
  assert.ok(a.ok || b.ok);
  const after = await orderRow(orderId);
  assert.equal(after.status, "assigned");
  assert.ok([RUNNER_A, RUNNER_B].includes(after.runner_id as string));
});


// ============================================================
// D. Kill switch (§12) — backend-enforced, not a hidden button
// ============================================================
async function tryCheckout() {
  return callFn(
    "create_order",
    { idempotencyKey: randomUUID(), addressId: F.addr, items: [{ productId: F.pA, qty: 1 }] },
    customerJwt,
  );
}

test("§12 pausing the service actually rejects a new order", async () => {
  assert.equal((await tryCheckout()).ok, true, "control: checkout works before the pause");

  const paused = await callFn("set_service_pause", { storeId: SEED_STORE, isOpen: false, pauseReason: "kitchen flooded" }, adminJwt);
  assert.equal(paused.ok, true, JSON.stringify(paused));

  const blocked = await tryCheckout();
  assert.equal(blocked.ok, false, "a paused store must refuse a new order");
  assert.equal(blocked.code, "STORE_CLOSED");

  const resumed = await callFn("set_service_pause", { storeId: SEED_STORE, isOpen: true }, adminJwt);
  assert.equal(resumed.ok, true);
  assert.equal((await tryCheckout()).ok, true, "and resuming lets orders through again");
});

test("§12 pausing is audited, and resuming clears the reason", async () => {
  await callFn("set_service_pause", { storeId: SEED_STORE, isOpen: false, pauseReason: "stock delivery late" }, adminJwt);
  const { data: paused } = await svc.from("stores").select("is_open, pause_reason").eq("id", SEED_STORE).single();
  assert.equal((paused as { is_open: boolean }).is_open, false);
  assert.equal((paused as { pause_reason: string }).pause_reason, "stock delivery late");

  const { data: log } = await svc
    .from("audit_logs").select("action, metadata, actor_id")
    .eq("entity_id", SEED_STORE).eq("action", "service.paused")
    .order("created_at", { ascending: false }).limit(1).single();
  const l = log as { action: string; metadata: Record<string, unknown>; actor_id: string };
  assert.equal(l.metadata.reason, "stock delivery late", "the reason is in the audit row");
  assert.equal(l.actor_id, "00000000-0000-4000-8000-000000001301", "attributed to the admin who did it");

  await callFn("set_service_pause", { storeId: SEED_STORE, isOpen: true }, adminJwt);
  const { data: open } = await svc.from("stores").select("pause_reason").eq("id", SEED_STORE).single();
  assert.equal((open as { pause_reason: string | null }).pause_reason, null, "no stale reason left behind");
});

test("§12 closing without a reason is refused, so a shop is never shut anonymously", async () => {
  const r = await callFn("set_service_pause", { storeId: SEED_STORE, isOpen: false }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "VALIDATION_FAILED");
  const { data } = await svc.from("stores").select("is_open").eq("id", SEED_STORE).single();
  assert.equal((data as { is_open: boolean }).is_open, true, "still open");
});

test("§12 a checkout racing the pause resolves deterministically, never half-way", async () => {
  // Both in flight together. Postgres decides, because create_order reads
  // is_open inside the same transaction that writes the order.
  const [pause, checkout] = await Promise.all([
    callFn("set_service_pause", { storeId: SEED_STORE, isOpen: false, pauseReason: "race" }, adminJwt),
    tryCheckout(),
  ]);
  assert.equal(pause.ok, true);

  if (checkout.ok) {
    // It got in first: a complete, valid order.
    const row = await orderRow(checkout.data!.orderId as string);
    assert.equal(row.status, "created", "the order that won the race is intact");
  } else {
    assert.equal(checkout.code, "STORE_CLOSED", "or it was cleanly refused — never a partial order");
  }

  await callFn("set_service_pause", { storeId: SEED_STORE, isOpen: true }, adminJwt);
});

test("§12 repeated pause requests are safe", async () => {
  const results = await Promise.all([
    callFn("set_service_pause", { storeId: SEED_STORE, isOpen: false, pauseReason: "again" }, adminJwt),
    callFn("set_service_pause", { storeId: SEED_STORE, isOpen: false, pauseReason: "again" }, adminJwt),
    callFn("set_service_pause", { storeId: SEED_STORE, isOpen: false, pauseReason: "again" }, adminJwt),
  ]);
  for (const r of results) assert.equal(r.ok, true, JSON.stringify(r));
  const { data } = await svc.from("stores").select("is_open, pause_reason").eq("id", SEED_STORE).single();
  assert.equal((data as { is_open: boolean }).is_open, false);
  await callFn("set_service_pause", { storeId: SEED_STORE, isOpen: true }, adminJwt);
});


// ============================================================
// E. The inventory regression, over the real stack (§20.34/35)
// ============================================================
test("§20.34 refunding a packed order does not release another order's reservation", async () => {
  // Reproduced end to end through the real functions, not just pgTAP:
  // A is packed (reservation consumed) and fails; B reserves; A is
  // refunded; B must still hold its stock.
  const orderA = await makePackedOrder(3);
  const afterPack = await inv();

  assert.equal((await callFn("claim_job", { orderId: orderA }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_picked_up", { orderId: orderA }, runnerAJwt)).ok, true);
  assert.equal((await callFn("mark_delivery_failed", { orderId: orderA, reason: "regression probe" }, runnerAJwt)).ok, true);

  const created = await callFn(
    "create_order",
    { idempotencyKey: randomUUID(), addressId: F.addr, items: [{ productId: F.pA, qty: 2 }] },
    customerJwt,
  );
  assert.equal(created.ok, true, JSON.stringify(created));
  const orderB = created.data!.orderId as string;
  const withB = await inv();
  assert.equal(withB.qty_reserved, afterPack.qty_reserved + 2, "B's 2 units are reserved");

  const cancelled = await callFn("admin_cancel_order", { orderId: orderA, reason: "regression probe", idempotencyKey: randomUUID() }, adminJwt);
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));

  const after = await inv();
  assert.equal(after.qty_reserved, withB.qty_reserved, "B's reservation is untouched (was stolen before 0011)");
  assert.equal(after.qty_on_hand, withB.qty_on_hand, "and no stock was invented back onto the shelf");
  assert.equal((await orderRow(orderB)).status, "created", "B is still live");
});

test("§20.35 a pre-pack cancellation still releases its own reservation", async () => {
  // The other half of the guard: the fix must not have been "stop
  // releasing" — a confirmed order genuinely still holds its stock.
  const created = await callFn(
    "create_order",
    { idempotencyKey: randomUUID(), addressId: F.addr, items: [{ productId: F.pA, qty: 4 }] },
    customerJwt,
  );
  assert.equal(created.ok, true, JSON.stringify(created));
  const orderId = created.data!.orderId as string;
  const pi = created.data!.paymentIntent as { gatewayOrderRef: string };
  assert.equal(await postWebhook({ order_id: pi.gatewayOrderRef, payment_id: `pay_${orderId.slice(0, 8)}`, amount: Number(created.data!.payable) }), 200);

  const reserved = await inv();
  const r = await callFn("admin_cancel_order", { orderId, reason: "store closing early", idempotencyKey: randomUUID() }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const after = await inv();
  assert.equal(after.qty_reserved, reserved.qty_reserved - 4, "the 4 reserved units went back");
  assert.equal(after.qty_on_hand, reserved.qty_on_hand, "on-hand is unchanged — nothing had left the shelf");
});


// ============================================================
// F. Audit (§14/§20.36-39)
// ============================================================
test("§14 every admin action is audited with the right actor and target", async () => {
  const orderId = await makeFailedDelivery();
  await callFn("admin_reassign", { orderId, runnerId: RUNNER_B }, adminJwt);
  await callFn("admin_cancel_order", { orderId: await makeFailedDelivery(), reason: "audit probe", idempotencyKey: randomUUID() }, adminJwt);

  const { data } = await svc
    .from("audit_logs").select("action, actor_id, entity_type, entity_id, metadata")
    .in("action", ["order.reassigned", "order.cancelled"])
    .order("created_at", { ascending: false }).limit(2);
  const rows = (data ?? []) as { action: string; actor_id: string; entity_type: string; metadata: Record<string, unknown> }[];
  assert.ok(rows.length >= 1, "actions were recorded");
  for (const r of rows) {
    assert.equal(r.actor_id, "00000000-0000-4000-8000-000000001301", "attributed to the admin, not the runner");
    assert.equal(r.entity_type, "order");
  }
});

test("§14 no audit row leaks a delivery code, a token or a payment secret", async () => {
  const { data } = await svc.from("audit_logs").select("action, metadata").limit(500);
  const blob = JSON.stringify(data ?? []);

  // Secret SHAPES, not vendor names. The webhook handler records
  // `{"gateway": "razorpay"}` on an unknown-order event, and that is
  // exactly the operational context an audit log should carry — the word
  // is not the secret. `rzp_test_`/`rzp_live_` is.
  for (const forbidden of ["eyJ", "Bearer ", "rzp_test_", "rzp_live_", "service_role", "deliveryCode", "delivery_code", "PRIVATE KEY"]) {
    assert.ok(!blob.includes(forbidden), `audit metadata must not contain ${forbidden}`);
  }
  // Delivery codes are 4 digits and are never an audit field.
  const { data: codes } = await svc.from("order_delivery_codes").select("code").limit(50);
  for (const c of ((codes ?? []) as { code: string }[])) {
    assert.ok(!blob.includes(`"${c.code}"`), "a live delivery code appears in the audit log");
  }
});


// ============================================================
// G. Admin reads (§16) — RLS, not a UI check
// ============================================================
test("§16 a customer cannot read the audit log or another customer's orders", async () => {
  const asCustomer = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${customerJwt}` } },
  });
  const { data: logs } = await asCustomer.from("audit_logs").select("id").limit(5);
  assert.deepEqual(logs ?? [], [], "audit_logs is admin-only");

  const { data: orders } = await asCustomer.from("orders").select("customer_id").limit(50);
  for (const o of ((orders ?? []) as { customer_id: string }[])) {
    assert.equal(o.customer_id, CUSTOMER, "a customer sees only their own orders");
  }
});

test("§16 an admin's operational reads work through RLS, with no service key in the browser", async () => {
  const asAdmin = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${adminJwt}` } },
  });
  // Exactly the reads the Console pages make.
  const { count: orderCount } = await asAdmin.from("orders").select("id", { count: "exact", head: true });
  assert.ok((orderCount ?? 0) > 0, "admin can page the order table");

  const { data: rules } = await asAdmin.from("order_transition_rules").select("to_status").eq("actor", "admin");
  assert.ok((rules ?? []).length > 0, "admin can read the transition rules the UI uses to decide actions");

  const { data: runners } = await asAdmin.from("runners").select("id, store_id");
  assert.ok((runners ?? []).length > 0, "admin can read the runner roster");

  const { data: logs } = await asAdmin.from("audit_logs").select("id").limit(1);
  assert.ok((logs ?? []).length > 0, "admin can read the audit log");
});

test("§16 a packer cannot read the transition rules-driven admin surface", async () => {
  const asPacker = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${packerJwt}` } },
  });
  const { data: logs } = await asPacker.from("audit_logs").select("id").limit(5);
  assert.deepEqual(logs ?? [], [], "audit_logs is not readable by a packer");

  const { data: orders } = await asPacker.from("orders").select("status").limit(50);
  for (const o of ((orders ?? []) as { status: string }[])) {
    assert.ok(["confirmed", "packed"].includes(o.status), `a packer saw a ${o.status} order`);
  }
});
