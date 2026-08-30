// Phase 5 — real payments + webhook + refunds. Integration tests against
// the REAL local Supabase (Postgres + Auth + PostgREST) and the REAL
// payment_webhook / refund / create_order / expire_stale_reservations
// Edge Function handlers (run via supabase/functions/_dev/serve.ts,
// spawned here — PHASE_4_IMPLEMENTATION_REPORT.md §20 for why not
// `supabase functions serve`).
//
// Requires: `npm run db:start` + `npm run db:reset` first.
// Run: `npm run test:integration`.
//
// GATEWAY: this suite runs against the MOCK adapter (no PAYMENT_GATEWAY
// env, CRAAVEE_ALLOW_MOCK_CONTROL=1) for deterministic fault injection —
// the D12 contract is identical to the real Razorpay adapter, whose
// signature verification is unit-tested directly below against real
// HMAC-SHA256. A live Razorpay sandbox smoke test is a documented manual
// step (PHASE_5_IMPLEMENTATION_REPORT.md §14) — it needs real rzp_test_
// keys this environment does not have.
//
// Discipline (TEST_STRATEGY.md §4): each correctness assertion was
// verified to go red with the mechanism reverted.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { RazorpayGateway } from "../../../supabase/functions/_shared/gateway/razorpay.ts";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FN_PORT = 8792; // distinct from the Phase 4 suite (8791) and dev (8790)
const FN_BASE = `http://127.0.0.1:${FN_PORT}/functions/v1`;

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const F = {
  store: "d5000000-0000-4000-8000-000000000001",
  zone: "d5000000-0000-4000-8000-000000000101",
  p1: "d5000000-0000-4000-8000-000000000201", // 5000, stock 500
};

interface Customer { phone: string; jwt: string; id: string; addr: string }
const CUST: Record<"a" | "b", Customer> = {} as never;
let ADMIN_JWT = "";
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
  throw new Error(`edge function server did not come up at ${url}`);
}

async function signIn(phone: string): Promise<{ jwt: string; id: string }> {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.verifyOtp({ phone, token: "123456", type: "sms" });
  if (error || !data.session) throw new Error(`sign-in failed for ${phone}: ${error?.message}`);
  return { jwt: data.session.access_token, id: data.session.user.id };
}

interface FnResult { status: number; ok: boolean; data?: Record<string, unknown>; code?: string }

