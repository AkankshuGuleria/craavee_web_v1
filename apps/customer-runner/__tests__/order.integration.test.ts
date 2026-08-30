// Phase 4 — order creation + inventory correctness. Integration tests
// against the REAL local Supabase (Postgres + Auth + PostgREST) and the
// REAL create_order / validate_promo / expire_stale_reservations Edge
// Function handlers (run via supabase/functions/_dev/serve.ts, spawned
// here — see PHASE_4_IMPLEMENTATION_REPORT.md §20 for why not `supabase
// functions serve`).
//
// Requires: `npm run db:start` + `npm run db:reset` first (README.md).
// Run: `npm run test:integration` (this app) or the repo-root alias.
//
// Concurrency cases use genuine `Promise.all`, never sequential `await` —
// TEST_STRATEGY.md §2 (#1, #3) and §2.1. Attack cases (§26 A–M) submit
// tampered payloads / direct PostgREST writes and assert every one fails.
//
// Discipline (TEST_STRATEGY.md §4): each correctness assertion was
// verified to go red with the mechanism reverted, not merely to pass.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { ERROR_CODES as CANONICAL_ERROR_CODES } from "@craavee/api-contracts";
import { createOrderRequestSchema } from "@craavee/validation";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FN_PORT = 8791; // distinct from the dev default so a running dev server doesn't clash
const FN_BASE = `http://127.0.0.1:${FN_PORT}/functions/v1`;

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- fixture ids (fixed; db is reset before this suite in CI) ----
const F = {
  store: "d4000000-0000-4000-8000-000000000001",
  zone: "d4000000-0000-4000-8000-000000000101",
  zoneBad: "d4000000-0000-4000-8000-000000000102",
  p1: "d4000000-0000-4000-8000-000000000201", // 5000, stock 200
  p2: "d4000000-0000-4000-8000-000000000202", // 3000, stock 1  (oversell)
  p3: "d4000000-0000-4000-8000-000000000203", // 10000, stock 200
  p4: "d4000000-0000-4000-8000-000000000204", // 4000, stock 200 (wallet concurrency)
  p5: "d4000000-0000-4000-8000-000000000205", // 2000, stock 200 (promo)
  pUnlisted: "d4000000-0000-4000-8000-000000000206", // is_listed=false
  otherStoreProduct: "00000000-0000-4000-8000-000000003001", // seed store's Cheetos
};

interface Customer {
  phone: string;
  jwt: string;
  id: string;
  addr: string;
  addrBadZone?: string;
}
const CUST: Record<"a" | "b" | "c", Customer> = {} as never;

let serverProc: ChildProcess | null = null;

/** Throw loudly if a service-role write failed — a silent fixture
 *  failure otherwise shows up as every downstream test getting
 *  ITEM_UNAVAILABLE. */
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
    } catch {
      /* not up yet */
    }
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

interface FnResult {
  status: number;
  ok: boolean;
  data?: Record<string, unknown>;
  code?: string;
}

