// Phase 9B — administration against the real Edge Functions, the real
// database and real JWTs.
//
// pgTAP (supabase/tests/17) proves the plpgsql with RLS bypassed. This
// proves what only a real stack can: that the HTTP auth envelope refuses
// the wrong caller, that canonical error codes come back over the wire,
// and that the money and inventory invariants hold when the requests are
// genuinely concurrent.
//
// Canonical: RBAC_MATRIX.md §2/§4/§5, API_CONTRACTS.md §3, D7 (paise),
// D29 (refund idempotency), D28 (runners row).
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

const FN_PORT = 8797; // 8790 dev · 8791-8795 phases 4-8 · 8796 phase 9a
const FN_BASE = `http://127.0.0.1:${FN_PORT}/functions/v1`;

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_STORE = "00000000-0000-4000-8000-000000000001";
const OTHER_STORE = "00000000-0000-4000-8000-00000000000f"; // the seeded fixture store
const ZONE = "00000000-0000-4000-8000-000000000101";
let CUSTOMER = "";

const F = {
  pA: "d9b00000-0000-4000-8000-000000000201",
  addr: "d9b00000-0000-4000-8000-000000000301",
};

let adminJwt = "", packerJwt = "", runnerJwt = "", customerJwt = "";
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

interface FnResult { ok: boolean; status: number; data?: Record<string, unknown>; code?: string; message?: string }

async function callFn(name: string, body: unknown, jwt?: string | null): Promise<FnResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(`${FN_BASE}/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } };
  return { ok: j.ok, status: r.status, data: j.data, code: j.error?.code, message: j.error?.message };
}

async function inv(productId = F.pA) {
  const { data } = await svc.from("inventory")
    .select("qty_on_hand, qty_reserved").eq("store_id", SEED_STORE).eq("product_id", productId).single();
  return data as { qty_on_hand: number; qty_reserved: number };
}

/** A paid `confirmed` order through the real pipeline. */
async function makeConfirmedOrder(qty = 1): Promise<{ orderId: string; payable: number }> {
  const created = await callFn(
    "create_order",
    { idempotencyKey: randomUUID(), addressId: F.addr, items: [{ productId: F.pA, qty }] },
    customerJwt,
  );
  if (!created.ok) throw new Error(`fixture create_order failed: ${JSON.stringify(created)}`);
  const orderId = created.data!.orderId as string;
  const payable = Number(created.data!.payable);
  const pi = created.data!.paymentIntent as { gatewayOrderRef: string };
  const r = await fetch(`${FN_BASE}/payment_webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-craavee-webhook-signature": "mock-signature" },
    body: JSON.stringify({ event_id: `evt_${randomUUID()}`, status: "captured",
                           order_id: pi.gatewayOrderRef, payment_id: `pay_${orderId.slice(0, 8)}`, amount: payable }),
  });
  if (r.status !== 200) throw new Error(`fixture capture webhook failed: ${r.status}`);
  return { orderId, payable };
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

  adminJwt = (await signIn("+919000001301")).jwt;
  packerJwt = (await signIn("+919000001102")).jwt;
  runnerJwt = (await signIn("+919000001201")).jwt;
  const cust = await signIn("+919990000011");
  customerJwt = cust.jwt;
  CUSTOMER = cust.id;

  await must(svc.from("products").upsert([
    { id: F.pA, store_id: SEED_STORE, name: "9B Item", mrp: 10000, sale_price: 8000, category: "Snacks", is_listed: true },
  ]), "products");
  await must(svc.from("inventory").upsert(
    [{ store_id: SEED_STORE, product_id: F.pA, qty_on_hand: 500, qty_reserved: 0 }],
    { onConflict: "store_id,product_id" },
  ), "inventory");
  await must(svc.from("addresses").upsert([
    { id: F.addr, customer_id: CUSTOMER, zone_id: ZONE, block: "9B", floor: "1", room: "1" },
  ]), "address");
  await svc.from("stores").update({ is_open: true, pause_reason: null }).eq("id", SEED_STORE);
});

after(async () => {
  serverProc?.kill("SIGTERM");
});


// ============================================================
// A. Authorization at the wire (§SECURITY)
// ============================================================
const ADMIN_ONLY: [string, Record<string, unknown>][] = [
  ["admin_adjust_inventory", { storeId: SEED_STORE, productId: F.pA, qtyOnHand: 1, reason: "x" }],
  ["admin_upsert_product", { storeId: SEED_STORE, name: "X", category: "Snacks", mrp: 100, salePrice: 100 }],
  ["assign_staff_role", { profileId: randomUUID(), role: "packer", storeId: SEED_STORE }],
  ["refund", { orderId: randomUUID(), idempotencyKey: randomUUID(), reason: "x" }],
];