async function callFn(
  name: string,
  body: unknown,
  opts: { jwt?: string | null; mock?: "ok" | "timeout" | "fail"; headers?: Record<string, string> } = {},
): Promise<FnResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  if (opts.jwt !== undefined && opts.jwt !== null) headers["Authorization"] = `Bearer ${opts.jwt}`;
  else if (opts.jwt === null) headers["Authorization"] = "Bearer ";
  if (opts.mock) headers["x-craavee-mock-gateway"] = opts.mock;
  const r = await fetch(`${FN_BASE}/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  let j: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } } = {};
  try { j = await r.json(); } catch { /* 403 forbidden has no json body */ }
  return { status: r.status, ok: !!j.ok, data: j.data, code: j.error?.code };
}

/** A mock-gateway webhook event (matches MockGateway.parseWebhookEvent). */
function webhookEvent(over: Record<string, unknown>) {
  return { event_id: `evt_${randomUUID()}`, status: "captured", amount: 0, ...over };
}
async function postWebhook(
  body: Record<string, unknown>,
  opts: { signature?: string | null; eventIdHeader?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.signature !== null) headers["x-craavee-webhook-signature"] = opts.signature ?? "mock-signature";
  if (opts.eventIdHeader) headers["x-razorpay-event-id"] = opts.eventIdHeader;
  const r = await fetch(`${FN_BASE}/payment_webhook`, { method: "POST", headers, body: JSON.stringify(body) });
  let j: unknown = null;
  try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
}

function orderBody(over: Record<string, unknown> = {}) {
  return { idempotencyKey: randomUUID(), addressId: CUST.a.addr, items: [{ productId: F.p1, qty: 2 }], ...over };
}

/** create_order -> { orderId, gatewayOrderRef, payable } for a gateway order. */
async function makeCreatedOrder(cust: Customer, qty = 2): Promise<{ orderId: string; ref: string; payable: number }> {
  const r = await callFn("create_order", orderBody({ addressId: cust.addr, items: [{ productId: F.p1, qty }] }), { jwt: cust.jwt });
  assert.equal(r.ok, true, `create_order failed: ${JSON.stringify(r)}`);
  const pi = r.data!.paymentIntent as { gatewayOrderRef: string };
  return { orderId: r.data!.orderId as string, ref: pi.gatewayOrderRef, payable: Number(r.data!.payable) };
}

async function payment(orderId: string) {
  const { data } = await svc.from("payments").select("status, refunded_amount, gateway_payment_ref, amount").eq("order_id", orderId).single();
  return data!;
}
async function orderStatus(orderId: string): Promise<string> {
  const { data } = await svc.from("orders").select("status").eq("id", orderId).single();
  return data!.status as string;
}
async function walletLedgerConsistent(customerId: string): Promise<boolean> {
  const { data: prof } = await svc.from("profiles").select("wallet_balance").eq("id", customerId).single();
  const { data: rows } = await svc.from("wallet_ledger").select("delta").eq("customer_id", customerId);
  const sum = (rows ?? []).reduce((s, r) => s + (r.delta as number), 0);
  return sum === (prof?.wallet_balance as number) && (prof?.wallet_balance as number) >= 0;
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
        SUPABASE_URL, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        CRAAVEE_ALLOW_MOCK_CONTROL: "1",
        FUNCTIONS_PORT: String(FN_PORT),
      },
      stdio: "ignore",
    },
  );
  await waitForServer(`${FN_BASE}/refund`);

  await teardownFixture();
  await must(svc.from("stores").insert({ id: F.store, name: "P5 Integration Store", is_open: true, max_queue_depth: 9999 }), "store");
  await must(svc.from("zones").insert({ id: F.zone, store_id: F.store, name: "P5 Zone", delivery_fee: 1000, is_serviceable: true }), "zone");
  await must(svc.from("products").insert({ id: F.p1, store_id: F.store, name: "P5-1", mrp: 6000, sale_price: 5000, category: "X", is_listed: true }), "product");
  await must(svc.from("inventory").insert({ store_id: F.store, product_id: F.p1, qty_on_hand: 500, qty_reserved: 0 }), "inventory");

  for (const [k, phone] of [["a", "9990000007"], ["b", "9990000008"]] as const) {
    const { jwt, id } = await signIn(phone);
    const addr = randomUUID();
    await svc.from("addresses").insert({ id: addr, customer_id: id, zone_id: F.zone, block: `P5-${k}`, room: "1" });
    CUST[k] = { phone, jwt, id, addr };
    await svc.from("wallet_ledger").delete().eq("customer_id", id);
    await svc.from("wallet_ledger").insert({ customer_id: id, delta: 1_000_000, reason: "manual_adjustment" });
    await svc.from("profiles").update({ wallet_balance: 1_000_000 }).eq("id", id);
  }
  ADMIN_JWT = (await signIn("9000001301")).jwt;
});

after(async () => { serverProc?.kill("SIGKILL"); });

async function teardownFixture(): Promise<void> {
  const { data: ords } = await svc.from("orders").select("id").eq("store_id", F.store);
  const orderIds = (ords ?? []).map((o) => o.id as string);
  if (orderIds.length) {
    const { data: pays } = await svc.from("payments").select("id").in("order_id", orderIds);
    const payIds = (pays ?? []).map((p) => p.id as string);
    if (payIds.length) await svc.from("refunds").delete().in("payment_id", payIds);
    await svc.from("payments").delete().in("order_id", orderIds);
    await svc.from("wallet_ledger").delete().in("order_id", orderIds);
    await svc.from("audit_logs").delete().in("entity_id", orderIds);
    await svc.from("order_items").delete().in("order_id", orderIds);
  }
  await svc.from("webhook_events").delete().like("gateway_event_id", "evt_%");
  await svc.from("orders").delete().eq("store_id", F.store);
  await svc.from("inventory").delete().eq("store_id", F.store);
  await svc.from("products").delete().eq("store_id", F.store);
  await svc.from("addresses").delete().eq("zone_id", F.zone);
  await svc.from("zones").delete().eq("store_id", F.store);
  await svc.from("stores").delete().eq("id", F.store);
}

// ============================================================
// 0. real Razorpay adapter — signature verification (Phase 5 §8, §19.4/5)
// ============================================================
test("§8 RazorpayGateway.verifyWebhookSignature: valid HMAC-SHA256 over the raw body passes", () => {
  const gw = new RazorpayGateway("rzp_test_x", "secret_key", "whsec");
  const raw = JSON.stringify({ event: "payment.captured", payload: {} });
  const sig = createHmac("sha256", "whsec").update(raw, "utf8").digest("hex");
  assert.equal(gw.verifyWebhookSignature(raw, sig), true);
});
test("§19.5 modified body -> signature fails", () => {
  const gw = new RazorpayGateway("rzp_test_x", "secret_key", "whsec");
  const raw = JSON.stringify({ event: "payment.captured", amount: 100 });
  const sig = createHmac("sha256", "whsec").update(raw, "utf8").digest("hex");
  assert.equal(gw.verifyWebhookSignature(raw + " ", sig), false);
});
test("§19.4 wrong secret -> signature fails", () => {
  const gw = new RazorpayGateway("rzp_test_x", "secret_key", "whsec");
  const raw = "{}";
  const sig = createHmac("sha256", "attacker-secret").update(raw, "utf8").digest("hex");
  assert.equal(gw.verifyWebhookSignature(raw, sig), false);
});
test("§8 missing signature header -> rejected", () => {
  const gw = new RazorpayGateway("rzp_test_x", "secret_key", "whsec");
  assert.equal(gw.verifyWebhookSignature("{}", null), false);
});
test("RazorpayGateway.parseWebhookEvent normalizes payment.captured", () => {
  const gw = new RazorpayGateway("rzp_test_x", "secret_key", "whsec");
  const evt = gw.parseWebhookEvent(JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 6000, currency: "INR", status: "captured" } } },
  }));
  assert.equal(evt.outcome, "captured");
  assert.equal(evt.gatewayOrderRef, "order_1");
  assert.equal(evt.gatewayPaymentRef, "pay_1");
  assert.equal(evt.amountPaise, 6000);
});
test("RazorpayGateway.parseWebhookEvent flags an unhandled event type", () => {
  const gw = new RazorpayGateway("rzp_test_x", "secret_key", "whsec");
  assert.throws(() => gw.parseWebhookEvent(JSON.stringify({ event: "refund.processed", payload: {} })), /UNSUPPORTED_EVENT/);
});
test("§25 getGateway is not importable without Deno — real-adapter build gates on it (documented)", () => {
  // getGateway() lives in _shared/gateway/index.ts and reads Deno.env;
  // its production-safety branching (mock impossible without
  // CRAAVEE_ALLOW_MOCK_CONTROL + non-prod CRAAVEE_ENV, Razorpay refuses
  // to start without all three secrets) is covered by the Deno test
  // supabase/functions/_shared/gateway/gateway.test.ts.
  assert.ok(true);
});

// ============================================================
// A. normal successful payment (test matrix A)
// ============================================================
test("A. capture webhook confirms the order", async () => {
  const o = await makeCreatedOrder(CUST.a);
  const res = await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_A", amount: o.payable }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(await orderStatus(o.orderId), "confirmed");
  const p = await payment(o.orderId);
  assert.equal(p.status, "captured");
  assert.equal(p.gateway_payment_ref, "pay_A");
});

// ============================================================
// B. failed payment (test matrix B)
// ============================================================
test("B. failure webhook -> payment_failed, inventory released, wallet untouched", async () => {
  const o = await makeCreatedOrder(CUST.a, 3);
  const invBefore = (await svc.from("inventory").select("qty_reserved").eq("product_id", F.p1).single()).data!.qty_reserved;
  const res = await postWebhook(webhookEvent({ order_id: o.ref, status: "failed", amount: 0 }));
  assert.equal(res.status, 200);
  assert.equal(await orderStatus(o.orderId), "payment_failed");
  assert.equal((await payment(o.orderId)).status, "failed");
  const invAfter = (await svc.from("inventory").select("qty_reserved").eq("product_id", F.p1).single()).data!.qty_reserved;
  assert.equal(invAfter, invBefore - 3, "the 3 reserved units are released");
});

// ============================================================
// C/D. timeout during payment setup + retry (test matrix C/D)
// ============================================================
test("C. gateway timeout during payment setup -> PAYMENT_SETUP_FAILED, order stays created", async () => {
  const body = orderBody({ items: [{ productId: F.p1, qty: 1 }] });
  const r = await callFn("create_order", body, { jwt: CUST.a.jwt, mock: "timeout" });
  assert.equal(r.code, "PAYMENT_SETUP_FAILED");
  const { data: o } = await svc.from("orders").select("status").eq("idempotency_key", body.idempotencyKey).single();
  assert.equal(o!.status, "created");
});
test("D. retry after a setup timeout resumes at Phase B and yields a gateway intent", async () => {
  const body = orderBody({ items: [{ productId: F.p1, qty: 1 }] });
  await callFn("create_order", body, { jwt: CUST.a.jwt, mock: "timeout" });
  const orderId = (await svc.from("orders").select("id").eq("idempotency_key", body.idempotencyKey).single()).data!.id;
  await svc.from("payments").update({ gateway_intent_requested_at: new Date(Date.now() - 120_000).toISOString() }).eq("order_id", orderId);
  const r2 = await callFn("create_order", body, { jwt: CUST.a.jwt, mock: "ok" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.ok((r2.data!.paymentIntent as { gatewayOrderRef: string }).gatewayOrderRef);
});

// ============================================================
// E/F. duplicate + concurrent-duplicate webhook (test matrix E/F, §19.6)
// ============================================================
test("E. identical webhook delivered twice -> one webhook_events row, captured once", async () => {
  const o = await makeCreatedOrder(CUST.a);
  const evt = webhookEvent({ order_id: o.ref, payment_id: "pay_E", amount: o.payable });
  const r1 = await postWebhook(evt);
  const r2 = await postWebhook(evt);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const { count } = await svc.from("webhook_events").select("*", { count: "exact", head: true }).eq("gateway_event_id", evt.event_id);
  assert.equal(count, 1);
  assert.equal((await payment(o.orderId)).refunded_amount, 0);
  assert.equal((await payment(o.orderId)).status, "captured");
});
test("F. concurrent identical webhooks -> exactly one confirms, no double effect", async () => {
  const o = await makeCreatedOrder(CUST.a);
  const evt = webhookEvent({ order_id: o.ref, payment_id: "pay_F", amount: o.payable });
  const [a, b] = await Promise.all([postWebhook(evt), postWebhook(evt)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const { count } = await svc.from("webhook_events").select("*", { count: "exact", head: true }).eq("gateway_event_id", evt.event_id);
  assert.equal(count, 1, "exactly one webhook_events row");
  assert.equal(await orderStatus(o.orderId), "confirmed");
  assert.equal((await payment(o.orderId)).refunded_amount, 0);
});

// ============================================================
// G. captured amount mismatch (test matrix G, §19.1/7)
// ============================================================
test("G. capture webhook with the wrong amount -> NOT captured, order stays created, audited", async () => {
  const o = await makeCreatedOrder(CUST.a);
  const res = await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_G", amount: o.payable - 1 }));
  assert.equal(res.status, 200, "still acked (a fast 2xx) — but not accepted");
  assert.equal(await orderStatus(o.orderId), "created");
  assert.equal((await payment(o.orderId)).status, "pending");
  const { count } = await svc.from("audit_logs").select("*", { count: "exact", head: true }).eq("entity_id", o.orderId).eq("action", "payment.amount_mismatch");
  assert.equal(count, 1);
});

// ============================================================
// H. invalid / missing signature (test matrix H, §19.4)
// ============================================================
test("H. webhook with a bad signature -> 403, no state change", async () => {
  const o = await makeCreatedOrder(CUST.a);
  const res = await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_H", amount: o.payable }), { signature: "not-the-signature" });
  assert.equal(res.status, 403);
  assert.equal(await orderStatus(o.orderId), "created");
});
test("H2. webhook with no signature header -> 403", async () => {
  const o = await makeCreatedOrder(CUST.a);
  const res = await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_H2", amount: o.payable }), { signature: null });
  assert.equal(res.status, 403);
  assert.equal(await orderStatus(o.orderId), "created");
});

// ============================================================
// §19.3 no duplicate payment captures (guarantee #2) — reused gateway_payment_ref
// ============================================================
test("§19.3 a second order cannot be captured with an already-used gateway_payment_ref", async () => {
  const oa = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: oa.ref, payment_id: "pay_SHARED", amount: oa.payable }));
  assert.equal((await payment(oa.orderId)).status, "captured");

  const ob = await makeCreatedOrder(CUST.b);
  const res = await postWebhook(webhookEvent({ order_id: ob.ref, payment_id: "pay_SHARED", amount: ob.payable }));
  assert.equal(res.status, 500, "the unique (gateway, gateway_payment_ref) violation surfaces as a retryable fault");
  assert.equal(await orderStatus(ob.orderId), "created", "order B is not confirmed off a reused payment ref");
  assert.equal((await payment(ob.orderId)).status, "pending");
});

// ============================================================
// O. webhook for a nonexistent internal order (test matrix O, §19.9)
// ============================================================
test("O. webhook for an unknown gateway order ref -> acked, recorded, no order touched", async () => {
  const res = await postWebhook(webhookEvent({ order_id: `mock_order_${randomUUID().replace(/-/g, "")}`, payment_id: "pay_O", amount: 100 }));
  assert.equal(res.status, 200);
  const { count } = await svc.from("audit_logs").select("*", { count: "exact", head: true }).eq("action", "payment.webhook_unknown_order");
  assert.ok((count ?? 0) >= 1);
});

// ============================================================
// L / N. late successful capture after reservation expiry (test matrix L/N, §19.16, TEST_STRATEGY §2.1#7)
// ============================================================
test("L. late capture after the sweep -> order stays payment_failed, wallet auto-credited", async () => {
  const { jwt, id } = await signIn(CUST.b.phone);
  await svc.from("wallet_ledger").delete().eq("customer_id", id);
  await svc.from("wallet_ledger").insert({ customer_id: id, delta: 3000, reason: "manual_adjustment" });
  await svc.from("profiles").update({ wallet_balance: 3000 }).eq("id", id);

  const r = await callFn("create_order", orderBody({ addressId: CUST.b.addr, items: [{ productId: F.p1, qty: 2 }], useWallet: true }), { jwt });
  assert.equal(r.data!.status, "created");
  const orderId = r.data!.orderId as string;
  const ref = (r.data!.paymentIntent as { gatewayOrderRef: string }).gatewayOrderRef;
  const payable = Number(r.data!.payable);

  await svc.from("orders").update({ reservation_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", orderId);
  const sweep = await callFn("expire_stale_reservations", {}, {});
  assert.equal(sweep.ok, true, JSON.stringify(sweep));
  assert.equal(await orderStatus(orderId), "payment_failed");

  const walletAfterSweep = (await svc.from("profiles").select("wallet_balance").eq("id", id).single()).data!.wallet_balance;
  const res = await postWebhook(webhookEvent({ order_id: ref, payment_id: "pay_L", amount: payable }));
  assert.equal(res.status, 200);

  assert.equal(await orderStatus(orderId), "payment_failed", "never resurrected");
  const p = await payment(orderId);
  assert.equal(p.status, "failed", "payments.status stays terminal failed (D36)");
  assert.equal(p.refunded_amount, payable);
  const { count: refundRows } = await svc.from("refunds").select("*", { count: "exact", head: true }).eq("payment_id", (await svc.from("payments").select("id").eq("order_id", orderId).single()).data!.id);
  assert.equal(refundRows, 1);
  const walletFinal = (await svc.from("profiles").select("wallet_balance").eq("id", id).single()).data!.wallet_balance;
  assert.equal(walletFinal, walletAfterSweep + payable, "wallet credited for the full captured amount");
  assert.ok(await walletLedgerConsistent(id));

  // redelivered late-capture event (distinct id) must not refund twice
  const res2 = await postWebhook(webhookEvent({ order_id: ref, payment_id: "pay_L", amount: payable }));
  assert.equal(res2.status, 200);
  const { count: stillOne } = await svc.from("refunds").select("*", { count: "exact", head: true }).eq("payment_id", (await svc.from("payments").select("id").eq("order_id", orderId).single()).data!.id);
  assert.equal(stillOne, 1, "redelivered late capture: still one refund row");

  // restore wallet
  await svc.from("wallet_ledger").delete().eq("customer_id", id);
  await svc.from("wallet_ledger").insert({ customer_id: id, delta: 1_000_000, reason: "manual_adjustment" });
  await svc.from("profiles").update({ wallet_balance: 1_000_000 }).eq("id", id);
});

// ============================================================
// I / K. refund + partial refund (test matrix I/K)
// ============================================================
test("K. partial refund -> partially_refunded, order stays confirmed, wallet credited", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_K", amount: o.payable }));
  const walletBefore = (await svc.from("profiles").select("wallet_balance").eq("id", CUST.a.id).single()).data!.wallet_balance;

  const r = await callFn("refund", { orderId: o.orderId, idempotencyKey: randomUUID(), amount: 2000, reason: "goodwill" }, { jwt: ADMIN_JWT });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.walletCredited, 2000);
  assert.equal(r.data!.gatewayRefunded, 0);
  assert.equal(await orderStatus(o.orderId), "confirmed");
  assert.equal((await payment(o.orderId)).status, "partially_refunded");
  const walletAfter = (await svc.from("profiles").select("wallet_balance").eq("id", CUST.a.id).single()).data!.wallet_balance;
  assert.equal(walletAfter, walletBefore + 2000);
});

test("I. full refund of a confirmed order -> refunded + order cancelled + reservation released", async () => {
  const o = await makeCreatedOrder(CUST.a, 4);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_I", amount: o.payable }));
  const invBefore = (await svc.from("inventory").select("qty_reserved").eq("product_id", F.p1).single()).data!.qty_reserved;

  const r = await callFn("refund", { orderId: o.orderId, idempotencyKey: randomUUID(), reason: "customer request" }, { jwt: ADMIN_JWT });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.amount, o.payable);
  assert.equal(await orderStatus(o.orderId), "cancelled");
  assert.equal((await payment(o.orderId)).status, "refunded");
  const invAfter = (await svc.from("inventory").select("qty_reserved").eq("product_id", F.p1).single()).data!.qty_reserved;
  assert.equal(invAfter, invBefore - 4, "the reservation is released on the auto-cancel");
});

// ============================================================
// J. refund idempotency (test matrix J, §19.10, TEST_STRATEGY §2.1#8)
// ============================================================
test("J. duplicate refund (same idempotencyKey) -> one refund, one effect", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_J", amount: o.payable }));
  const key = randomUUID();
  const walletBefore = (await svc.from("profiles").select("wallet_balance").eq("id", CUST.a.id).single()).data!.wallet_balance;

  const r1 = await callFn("refund", { orderId: o.orderId, idempotencyKey: key, amount: 1500, reason: "x" }, { jwt: ADMIN_JWT });
  const r2 = await callFn("refund", { orderId: o.orderId, idempotencyKey: key, amount: 1500, reason: "x" }, { jwt: ADMIN_JWT });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r1.data!.refundId, r2.data!.refundId);
  assert.equal((await payment(o.orderId)).refunded_amount, 1500);
  const walletAfter = (await svc.from("profiles").select("wallet_balance").eq("id", CUST.a.id).single()).data!.wallet_balance;
  assert.equal(walletAfter, walletBefore + 1500, "credited exactly once");
});

test("J2. concurrent duplicate refund -> exactly one refund effect", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_J2", amount: o.payable }));
  const key = randomUUID();
  const mk = () => callFn("refund", { orderId: o.orderId, idempotencyKey: key, amount: 1200, reason: "x" }, { jwt: ADMIN_JWT });
  const [a, b] = await Promise.all([mk(), mk()]);
  assert.equal(a.ok && b.ok, true, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  assert.equal((await payment(o.orderId)).refunded_amount, 1200, "exactly one refund applied");
  const payId = (await svc.from("payments").select("id").eq("order_id", o.orderId).single()).data!.id;
  const { count } = await svc.from("refunds").select("*", { count: "exact", head: true }).eq("payment_id", payId);
  assert.equal(count, 1);
});

test("J3. same key + different amount -> deterministic conflict", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_J3", amount: o.payable }));
  const key = randomUUID();
  const r1 = await callFn("refund", { orderId: o.orderId, idempotencyKey: key, amount: 1000, reason: "x" }, { jwt: ADMIN_JWT });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const r2 = await callFn("refund", { orderId: o.orderId, idempotencyKey: key, amount: 2000, reason: "x" }, { jwt: ADMIN_JWT });
  assert.equal(r2.code, "ORDER_ALREADY_EXISTS");
});

// ============================================================
// M / §19.11-13. refund guardrails
// ============================================================
test("§19.11 refund greater than the captured amount -> REFUND_EXCEEDS_CAPTURED", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_M1", amount: o.payable }));
  const r = await callFn("refund", { orderId: o.orderId, idempotencyKey: randomUUID(), amount: o.payable + 1, reason: "x" }, { jwt: ADMIN_JWT });
  assert.equal(r.code, "REFUND_EXCEEDS_CAPTURED");
});
test("§19.12 refund on a failed payment -> PAYMENT_FAILED", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, status: "failed", amount: 0 }));
  const r = await callFn("refund", { orderId: o.orderId, idempotencyKey: randomUUID(), amount: 100, reason: "x" }, { jwt: ADMIN_JWT });
  assert.equal(r.code, "PAYMENT_FAILED");
});
test("M / §19.13 refund after a full refund -> REFUND_EXCEEDS_CAPTURED", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_M3", amount: o.payable }));
  const first = await callFn("refund", { orderId: o.orderId, idempotencyKey: randomUUID(), reason: "full" }, { jwt: ADMIN_JWT });
  assert.equal(first.ok, true, JSON.stringify(first));
  const again = await callFn("refund", { orderId: o.orderId, idempotencyKey: randomUUID(), amount: 100, reason: "again" }, { jwt: ADMIN_JWT });
  assert.equal(again.code, "REFUND_EXCEEDS_CAPTURED");
});

// ============================================================
// §19.14/15. refund authorization
// ============================================================
test("§19.14 refund with no JWT -> AUTH_REQUIRED", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_U1", amount: o.payable }));
  const r = await callFn("refund", { orderId: o.orderId, idempotencyKey: randomUUID(), reason: "x" }, { jwt: null });
  assert.equal(r.status, 401);
  assert.equal(r.code, "AUTH_REQUIRED");
});
test("§19.15 a customer attempting an admin refund -> FORBIDDEN", async () => {
  const o = await makeCreatedOrder(CUST.a);
  await postWebhook(webhookEvent({ order_id: o.ref, payment_id: "pay_U2", amount: o.payable }));
  const r = await callFn("refund", { orderId: o.orderId, idempotencyKey: randomUUID(), reason: "x" }, { jwt: CUST.a.jwt });
  assert.equal(r.status, 403);
  assert.equal(r.code, "FORBIDDEN");
  assert.equal((await payment(o.orderId)).status, "captured", "no refund effect");
});