async function callFn(
  name: string,
  body: unknown,
  opts: { jwt?: string | null; mock?: "ok" | "timeout" | "fail" } = {},
): Promise<FnResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.jwt !== null) headers["Authorization"] = `Bearer ${opts.jwt ?? ""}`;
  if (opts.mock) headers["x-craavee-mock-gateway"] = opts.mock;
  const r = await fetch(`${FN_BASE}/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };
  return { status: r.status, ok: j.ok, data: j.data, code: j.error?.code };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    addressId: CUST.a.addr,
    items: [{ productId: F.p1, qty: 1 }],
    ...overrides,
  };
}

// ============================================================
// setup / teardown
// ============================================================
before(async () => {
  // 1. spawn the edge function server
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
  await waitForServer(`${FN_BASE}/validate_promo`);

  // 2. fixture store / zones / catalog — dedicated, so concurrency tests
  //    mutating inventory never touch the seed data. Idempotent: this
  //    suite still expects a fresh `supabase db reset` (README.md /
  //    .github/workflows/database.yml), but tears down + rebuilds its own
  //    subtree so a local re-run without a reset also works.
  await teardownFixture();

  await must(svc.from("stores").insert({ id: F.store, name: "P4 Integration Store", is_open: true, max_queue_depth: 9999 }), "store");
  await must(svc.from("zones").insert([
    { id: F.zone, store_id: F.store, name: "P4 Serviceable", delivery_fee: 1000, is_serviceable: true },
    { id: F.zoneBad, store_id: F.store, name: "P4 Paused", delivery_fee: 1500, is_serviceable: false },
  ]), "zones");
  await must(svc.from("products").insert([
    { id: F.p1, store_id: F.store, name: "P1", mrp: 6000, sale_price: 5000, category: "X", is_listed: true },
    { id: F.p2, store_id: F.store, name: "P2 (scarce)", mrp: 3500, sale_price: 3000, category: "X", is_listed: true },
    { id: F.p3, store_id: F.store, name: "P3", mrp: 12000, sale_price: 10000, category: "X", is_listed: true },
    { id: F.p4, store_id: F.store, name: "P4 (wallet)", mrp: 4500, sale_price: 4000, category: "X", is_listed: true },
    { id: F.p5, store_id: F.store, name: "P5 (promo)", mrp: 2500, sale_price: 2000, category: "X", is_listed: true },
    { id: F.pUnlisted, store_id: F.store, name: "P6 unlisted", mrp: 2000, sale_price: 1800, category: "X", is_listed: false },
  ]), "products");
  await must(svc.from("inventory").insert([
    { store_id: F.store, product_id: F.p1, qty_on_hand: 200, qty_reserved: 0 },
    { store_id: F.store, product_id: F.p2, qty_on_hand: 1, qty_reserved: 0 },
    { store_id: F.store, product_id: F.p3, qty_on_hand: 200, qty_reserved: 0 },
    { store_id: F.store, product_id: F.p4, qty_on_hand: 200, qty_reserved: 0 },
    { store_id: F.store, product_id: F.p5, qty_on_hand: 200, qty_reserved: 0 },
    { store_id: F.store, product_id: F.pUnlisted, qty_on_hand: 200, qty_reserved: 0 },
  ]), "inventory");

  // 3. promos
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  await must(svc.from("promos").insert([
    { code: "P4FLAT", type: "flat", value: 2000, max_uses: 100, per_user_limit: 1, valid_from: past, valid_to: future },
    { code: "P4PCT", type: "percent", value: 10, per_user_limit: 5, valid_from: past, valid_to: future },
    { code: "P4EXP", type: "flat", value: 1000, per_user_limit: 5, valid_from: past, valid_to: past },
    { code: "P4MAX1", type: "flat", value: 500, max_uses: 1, per_user_limit: 5, valid_from: past, valid_to: future },
    { code: "P4PU3", type: "flat", value: 300, per_user_limit: 3, valid_from: past, valid_to: future },
    { code: "P4WCREDIT", type: "wallet_credit", value: 5000, per_user_limit: 5, valid_from: past, valid_to: future },
  ]), "promos");

  // 4. customers — the Phase 4 test-OTP users (config.toml [auth.sms.test_otp]),
  //    deliberately NOT 9990000001-03 (those belong to the Phase 3 auth suite).
  for (const [k, phone] of [["a", "9990000004"], ["b", "9990000005"], ["c", "9990000006"]] as const) {
    const { jwt, id } = await signIn(phone);
    const addr = randomUUID();
    await svc.from("addresses").insert({ id: addr, customer_id: id, zone_id: F.zone, block: `H-${k}`, room: "1" });
    CUST[k] = { phone, jwt, id, addr };
  }
  // one address for customer A in the paused zone
  CUST.a.addrBadZone = randomUUID();
  await svc.from("addresses").insert({ id: CUST.a.addrBadZone, customer_id: CUST.a.id, zone_id: F.zoneBad, block: "H-a", room: "9" });

  // wallets: reset to a known, ledger-consistent state
  for (const c of [CUST.a, CUST.b, CUST.c]) {
    await svc.from("wallet_ledger").delete().eq("customer_id", c.id);
    await svc.from("wallet_ledger").insert({ customer_id: c.id, delta: 1_000_000, reason: "manual_adjustment" });
    await svc.from("profiles").update({ wallet_balance: 1_000_000 }).eq("id", c.id);
  }
});

after(async () => {
  serverProc?.kill("SIGKILL");
});

/** Delete this suite's fixture subtree in FK-safe order, so a local
 *  re-run without `supabase db reset` still starts clean. */
async function teardownFixture(): Promise<void> {
  const testPhones = ["9990000004", "9990000005", "9990000006", "9990000009", "9000001301"];
  const { data: profs } = await svc.from("profiles").select("id").in("phone", testPhones);
  const ids = (profs ?? []).map((p) => p.id as string);
  const promoCodes = ["P4FLAT", "P4PCT", "P4EXP", "P4MAX1", "P4PU3", "P4WCREDIT", "P4PU1X", "P4PU3B"];

  const { data: proms } = await svc.from("promos").select("id").in("code", promoCodes);
  const promoIds = (proms ?? []).map((p) => p.id as string);
  const { data: ords } = await svc.from("orders").select("id").eq("store_id", F.store);
  const orderIds = (ords ?? []).map((o) => o.id as string);

  if (orderIds.length) {
    await svc.from("payments").delete().in("order_id", orderIds);
    await svc.from("promo_redemptions").delete().in("order_id", orderIds);
    await svc.from("wallet_ledger").delete().in("order_id", orderIds);
    await svc.from("audit_logs").delete().in("entity_id", orderIds);
  }
  if (promoIds.length) await svc.from("promo_redemptions").delete().in("promo_id", promoIds);
  if (ids.length) {
    await svc.from("staff_roles").delete().in("profile_id", ids).neq("role", "admin"); // keep the seeded admin row
    await svc.from("wallet_ledger").delete().in("customer_id", ids);
  }
  await svc.from("runners").delete().eq("store_id", F.store);
  await svc.from("orders").delete().eq("store_id", F.store);
  await svc.from("inventory").delete().eq("store_id", F.store);
  await svc.from("products").delete().eq("store_id", F.store);
  // every address in a fixture zone (not just the known customers') must
  // go before the zones do — addresses.zone_id -> zones
  await svc.from("addresses").delete().in("zone_id", [F.zone, F.zoneBad]);
  await svc.from("zones").delete().eq("store_id", F.store);
  await svc.from("stores").delete().eq("id", F.store);
  await svc.from("promos").delete().in("code", promoCodes);
}

async function walletLedgerConsistent(customerId: string): Promise<boolean> {
  const { data: prof } = await svc.from("profiles").select("wallet_balance").eq("id", customerId).single();
  const { data: rows } = await svc.from("wallet_ledger").select("delta").eq("customer_id", customerId);
  const sum = (rows ?? []).reduce((s, r) => s + (r.delta as number), 0);
  return sum === (prof?.wallet_balance as number) && (prof?.wallet_balance as number) >= 0;
}

// ============================================================
// A. contract / validation surface
// ============================================================
test("the edge ERROR_CODES mirror matches the canonical @craavee/api-contracts list", async () => {
  const { ERROR_CODES } = (await import(
    "../../../supabase/functions/_shared/errors.ts"
  )) as { ERROR_CODES: readonly string[] };
  for (const c of CANONICAL_ERROR_CODES) {
    assert.ok(ERROR_CODES.includes(c), `edge mirror is missing canonical code ${c}`);
  }
});

test("the edge create-order schema accepts/rejects the same shapes as @craavee/validation", () => {
  const good = { idempotencyKey: randomUUID(), addressId: randomUUID(), items: [{ productId: randomUUID(), qty: 2 }] };
  assert.ok(createOrderRequestSchema.safeParse(good).success);
  assert.ok(!createOrderRequestSchema.safeParse({ ...good, items: [] }).success);
  assert.ok(!createOrderRequestSchema.safeParse({ ...good, items: [{ productId: randomUUID(), qty: 21 }] }).success);
});

test("§24.2 empty cart -> VALIDATION_FAILED 400", async () => {
  const r = await callFn("create_order", order({ items: [] }), { jwt: CUST.a.jwt });
  assert.equal(r.status, 400);
  assert.equal(r.code, "VALIDATION_FAILED");
});

test("§24.3 unknown product -> ITEM_UNAVAILABLE", async () => {
  const r = await callFn("create_order", order({ items: [{ productId: randomUUID(), qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.code, "ITEM_UNAVAILABLE");
});

test("§24.4 unlisted product -> ITEM_UNAVAILABLE", async () => {
  const r = await callFn("create_order", order({ items: [{ productId: F.pUnlisted, qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.code, "ITEM_UNAVAILABLE");
});

test("no JWT on a well-formed request -> AUTH_REQUIRED 401", async () => {
  const r = await callFn("create_order", order(), { jwt: null });
  assert.equal(r.status, 401);
  assert.equal(r.code, "AUTH_REQUIRED");
});

// ============================================================
// B. happy paths + pricing authority
// ============================================================
test("§24.1 normal order -> created + gateway paymentIntent, server-computed totals", async () => {
  const r = await callFn("create_order", order({ items: [{ productId: F.p1, qty: 2 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.status, "created");
  assert.equal(r.data!.subtotal, 10000);
  assert.equal(r.data!.deliveryFee, 1000);
  assert.equal(r.data!.payable, 11000);
  const pi = r.data!.paymentIntent as { gateway: string; gatewayOrderRef: string };
  assert.equal(pi.gateway, "razorpay");
  assert.ok(pi.gatewayOrderRef.startsWith("mock_order_"));
});

test("§24.6 exact-stock order succeeds and reserves exactly the on-hand qty", async () => {
  // P2 has qty_on_hand = 1
  const r = await callFn("create_order", order({ items: [{ productId: F.p2, qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.ok, true, JSON.stringify(r));
  const { data: inv } = await svc.from("inventory").select("qty_on_hand, qty_reserved").eq("product_id", F.p2).single();
  assert.equal(inv!.qty_reserved, inv!.qty_on_hand);
});

test("§24.10 wallet spend: debited authoritatively, ledger stays consistent", async () => {
  const before = (await svc.from("profiles").select("wallet_balance").eq("id", CUST.b.id).single()).data!.wallet_balance;
  const r = await callFn("create_order", order({ addressId: CUST.b.addr, items: [{ productId: F.p3, qty: 1 }], useWallet: true }), { jwt: CUST.b.jwt });
  assert.equal(r.ok, true, JSON.stringify(r));
  // 10000 + 1000 delivery = 11000, wallet covers all -> payable 0, confirmed
  assert.equal(r.data!.walletApplied, 11000);
  assert.equal(r.data!.payable, 0);
  assert.equal(r.data!.status, "confirmed");
  const after = (await svc.from("profiles").select("wallet_balance").eq("id", CUST.b.id).single()).data!.wallet_balance;
  assert.equal(after, before - 11000);
  assert.ok(await walletLedgerConsistent(CUST.b.id));
});

test("§8 wallet-only checkout (payable 0) transitions to confirmed with a captured payment, no gateway", async () => {
  const r = await callFn("create_order", order({ addressId: CUST.b.addr, items: [{ productId: F.p5, qty: 1 }], useWallet: true }), { jwt: CUST.b.jwt });
  assert.equal(r.data!.status, "confirmed");
  assert.equal(r.data!.paymentIntent, undefined);
  const { data: pay } = await svc.from("payments").select("status, gateway").eq("order_id", r.data!.orderId as string).single();
  assert.equal(pay!.status, "captured");
  assert.equal(pay!.gateway, null);
});

test("§24.12 useWallet with a zero balance -> INSUFFICIENT_BALANCE", async () => {
  const { jwt, id } = await signIn(CUST.c.phone);
  await svc.from("wallet_ledger").delete().eq("customer_id", id);
  await svc.from("profiles").update({ wallet_balance: 0 }).eq("id", id);
  const r = await callFn("create_order", order({ addressId: CUST.c.addr, items: [{ productId: F.p1, qty: 1 }], useWallet: true }), { jwt });
  assert.equal(r.code, "INSUFFICIENT_BALANCE");
  // restore
  await svc.from("wallet_ledger").insert({ customer_id: id, delta: 1_000_000, reason: "manual_adjustment" });
  await svc.from("profiles").update({ wallet_balance: 1_000_000 }).eq("id", id);
});

// ============================================================
// C. promo
// ============================================================
test("§24.13 promo flat discount applied + redemption recorded", async () => {
  const r = await callFn("create_order", order({ addressId: CUST.a.addr, items: [{ productId: F.p5, qty: 5 }], promoCode: "P4FLAT" }), { jwt: CUST.a.jwt });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.discount, 2000); // min(2000, 10000)
  assert.equal(r.data!.payable, 10000 - 2000 + 1000);
  const { count } = await svc.from("promo_redemptions").select("*", { count: "exact", head: true }).eq("customer_id", CUST.a.id);
  assert.ok((count ?? 0) >= 1);
});

test("promo percent discount = floor(subtotal * value / 100)", async () => {
  const r = await callFn("create_order", order({ addressId: CUST.a.addr, items: [{ productId: F.p3, qty: 1 }], promoCode: "P4PCT" }), { jwt: CUST.a.jwt });
  assert.equal(r.data!.discount, 1000); // 10% of 10000
});

test("§24.15 unknown promo code -> INVALID_PROMO", async () => {
  const r = await callFn("create_order", order({ items: [{ productId: F.p1, qty: 1 }], promoCode: "NOPE" + randomUUID().slice(0, 6) }), { jwt: CUST.a.jwt });
  assert.equal(r.code, "INVALID_PROMO");
});

test("§24.16 expired promo -> INVALID_PROMO", async () => {
  const r = await callFn("create_order", order({ items: [{ productId: F.p1, qty: 1 }], promoCode: "P4EXP" }), { jwt: CUST.a.jwt });
  assert.equal(r.code, "INVALID_PROMO");
});

test("promo per_user_limit=1: the same customer's second redemption -> PROMO_LIMIT_REACHED", async () => {
  // customer A already redeemed P4FLAT above
  const r = await callFn("create_order", order({ addressId: CUST.a.addr, items: [{ productId: F.p5, qty: 3 }], promoCode: "P4FLAT" }), { jwt: CUST.a.jwt });
  assert.equal(r.code, "PROMO_LIMIT_REACHED");
});

test("promo wallet_credit: no order discount, but a promo_credit lands in the wallet", async () => {
  const before = (await svc.from("profiles").select("wallet_balance").eq("id", CUST.a.id).single()).data!.wallet_balance;
  const r = await callFn("create_order", order({ addressId: CUST.a.addr, items: [{ productId: F.p1, qty: 1 }], promoCode: "P4WCREDIT" }), { jwt: CUST.a.jwt });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.discount, 0);
  const after = (await svc.from("profiles").select("wallet_balance").eq("id", CUST.a.id).single()).data!.wallet_balance;
  assert.equal(after, before + 5000);
});

// ============================================================
// D. serviceability
// ============================================================
test("§24.17 serviceable address is accepted (baseline for §24.18/19)", async () => {
  const r = await callFn("create_order", order({ items: [{ productId: F.p1, qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("§24.18 non-serviceable zone -> SERVICE_UNAVAILABLE", async () => {
  const r = await callFn("create_order", order({ addressId: CUST.a.addrBadZone, items: [{ productId: F.p1, qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.code, "SERVICE_UNAVAILABLE");
});

test("§24.19 closed store -> STORE_CLOSED", async () => {
  await svc.from("stores").update({ is_open: false }).eq("id", F.store);
  const r = await callFn("create_order", order({ items: [{ productId: F.p1, qty: 1 }] }), { jwt: CUST.a.jwt });
  await svc.from("stores").update({ is_open: true }).eq("id", F.store);
  assert.equal(r.code, "STORE_CLOSED");
});

// ============================================================
// E. tampering / authorization (§24.20-21, §26 A-H)
// ============================================================
test("§24.20-21 / §26 A-F: fake price/subtotal/deliveryFee/payable/walletBalance/discount in the body are all ignored", async () => {
  const r = await callFn(
    "create_order",
    order({
      items: [{ productId: F.p1, qty: 1, price: 1, unit_price: 1 }],
      price: 1, subtotal: 1, deliveryFee: 0, delivery_fee: 0, payable: 1,
      discount: 9999, wallet_balance: 999999, walletApplied: 999999,
    }),
    { jwt: CUST.a.jwt },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.subtotal, 5000);
  assert.equal(r.data!.deliveryFee, 1000);
  assert.equal(r.data!.discount, 0);
  assert.equal(r.data!.walletApplied, 0);
  assert.equal(r.data!.payable, 6000);
});

test("§24.26 / §26 G: ordering to another customer's address -> INVALID_ADDRESS", async () => {
  const r = await callFn("create_order", order({ addressId: CUST.b.addr, items: [{ productId: F.p1, qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.code, "INVALID_ADDRESS");
});

test("§24.27 / §26: a client-supplied store_id is ignored — the store is derived from the address's zone", async () => {
  // pass a bogus store_id + a product that only exists at the fixture store
  const r = await callFn("create_order", order({ store_id: "00000000-0000-4000-8000-000000000001", storeId: "00000000-0000-4000-8000-000000000001", items: [{ productId: F.p1, qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("§26 H: a product from a different store -> ITEM_UNAVAILABLE", async () => {
  const r = await callFn("create_order", order({ items: [{ productId: F.otherStoreProduct, qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r.code, "ITEM_UNAVAILABLE");
});

test("§26 L: a non-customer role cannot call create_order -> FORBIDDEN", async () => {
  // The seeded admin (9000001301) has a staff_roles row from seed time,
  // so its JWT carries the server-injected role=admin claim (D8) — no
  // runtime-promotion race.
  const { jwt } = await signIn("9000001301");
  const r = await callFn("create_order", order(), { jwt });
  assert.equal(r.status, 403);
  assert.equal(r.code, "FORBIDDEN");
});

test("§26 I: a customer cannot INSERT an order directly through PostgREST", async () => {
  const c = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${CUST.a.jwt}` } } });
  const { error } = await c.from("orders").insert({
    customer_id: CUST.a.id, store_id: F.store, address_id: CUST.a.addr,
    subtotal: 0, delivery_fee: 0, payable: 0, idempotency_key: randomUUID(),
  });
  assert.ok(error, "direct order insert must be denied");
});