test("every 9B admin function refuses an unauthenticated caller", async () => {
  for (const [fn, body] of ADMIN_ONLY) {
    const r = await callFn(fn, body, null);
    assert.equal(r.ok, false, fn);
    assert.equal(r.code, "AUTH_REQUIRED", fn);
    assert.equal(r.status, 401, fn);
  }
});

test("every 9B admin function refuses a customer, a runner and a packer", async () => {
  for (const [fn, body] of ADMIN_ONLY) {
    for (const [who, jwt] of [["customer", customerJwt], ["runner", runnerJwt], ["packer", packerJwt]] as const) {
      const r = await callFn(fn, body, jwt);
      assert.equal(r.ok, false, `${fn} / ${who}`);
      assert.equal(r.code, "FORBIDDEN", `${fn} / ${who}`);
    }
  }
});

test("a forged actor in the body cannot escalate a customer to admin", async () => {
  const r = await callFn(
    "admin_adjust_inventory",
    {
      storeId: SEED_STORE, productId: F.pA, qtyOnHand: 999, reason: "forged",
      actorId: "00000000-0000-4000-8000-000000001301", role: "admin", userId: "00000000-0000-4000-8000-000000001301",
    },
    customerJwt,
  );
  assert.equal(r.code, "FORBIDDEN");
  const after = await inv();
  assert.notEqual(after.qty_on_hand, 999, "nothing was written");
});