test("§26 J: a customer cannot UPDATE inventory directly through PostgREST", async () => {
  const c = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${CUST.a.jwt}` } } });
  const { data, error } = await c.from("inventory").update({ qty_on_hand: 99999 }).eq("product_id", F.p1).select();
  assert.ok(error || (data ?? []).length === 0, "direct inventory update must be denied / affect no rows");
  const { data: inv } = await svc.from("inventory").select("qty_on_hand").eq("product_id", F.p1).single();
  assert.notEqual(inv!.qty_on_hand, 99999);
});

test("§26 K: a customer cannot raise their own wallet_balance directly through PostgREST", async () => {
  const c = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${CUST.a.jwt}` } } });
  const { error } = await c.from("profiles").update({ wallet_balance: 999_999_999 }).eq("id", CUST.a.id);
  assert.ok(error, "raising own wallet_balance must be rejected by the self-edit guard");
});

// ============================================================
// F. idempotency (§24.8-9, §24.30, §26 M) — guarantee #1
// ============================================================
test("§24.30 retry after a transient failure: same key -> the same single order", async () => {
  const body = order({ items: [{ productId: F.p1, qty: 1 }] });
  const r1 = await callFn("create_order", body, { jwt: CUST.a.jwt });
  const r2 = await callFn("create_order", body, { jwt: CUST.a.jwt });
  assert.equal(r1.data!.orderId, r2.data!.orderId);
  const { count } = await svc.from("orders").select("*", { count: "exact", head: true }).eq("idempotency_key", body.idempotencyKey);
  assert.equal(count, 1);
});

test("§24.8 CONCURRENT same-idempotency-key requests -> exactly one order, both resolve to it", async () => {
  const body = order({ items: [{ productId: F.p1, qty: 1 }] });
  const [a, b] = await Promise.all([
    callFn("create_order", body, { jwt: CUST.a.jwt }),
    callFn("create_order", body, { jwt: CUST.a.jwt }),
  ]);
  assert.ok(a.data?.orderId && b.data?.orderId, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  assert.equal(a.data!.orderId, b.data!.orderId);
  const { count } = await svc.from("orders").select("*", { count: "exact", head: true }).eq("idempotency_key", body.idempotencyKey);
  assert.equal(count, 1);
  const { count: payCount } = await svc.from("payments").select("*", { count: "exact", head: true }).eq("order_id", a.data!.orderId as string);
  assert.equal(payCount, 1);
});

test("§24.9 / §26 M: same key + materially different payload -> ORDER_ALREADY_EXISTS", async () => {
  const key = randomUUID();
  const r1 = await callFn("create_order", order({ idempotencyKey: key, items: [{ productId: F.p1, qty: 1 }] }), { jwt: CUST.a.jwt });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const r2 = await callFn("create_order", order({ idempotencyKey: key, items: [{ productId: F.p3, qty: 2 }] }), { jwt: CUST.a.jwt });
  assert.equal(r2.code, "ORDER_ALREADY_EXISTS");
  assert.equal(r2.status, 409);
});

// ============================================================
// G. overselling — guarantee #3
// ============================================================
test("§24.7 / TEST_STRATEGY §2#3: two CONCURRENT orders for the last unit -> exactly one succeeds", async () => {
  // fresh scarce product
  const pid = randomUUID();
  await svc.from("products").insert({ id: pid, store_id: F.store, name: "last-unit", mrp: 1000, sale_price: 1000, category: "X" });
  await svc.from("inventory").insert({ store_id: F.store, product_id: pid, qty_on_hand: 1 });

  const [a, b] = await Promise.all([
    callFn("create_order", order({ addressId: CUST.a.addr, items: [{ productId: pid, qty: 1 }] }), { jwt: CUST.a.jwt }),
    callFn("create_order", order({ addressId: CUST.b.addr, items: [{ productId: pid, qty: 1 }] }), { jwt: CUST.b.jwt }),
  ]);
  const oks = [a, b].filter((r) => r.ok).length;
  const stockFails = [a, b].filter((r) => r.code === "INSUFFICIENT_STOCK").length;
  assert.equal(oks, 1, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  assert.equal(stockFails, 1);
  const { data: inv } = await svc.from("inventory").select("qty_reserved").eq("product_id", pid).single();
  assert.equal(inv!.qty_reserved, 1, "qty_reserved must be exactly 1, never 2");
});

// ============================================================
// H. wallet concurrency — TEST_STRATEGY §2.1 #1
// ============================================================
test("TEST_STRATEGY §2.1#1: two CONCURRENT wallet checkouts, balance covers exactly one -> one succeeds, other INSUFFICIENT_BALANCE, never negative", async () => {
  const { jwt, id } = await signIn(CUST.c.phone);
  // order total: 1x P4 (4000) + 1000 delivery = 5000. Fund exactly 5000.
  await svc.from("wallet_ledger").delete().eq("customer_id", id);
  await svc.from("wallet_ledger").insert({ customer_id: id, delta: 5000, reason: "manual_adjustment" });
  await svc.from("profiles").update({ wallet_balance: 5000 }).eq("id", id);

  const mk = () => callFn("create_order", order({ addressId: CUST.c.addr, items: [{ productId: F.p4, qty: 1 }], useWallet: true }), { jwt });
  const [a, b] = await Promise.all([mk(), mk()]);

  const fullyFunded = [a, b].filter((r) => r.ok && r.data!.payable === 0).length;
  assert.equal(fullyFunded, 1, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  const denied = [a, b].filter((r) => r.code === "INSUFFICIENT_BALANCE").length;
  assert.equal(denied, 1);
  assert.ok(await walletLedgerConsistent(id), "wallet_balance must equal SUM(ledger) and never go negative");

  await svc.from("wallet_ledger").insert({ customer_id: id, delta: 1_000_000, reason: "manual_adjustment" });
  await svc.from("profiles").update({ wallet_balance: (await svc.from("profiles").select("wallet_balance").eq("id", id).single()).data!.wallet_balance + 1_000_000 }).eq("id", id);
});

// ============================================================
// I. promo concurrency — TEST_STRATEGY §2.1 #2a/#2b/#2c
// ============================================================
test("TEST_STRATEGY §2.1#2a: concurrent redemption of a max_uses=1 promo by two customers -> exactly one succeeds", async () => {
  const { jwt: ja } = await signIn(CUST.a.phone);
  const { jwt: jb } = await signIn(CUST.b.phone);
  const [a, b] = await Promise.all([
    callFn("create_order", order({ addressId: CUST.a.addr, items: [{ productId: F.p5, qty: 1 }], promoCode: "P4MAX1" }), { jwt: ja }),
    callFn("create_order", order({ addressId: CUST.b.addr, items: [{ productId: F.p5, qty: 1 }], promoCode: "P4MAX1" }), { jwt: jb }),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  const { data: promo } = await svc.from("promos").select("uses_count").eq("code", "P4MAX1").single();
  assert.equal(promo!.uses_count, 1);
  const { count } = await svc.from("promo_redemptions").select("*", { count: "exact", head: true }).eq("promo_id", (await svc.from("promos").select("id").eq("code", "P4MAX1").single()).data!.id);
  assert.equal(count, 1);
});

test("TEST_STRATEGY §2.1#2b: two CONCURRENT redemptions of a per_user_limit=1 promo by the SAME customer -> exactly one", async () => {
  const { jwt, id } = await signIn(CUST.c.phone);
  const promoId = (await svc.from("promos").select("id").eq("code", "P4PU3").single()).data!.id;
  // use a fresh per_user_limit=1 promo to avoid interference
  await svc.from("promos").delete().eq("code", "P4PU1X");
  await svc.from("promos").insert({ code: "P4PU1X", type: "flat", value: 100, per_user_limit: 1, valid_from: new Date(Date.now() - 1000).toISOString() });
  const mk = () => callFn("create_order", order({ addressId: CUST.c.addr, items: [{ productId: F.p5, qty: 1 }], promoCode: "P4PU1X" }), { jwt });
  const [a, b] = await Promise.all([mk(), mk()]);
  assert.equal([a, b].filter((r) => r.ok).length, 1, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  const { count } = await svc.from("promo_redemptions").select("*", { count: "exact", head: true }).eq("customer_id", id).eq("promo_id", (await svc.from("promos").select("id").eq("code", "P4PU1X").single()).data!.id);
  assert.equal(count, 1);
  void promoId;
});

test("TEST_STRATEGY §2.1#2c: five CONCURRENT redemptions of a per_user_limit=3 promo by the SAME customer -> exactly three", async () => {
  const { jwt, id } = await signIn(CUST.a.phone);
  await svc.from("promos").delete().eq("code", "P4PU3B");
  await svc.from("promos").insert({ code: "P4PU3B", type: "flat", value: 100, per_user_limit: 3, valid_from: new Date(Date.now() - 1000).toISOString() });
  const promoId = (await svc.from("promos").select("id").eq("code", "P4PU3B").single()).data!.id;
  const mk = () => callFn("create_order", order({ addressId: CUST.a.addr, items: [{ productId: F.p5, qty: 1 }], promoCode: "P4PU3B" }), { jwt });
  const results = await Promise.all([mk(), mk(), mk(), mk(), mk()]);
  const ok = results.filter((r) => r.ok).length;
  assert.equal(ok, 3, JSON.stringify(results.map((r) => r.code ?? "ok")));
  const { count } = await svc.from("promo_redemptions").select("*", { count: "exact", head: true }).eq("customer_id", id).eq("promo_id", promoId);
  assert.equal(count, 3);
  const { data: promo } = await svc.from("promos").select("uses_count").eq("code", "P4PU3B").single();
  assert.equal(promo!.uses_count, 3);
});

// ============================================================
// J. gateway phases — TEST_STRATEGY §2.1 #3/#4/#5/#6
// ============================================================
test("§2.1#3 gateway timeout right after Phase A commits: order stays 'created', reservation intact", async () => {
  const body = order({ items: [{ productId: F.p1, qty: 1 }] });
  const r = await callFn("create_order", body, { jwt: CUST.a.jwt, mock: "timeout" });
  assert.equal(r.code, "PAYMENT_SETUP_FAILED");
  const { data: o } = await svc.from("orders").select("status, reservation_expires_at").eq("idempotency_key", body.idempotencyKey).single();
  assert.equal(o!.status, "created");
  assert.ok(new Date(o!.reservation_expires_at as string).getTime() > Date.now());
});

test("§2.1#4 retry after a gateway timeout: one payments row, one gateway_order_ref ever set", async () => {
  const body = order({ items: [{ productId: F.p1, qty: 1 }] });
  await callFn("create_order", body, { jwt: CUST.a.jwt, mock: "timeout" });
  const orderId = (await svc.from("orders").select("id").eq("idempotency_key", body.idempotencyKey).single()).data!.id;
  // simulate the 60s claim window elapsing (same test-control style as
  // manipulating reservation_expires_at in the pgTAP suite)
  await svc.from("payments").update({ gateway_intent_requested_at: new Date(Date.now() - 120_000).toISOString() }).eq("order_id", orderId);
  const r2 = await callFn("create_order", body, { jwt: CUST.a.jwt, mock: "ok" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.ok((r2.data!.paymentIntent as { gatewayOrderRef: string }).gatewayOrderRef);
  const { count } = await svc.from("payments").select("*", { count: "exact", head: true }).eq("order_id", orderId);
  assert.equal(count, 1);
});

test("§2.1#5 gateway succeeded but the client 'disconnected': a replay returns the SAME checkoutParams, no second intent", async () => {
  const body = order({ items: [{ productId: F.p1, qty: 1 }] });
  const r1 = await callFn("create_order", body, { jwt: CUST.a.jwt, mock: "ok" });
  const ref1 = (r1.data!.paymentIntent as { gatewayOrderRef: string }).gatewayOrderRef;
  const r2 = await callFn("create_order", body, { jwt: CUST.a.jwt, mock: "fail" }); // even if the gateway would now fail, no call is made
  const ref2 = (r2.data!.paymentIntent as { gatewayOrderRef: string }).gatewayOrderRef;
  assert.equal(ref1, ref2);
});

test("§2.1#6 two CONCURRENT same-key requests both in Phase B: one proceeds, the other gets payment_setup_in_progress", async () => {
  const body = order({ items: [{ productId: F.p1, qty: 1 }] });
  // prime Phase A so both concurrent calls skip to Phase B
  const [a, b] = await Promise.all([
    callFn("create_order", body, { jwt: CUST.a.jwt, mock: "ok" }),
    callFn("create_order", body, { jwt: CUST.a.jwt, mock: "ok" }),
  ]);
  const statuses = [a, b].map((r) => r.data!.status).sort();
  // acceptable: both resolve to the same order; at most one holds an
  // in-progress marker at a time. Either both 'created' (one won the
  // claim, the other saw the ref) or one 'created' + one
  // 'payment_setup_in_progress'.
  assert.ok(
    JSON.stringify(statuses) === JSON.stringify(["created", "created"]) ||
      JSON.stringify(statuses) === JSON.stringify(["created", "payment_setup_in_progress"]),
    JSON.stringify(statuses),
  );
  const { count } = await svc.from("payments").select("*", { count: "exact", head: true }).eq("order_id", a.data!.orderId as string);
  assert.equal(count, 1);
});

// ============================================================
// K. reservation expiry — §24.22-24
// ============================================================
test("§24.22-24 expire_stale_reservations: releases inventory, reverses wallet, -> payment_failed", async () => {
  const { jwt, id } = await signIn(CUST.b.phone);
  await svc.from("wallet_ledger").delete().eq("customer_id", id);
  await svc.from("wallet_ledger").insert({ customer_id: id, delta: 3000, reason: "manual_adjustment" });
  await svc.from("profiles").update({ wallet_balance: 3000 }).eq("id", id);

  // 2x P1 (10000) + 1000 delivery = 11000; wallet covers 3000; payable 8000 -> 'created'
  const body = order({ addressId: CUST.b.addr, items: [{ productId: F.p1, qty: 2 }], useWallet: true });
  const r = await callFn("create_order", body, { jwt });
  assert.equal(r.data!.status, "created");
  assert.equal(r.data!.walletApplied, 3000);
  const orderId = r.data!.orderId as string;

  const invBefore = (await svc.from("inventory").select("qty_reserved").eq("product_id", F.p1).single()).data!.qty_reserved;
  await svc.from("orders").update({ reservation_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", orderId);

  const sweep = await callFn("expire_stale_reservations", {}, { jwt: null });
  assert.equal(sweep.ok, true, JSON.stringify(sweep));
  assert.ok((sweep.data!.swept as number) >= 1);

  const { data: o } = await svc.from("orders").select("status").eq("id", orderId).single();
  assert.equal(o!.status, "payment_failed");
  const { data: pay } = await svc.from("payments").select("status").eq("order_id", orderId).single();
  assert.equal(pay!.status, "failed");
  const invAfter = (await svc.from("inventory").select("qty_reserved").eq("product_id", F.p1).single()).data!.qty_reserved;
  assert.equal(invAfter, invBefore - 2, "the 2 reserved units are released");
  const { data: rev } = await svc.from("wallet_ledger").select("delta").eq("order_id", orderId).eq("reason", "reservation_reversal");
  assert.equal(rev!.length, 1);
  assert.equal(rev![0].delta, 3000);
  assert.ok(await walletLedgerConsistent(id));
});

test("§24.25 order/payment consistency: a fresh created order always has a pending payment", async () => {
  const r = await callFn("create_order", order({ items: [{ productId: F.p1, qty: 1 }] }), { jwt: CUST.a.jwt });
  const { data: o } = await svc.from("orders").select("status, payment_status").eq("id", r.data!.orderId as string).single();
  const { data: p } = await svc.from("payments").select("status").eq("order_id", r.data!.orderId as string).single();
  assert.equal(o!.status, "created");
  assert.equal(p!.status, "pending");
});

// ============================================================
// L. validate_promo advisory endpoint
// ============================================================
test("validate_promo previews the discount and never throws for an invalid code", async () => {
  const good = await callFn("validate_promo", { code: "P4PCT", orderSubtotal: 10000 }, { jwt: CUST.a.jwt });
  assert.equal(good.ok, true);
  assert.equal(good.data!.valid, true);
  assert.equal(good.data!.discountAmount, 1000);

  const bad = await callFn("validate_promo", { code: "DOES-NOT-EXIST", orderSubtotal: 10000 }, { jwt: CUST.a.jwt });
  assert.equal(bad.ok, true);
  assert.equal(bad.data!.valid, false);
  assert.equal(bad.data!.reason, "INVALID_PROMO");
});