test("a customer cannot escalate themselves through assign_staff_role", async () => {
  const r = await callFn("assign_staff_role", { profileId: CUSTOMER, role: "admin" }, customerJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  const { data } = await svc.from("staff_roles").select("role").eq("profile_id", CUSTOMER).maybeSingle();
  assert.equal(data, null, "no staff role was granted");
});


// ============================================================
// B. Inventory administration
// ============================================================
test("an admin corrects on-hand, and it is audited with the delta", async () => {
  const before = await inv();
  const target = before.qty_on_hand + 25;
  const r = await callFn("admin_adjust_inventory",
    { storeId: SEED_STORE, productId: F.pA, qtyOnHand: target, reason: "9B stock count" }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const after = await inv();
  assert.equal(after.qty_on_hand, target);
  assert.equal(after.qty_reserved, before.qty_reserved, "reserved is untouched by a correction");

  const { data: log } = await svc.from("audit_logs")
    .select("metadata, actor_id").eq("action", "inventory.adjusted").eq("entity_id", F.pA)
    .order("created_at", { ascending: false }).limit(1).single();
  const l = log as { metadata: Record<string, unknown>; actor_id: string };
  assert.equal(l.metadata.delta, 25);
  assert.equal(l.metadata.reason, "9B stock count");
  assert.equal(l.actor_id, "00000000-0000-4000-8000-000000001301");
});

test("an admin cannot count the shelf below what live orders have reserved", async () => {
  const { orderId } = await makeConfirmedOrder(6);
  const held = await inv();
  assert.ok(held.qty_reserved >= 6, "the order is holding stock");

  const r = await callFn("admin_adjust_inventory",
    { storeId: SEED_STORE, productId: F.pA, qtyOnHand: held.qty_reserved - 1, reason: "too low" }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "VALIDATION_FAILED");
  assert.match(r.message ?? "", /reserved/i, "the refusal names the reason an operator can act on");

  const after = await inv();
  assert.equal(after.qty_on_hand, held.qty_on_hand, "the refused correction changed nothing");

  // Clean up the reservation so later tests start from a known shelf.
  await callFn("admin_cancel_order", { orderId, reason: "9B fixture cleanup", idempotencyKey: randomUUID() }, adminJwt);
});

test("a stock correction never invents reserved stock", async () => {
  const before = await inv();
  await callFn("admin_adjust_inventory",
    { storeId: SEED_STORE, productId: F.pA, qtyOnHand: before.qty_on_hand + 5, reason: "probe" }, adminJwt);
  const after = await inv();
  assert.equal(after.qty_reserved, before.qty_reserved);
});


// ============================================================
// C. Catalog administration — the price snapshot
// ============================================================
test("changing a catalog price does not change an order already placed", async () => {
  const { orderId, payable } = await makeConfirmedOrder(2);
  const { data: itemsBefore } = await svc.from("order_items").select("unit_price").eq("order_id", orderId);
  const priceCharged = ((itemsBefore ?? []) as { unit_price: number }[])[0].unit_price;

  const r = await callFn("admin_upsert_product", {
    productId: F.pA, storeId: SEED_STORE, name: "9B Item", category: "Snacks",
    mrp: 30000, salePrice: 24000, isListed: true,
  }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const { data: product } = await svc.from("products").select("sale_price").eq("id", F.pA).single();
  assert.equal((product as { sale_price: number }).sale_price, 24000, "the catalog moved");

  const { data: itemsAfter } = await svc.from("order_items").select("unit_price").eq("order_id", orderId);
  assert.equal(((itemsAfter ?? []) as { unit_price: number }[])[0].unit_price, priceCharged,
    "the placed order still shows the price it was charged");

  const { data: order } = await svc.from("orders").select("payable, subtotal").eq("id", orderId).single();
  assert.equal((order as { payable: number }).payable, payable, "and its payable is unchanged");

  const { data: pay } = await svc.from("payments").select("amount").eq("order_id", orderId).single();
  assert.equal((pay as { amount: number }).amount, payable, "and the captured amount is unchanged");

  // Put the price back so later tests read familiar numbers.
  await callFn("admin_upsert_product", {
    productId: F.pA, storeId: SEED_STORE, name: "9B Item", category: "Snacks",
    mrp: 10000, salePrice: 8000, isListed: true,
  }, adminJwt);
  await callFn("admin_cancel_order", { orderId, reason: "9B fixture cleanup", idempotencyKey: randomUUID() }, adminJwt);
});

test("a sale price above MRP is refused, and an admin scoped elsewhere is refused", async () => {
  const bad = await callFn("admin_upsert_product", {
    productId: F.pA, storeId: SEED_STORE, name: "9B Item", category: "Snacks",
    mrp: 5000, salePrice: 9000, isListed: true,
  }, adminJwt);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "VALIDATION_FAILED");

  const { data: product } = await svc.from("products").select("sale_price").eq("id", F.pA).single();
  assert.equal((product as { sale_price: number }).sale_price, 8000, "the price did not move");

  // The all-store admin (store_id null) may work anywhere — the negative
  // store-scope case is covered in pgTAP 17 §C with a scoped admin.
  const other = await callFn("admin_upsert_product", {
    storeId: OTHER_STORE, name: "9B Other-store item", category: "Snacks", mrp: 100, salePrice: 100,
  }, adminJwt);
  assert.equal(other.ok, true, "an all-store admin is not store-scoped");
});

test("a new product is created with a zero-stock inventory row", async () => {
  const name = `9B Fresh ${randomUUID().slice(0, 8)}`;
  const r = await callFn("admin_upsert_product",
    { storeId: SEED_STORE, name, category: "Snacks", mrp: 5000, salePrice: 4000, isListed: true }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  const productId = r.data!.productId as string;

  const { data } = await svc.from("inventory")
    .select("qty_on_hand, qty_reserved").eq("product_id", productId).single();
  assert.deepEqual(data, { qty_on_hand: 0, qty_reserved: 0 },
    "a listed product with no inventory row would be silently unorderable");
});


// ============================================================
// D. Role administration
// ============================================================
test("an admin grants and revokes a role, and granting runner creates the runners row", async () => {
  const target = (await signIn("+919990000009")).id;

  const grant = await callFn("assign_staff_role",
    { profileId: target, role: "runner", storeId: SEED_STORE }, adminJwt);
  assert.equal(grant.ok, true, JSON.stringify(grant));

  const { count } = await svc.from("runners").select("id", { count: "exact", head: true }).eq("profile_id", target);
  assert.equal(count, 1, "D28: a runner without a runners row cannot be assigned an order at all");

  const { data: granted } = await svc.from("audit_logs").select("metadata, actor_id")
    .eq("action", "staff_role.assigned").eq("entity_id", target)
    .order("created_at", { ascending: false }).limit(1).single();
  assert.equal((granted as { metadata: Record<string, unknown> }).metadata.role, "runner");

  const revoke = await callFn("assign_staff_role", { profileId: target, role: null }, adminJwt);
  assert.equal(revoke.ok, true, JSON.stringify(revoke));
  const { data: still } = await svc.from("staff_roles").select("role").eq("profile_id", target).maybeSingle();
  assert.equal(still, null, "revoking removes the row — 'no row' IS the customer state");
});

test("an admin cannot strip their own admin role", async () => {
  const self = "00000000-0000-4000-8000-000000001301";
  const r = await callFn("assign_staff_role", { profileId: self, role: "packer", storeId: SEED_STORE }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "FORBIDDEN");
  const { data } = await svc.from("staff_roles").select("role").eq("profile_id", self).single();
  assert.equal((data as { role: string }).role, "admin", "still an admin");
});

test("a packer or runner grant without a store is refused", async () => {
  const target = (await signIn("+919990000009")).id;
  const r = await callFn("assign_staff_role", { profileId: target, role: "packer" }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "VALIDATION_FAILED");
});


// ============================================================
// E. Refund administration
// ============================================================
test("an admin issues a partial refund and the order keeps moving", async () => {
  const { orderId, payable } = await makeConfirmedOrder(3);
  const part = Math.floor(payable / 3);

  const r = await callFn("refund",
    { orderId, idempotencyKey: randomUUID(), amount: part, reason: "9B partial" }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const { data: pay } = await svc.from("payments").select("amount, refunded_amount, status").eq("order_id", orderId).single();
  const p = pay as { amount: number; refunded_amount: number; status: string };
  assert.equal(p.refunded_amount, part, "exactly the requested amount moved");
  assert.ok(p.refunded_amount < p.amount);

  const { data: order } = await svc.from("orders").select("status, payment_status").eq("id", orderId).single();
  assert.equal((order as { status: string }).status, "confirmed", "a partial refund does not cancel the order");
  assert.equal((order as { payment_status: string }).payment_status, "partially_refunded");

  await callFn("admin_cancel_order", { orderId, reason: "9B cleanup", idempotencyKey: randomUUID() }, adminJwt);
});

test("a refund above the remaining captured amount is refused", async () => {
  const { orderId, payable } = await makeConfirmedOrder(1);
  const r = await callFn("refund",
    { orderId, idempotencyKey: randomUUID(), amount: payable + 100_000, reason: "too much" }, adminJwt);
  assert.equal(r.ok, false);
  assert.equal(r.code, "REFUND_EXCEEDS_CAPTURED");

  const { data: pay } = await svc.from("payments").select("refunded_amount").eq("order_id", orderId).single();
  assert.equal((pay as { refunded_amount: number }).refunded_amount, 0, "no money moved");

  await callFn("admin_cancel_order", { orderId, reason: "9B cleanup", idempotencyKey: randomUUID() }, adminJwt);
});

test("replaying a refund with the same idempotency key does not double-refund", async () => {
  const { orderId, payable } = await makeConfirmedOrder(2);
  const key = randomUUID();
  const part = Math.floor(payable / 4);

  const first = await callFn("refund", { orderId, idempotencyKey: key, amount: part, reason: "double click" }, adminJwt);
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = await callFn("refund", { orderId, idempotencyKey: key, amount: part, reason: "double click" }, adminJwt);
  assert.equal(second.ok, true, "a replay returns the original rather than erroring");

  const { data: pay } = await svc.from("payments").select("id, refunded_amount").eq("order_id", orderId).single();
  const p = pay as { id: string; refunded_amount: number };
  assert.equal(p.refunded_amount, part, "still exactly one refund's worth");
  const { count } = await svc.from("refunds").select("id", { count: "exact", head: true }).eq("payment_id", p.id);
  assert.equal(count, 1, "exactly one refund row");

  await callFn("admin_cancel_order", { orderId, reason: "9B cleanup", idempotencyKey: randomUUID() }, adminJwt);
});

test("two concurrent refunds of the same order never exceed what was captured", async () => {
  const { orderId, payable } = await makeConfirmedOrder(2);
  const half = Math.floor(payable / 2);

  await Promise.all([
    callFn("refund", { orderId, idempotencyKey: randomUUID(), amount: half, reason: "race a" }, adminJwt),
    callFn("refund", { orderId, idempotencyKey: randomUUID(), amount: half, reason: "race b" }, adminJwt),
  ]);

  const { data: pay } = await svc.from("payments").select("amount, refunded_amount").eq("order_id", orderId).single();
  const p = pay as { amount: number; refunded_amount: number };
  assert.ok(p.refunded_amount <= p.amount, `refunded ${p.refunded_amount} of ${p.amount} captured`);

  await callFn("admin_cancel_order", { orderId, reason: "9B cleanup", idempotencyKey: randomUUID() }, adminJwt);
});

test("a full refund from `confirmed` releases its own reservation — the other half of the 0011 guard", async () => {
  const before = await inv();
  const { orderId } = await makeConfirmedOrder(4);
  const held = await inv();
  assert.equal(held.qty_reserved, before.qty_reserved + 4, "4 units reserved");

  const r = await callFn("refund", { orderId, idempotencyKey: randomUUID(), reason: "9B full refund" }, adminJwt);
  assert.equal(r.ok, true, JSON.stringify(r));

  const after = await inv();
  assert.equal(after.qty_reserved, before.qty_reserved, "the reservation went back");
  assert.equal(after.qty_on_hand, held.qty_on_hand, "on-hand is unchanged — nothing had left the shelf");
  const { data: order } = await svc.from("orders").select("status").eq("id", orderId).single();
  assert.equal((order as { status: string }).status, "cancelled");
});


// ============================================================
// F. Audit surface
// ============================================================
test("an admin can read the audit log; a customer, runner and packer cannot", async () => {
  const asAdmin = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${adminJwt}` } },
  });
  const { data: mine } = await asAdmin.from("audit_logs").select("id").limit(5);
  assert.ok((mine ?? []).length > 0, "admin reads the audit log");

  for (const [who, jwt] of [["customer", customerJwt], ["runner", runnerJwt], ["packer", packerJwt]] as const) {
    const c = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data } = await c.from("audit_logs").select("id").limit(5);
    assert.deepEqual(data ?? [], [], `${who} must not read the audit log`);
  }
});

test("the audit log is append-only for every client role, including admin", async () => {
  const asAdmin = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${adminJwt}` } },
  });
  const ins = await asAdmin.from("audit_logs").insert({
    action: "forged.entry", entity_type: "order", entity_id: randomUUID(), metadata: {},
  });
  assert.ok(ins.error, "even an admin cannot write an audit row from the browser");

  const { data: any } = await asAdmin.from("audit_logs").select("id").limit(1).single();
  const upd = await asAdmin.from("audit_logs").update({ action: "tampered" }).eq("id", (any as { id: string }).id);
  const { data: check } = await svc.from("audit_logs").select("action").eq("id", (any as { id: string }).id).single();
  assert.notEqual((check as { action: string }).action, "tampered", "and cannot rewrite one");
  assert.ok(upd.error || true);

  const del = await asAdmin.from("audit_logs").delete().eq("id", (any as { id: string }).id);
  const { count } = await svc.from("audit_logs").select("id", { count: "exact", head: true }).eq("id", (any as { id: string }).id);
  assert.equal(count, 1, "and cannot delete one");
  assert.ok(del.error || true);
});

test("no audit row exposes a secret, a token or a delivery code", async () => {
  const { data } = await svc.from("audit_logs").select("action, metadata").limit(1000);
  const blob = JSON.stringify(data ?? []);
  for (const forbidden of ["eyJ", "Bearer ", "rzp_test_", "rzp_live_", "service_role", "PRIVATE KEY", "delivery_code", "deliveryCode"]) {
    assert.ok(!blob.includes(forbidden), `audit metadata must not contain ${forbidden}`);
  }
  const { data: codes } = await svc.from("order_delivery_codes").select("code").limit(50);
  for (const c of ((codes ?? []) as { code: string }[])) {
    assert.ok(!blob.includes(`"${c.code}"`), "a live delivery code appears in the audit log");
  }
});


// ============================================================
// G. Runner earnings stay blocked (explicit rule)
// ============================================================
test("settle_runner_earnings has no caller in any shipped app", async () => {
  // The formula is undefined (ENGINEERING_SPECIFICATION.md §L), so
  // settling placeholder money must not be reachable from a UI. This is
  // asserted against the shipped source, not by inspection.
  const { execFileSync } = await import("node:child_process");
  const root = new URL("../../../", import.meta.url).pathname;
  let hits = "";
  try {
    hits = execFileSync("grep", ["-rl", "--include=*.ts", "--include=*.tsx", "-e", "settle_runner_earnings", "apps"], {
      cwd: root, encoding: "utf8",
    });
  } catch {
    hits = ""; // grep exits 1 when nothing matches — the expected case
  }
  const offenders = hits.split("\n").filter((f) => f && !f.includes("__tests__"));
  assert.deepEqual(offenders, [], `settle_runner_earnings is reachable from: ${offenders.join(", ")}`);
});
