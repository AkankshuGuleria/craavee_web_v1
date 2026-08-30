// ============================================================
// Store fulfilment integration suite (Phase 6)
//
// Drives the REAL mark_packed / mark_stock_out handlers over HTTP against
// the live local stack, through supabase/functions/_dev/serve.ts (the CLI
// edge-runtime container does not boot on the dev machine —
// PHASE_4_IMPLEMENTATION_REPORT.md §20). Same handler code, same
// database, same auth path as production; only the process wrapper
// differs.
//
// Staff identities are seeded (9000001102 packer @ seed store,
// 9000001103 packer @ fixture store, 9000001301 admin) because the
// role/store_id claims are minted by custom_access_token_hook at sign-in.
//
// Canonical: API_CONTRACTS.md §"Store-Side Reconciliation",
// ORDER_STATE_MACHINE.md #4 / §2.1, RBAC_MATRIX.md §4/§5,
// TEST_STRATEGY.md §2.1 (genuine concurrency, not simulated).
// ============================================================
import { after, before, describe, it } from "node:test";
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

const FN_PORT = 8793; // dev 8790, order 8791, payment 8792 - each suite owns its own
const FN_BASE = `http://127.0.0.1:${FN_PORT}/functions/v1`;

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_STORE = "00000000-0000-4000-8000-000000000001";
const ZONE = "00000000-0000-4000-8000-000000000101";
let CUSTOMER = ""; // resolved at sign-in — the fixture address must belong to the caller

// Dedicated catalogue rows so nothing here touches seed inventory.
const F = {
  pA: "d6000000-0000-4000-8000-000000000201", // 5000
  pB: "d6000000-0000-4000-8000-000000000202", // 3000
  addr: "d6000000-0000-4000-8000-000000000301",
};

let packerJwt = "";
let otherPackerJwt = "";
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

async function callFn(name: string, body: unknown, jwt?: string | null): Promise<FnResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt !== null) headers["Authorization"] = `Bearer ${jwt ?? ""}`;
  const r = await fetch(`${FN_BASE}/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };
  return { status: r.status, ok: j.ok, data: j.data, code: j.error?.code };
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

/** Produce a genuinely `confirmed` order through the real pipeline:
 *  create_order (Phase 4) then a captured payment webhook (Phase 5).
 *
 *  Inserting the rows directly is not an option — check_payment_order_
 *  consistency is DEFERRED and validates the (orders.status,
 *  payments.status) pair at COMMIT, so no sequence of separate PostgREST
 *  writes can get from nothing to confirmed+captured without passing
 *  through an invalid resting pair. Driving the real functions is both
 *  the only correct way and the more honest fixture: packing is exercised
 *  on orders the production path actually produces. */
async function makeConfirmedOrder(
  lines: { productId: string; qty: number }[],
): Promise<{ orderId: string; itemIds: string[]; payable: number; subtotal: number }> {
  const created = await callFn(
    "create_order",
    { idempotencyKey: randomUUID(), addressId: F.addr, items: lines.map((l) => ({ productId: l.productId, qty: l.qty })) },
    customerJwt,
  );
  if (!created.ok) throw new Error(`fixture create_order failed: ${JSON.stringify(created)}`);

  const orderId = created.data!.orderId as string;
  const payable = Number(created.data!.payable);
  const pi = created.data!.paymentIntent as { gatewayOrderRef: string } | undefined;
  if (!pi) throw new Error("fixture: no payment intent on the created order");

  const status = await postWebhook(
    webhookEvent({ order_id: pi.gatewayOrderRef, payment_id: `pay_${orderId.slice(0, 8)}`, amount: payable }),
  );
  if (status !== 200) throw new Error(`fixture capture webhook failed: ${status}`);

  const { data: o } = await svc.from("orders").select("subtotal, status").eq("id", orderId).single();
  const row = o as { subtotal: number; status: string };
  if (row.status !== "confirmed") throw new Error(`fixture: order is ${row.status}, expected confirmed`);

  const { data: items } = await svc
    .from("order_items")
    .select("id, product_id")
    .eq("order_id", orderId);
  const byProduct = new Map((items ?? []).map((i) => [(i as { product_id: string }).product_id, (i as { id: string }).id]));
  const itemIds = lines.map((l) => byProduct.get(l.productId)!);

  return { orderId, itemIds, payable, subtotal: row.subtotal };
}

async function inv(productId: string) {
  const { data } = await svc
    .from("inventory")
    .select("qty_on_hand, qty_reserved")
    .eq("store_id", SEED_STORE)
    .eq("product_id", productId)
    .single();
  return data as { qty_on_hand: number; qty_reserved: number };
}

async function orderRow(orderId: string) {
  const { data } = await svc
    .from("orders")
    .select("status, subtotal, payable, wallet_applied, payment_status, packed_at")
    .eq("id", orderId)
    .single();
  return data as Record<string, unknown>;
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
  await waitForServer(`${FN_BASE}/mark_packed`);

  await must(
    svc.from("products").upsert([
      { id: F.pA, store_id: SEED_STORE, name: "P6 Item A", mrp: 6000, sale_price: 5000, category: "Snacks", is_listed: true },
      { id: F.pB, store_id: SEED_STORE, name: "P6 Item B", mrp: 3500, sale_price: 3000, category: "Snacks", is_listed: true },
    ]),
    "products",
  );
  await must(
    svc.from("inventory").upsert(
      [
        { store_id: SEED_STORE, product_id: F.pA, qty_on_hand: 500, qty_reserved: 0 },
        { store_id: SEED_STORE, product_id: F.pB, qty_on_hand: 500, qty_reserved: 0 },
      ],
      { onConflict: "store_id,product_id" },
    ),
    "inventory",
  );
  packerJwt = (await signIn("9000001102")).jwt;
  otherPackerJwt = (await signIn("9000001103")).jwt;
  adminJwt = (await signIn("9000001301")).jwt;
  const cust = await signIn("9990000010"); // dedicated: this suite credits wallets
  customerJwt = cust.jwt;
  CUSTOMER = cust.id;

  await must(
    svc.from("addresses").upsert({ id: F.addr, customer_id: CUSTOMER, zone_id: ZONE, block: "P6", room: "1" }),
    "address",
  );
});

after(() => {
  serverProc?.kill("SIGTERM");
});

// ============================================================
describe("store fulfilment — authorization", () => {
  it("a customer cannot pack an order (§24.3)", async () => {
    const { orderId } = await makeConfirmedOrder([{ productId: F.pA, qty: 1 }]);
    const r = await callFn("mark_packed", { orderId }, customerJwt);
    assert.equal(r.ok, false);
    assert.equal(r.code, "FORBIDDEN");
    assert.equal((await orderRow(orderId)).status, "confirmed");
  });

  it("a request with no JWT is refused (§24.17)", async () => {
    const { orderId } = await makeConfirmedOrder([{ productId: F.pA, qty: 1 }]);
    const r = await callFn("mark_packed", { orderId }, null);
    assert.equal(r.ok, false);
    assert.equal(r.code, "AUTH_REQUIRED");
  });

  it("a packer from another store cannot pack this order (§24.7)", async () => {
    const { orderId } = await makeConfirmedOrder([{ productId: F.pA, qty: 1 }]);
    const r = await callFn("mark_packed", { orderId }, otherPackerJwt);
    assert.equal(r.ok, false);
    assert.equal(r.code, "FORBIDDEN");
    assert.equal((await orderRow(orderId)).status, "confirmed");
  });

  it("a packer from another store cannot record a stock-out either", async () => {
    const { orderId, itemIds } = await makeConfirmedOrder([{ productId: F.pA, qty: 2 }]);
    const r = await callFn(
      "mark_stock_out",
      { orderId, orderItemId: itemIds[0], availableQty: 0, idempotencyKey: randomUUID() },
      otherPackerJwt,
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "FORBIDDEN");
  });

  it("an admin may pack an order in any store (§24.20, RBAC_MATRIX §4)", async () => {
    const { orderId } = await makeConfirmedOrder([{ productId: F.pA, qty: 1 }]);
    const r = await callFn("mark_packed", { orderId }, adminJwt);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal((await orderRow(orderId)).status, "packed");
  });
});

describe("store fulfilment — packing", () => {
  it("mark_packed moves a confirmed order to packed and consumes the reservation (§24.4, §24.8)", async () => {
    const before = await inv(F.pA);
    const { orderId } = await makeConfirmedOrder([{ productId: F.pA, qty: 3 }]);
    assert.equal((await inv(F.pA)).qty_reserved, before.qty_reserved + 3, "reserved while confirmed");

    const r = await callFn("mark_packed", { orderId }, packerJwt);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data?.status, "packed");

    const after = await inv(F.pA);
    assert.equal(after.qty_reserved, before.qty_reserved, "reservation released");
    assert.equal(after.qty_on_hand, before.qty_on_hand - 3, "and the stock actually left the shelf");

    const o = await orderRow(orderId);
    assert.equal(o.status, "packed");
    assert.ok(o.packed_at, "packed_at stamped server-side");
  });

  it("mark_packed on an already-packed order is harmless (§24.5, §24.15)", async () => {
    const before = await inv(F.pB);
    const { orderId } = await makeConfirmedOrder([{ productId: F.pB, qty: 2 }]);
    const first = await callFn("mark_packed", { orderId }, packerJwt);
    assert.equal(first.ok, true);
    assert.equal(first.data?.alreadyPacked, false);

    const second = await callFn("mark_packed", { orderId }, packerJwt);
    assert.equal(second.ok, true, "a repeat is success, not an error");
    assert.equal(second.data?.alreadyPacked, true);

    assert.equal((await inv(F.pB)).qty_on_hand, before.qty_on_hand - 2, "stock consumed exactly once");
  });

  it("CONCURRENT mark_packed: exactly one packs, stock moves once (§24.16)", async () => {
    const before = await inv(F.pA);
    const { orderId } = await makeConfirmedOrder([{ productId: F.pA, qty: 4 }]);

    const results = await Promise.all([
      callFn("mark_packed", { orderId }, packerJwt),
      callFn("mark_packed", { orderId }, packerJwt),
      callFn("mark_packed", { orderId }, packerJwt),
    ]);
    assert.ok(results.every((r) => r.ok), "all three resolve successfully (idempotent, not racy failures)");
    const performed = results.filter((r) => r.data?.alreadyPacked === false);
    assert.equal(performed.length, 1, "exactly one call performed the effect");

    assert.equal((await inv(F.pA)).qty_on_hand, before.qty_on_hand - 4, "stock consumed exactly once");
    assert.equal((await inv(F.pA)).qty_reserved, before.qty_reserved, "reservation cleared exactly once");
  });

  it("a cancelled order cannot be packed (§24.6)", async () => {
    const { orderId } = await makeConfirmedOrder([{ productId: F.pA, qty: 1 }]);

    // Cancel it the real way: a full refund of a still-live order also
    // cancels it (process_refund step 7). Writing orders.status directly
    // is impossible here anyway — check_payment_order_consistency is
    // deferred, so orders and payments have to reach a valid pair inside
    // one transaction.
    const refunded = await callFn(
      "refund",
      { orderId, idempotencyKey: randomUUID(), reason: "fixture: cancel before packing" },
      adminJwt,
    );
    assert.equal(refunded.ok, true, JSON.stringify(refunded));
    assert.equal((await orderRow(orderId)).status, "cancelled");

    const r = await callFn("mark_packed", { orderId }, packerJwt);
    assert.equal(r.ok, false);
    assert.equal(r.code, "INVALID_ORDER_TRANSITION");
  });

  it("inventory never goes negative even under repeated packing (§24.9)", async () => {
    const { data } = await svc.from("inventory").select("qty_on_hand, qty_reserved");
    for (const row of (data ?? []) as { qty_on_hand: number; qty_reserved: number }[]) {
      assert.ok(row.qty_on_hand >= 0, "qty_on_hand >= 0");
      assert.ok(row.qty_reserved >= 0, "qty_reserved >= 0");
    }
  });
});

describe("store fulfilment — stock-out", () => {
  it("a stock-out refunds exactly the affected line and leaves the order live (§24.10, §24.11)", async () => {
    const beforeA = await inv(F.pA);
    const beforeB = await inv(F.pB);
    const { orderId, itemIds } = await makeConfirmedOrder([
      { productId: F.pA, qty: 2 },
      { productId: F.pB, qty: 1 },
    ]);
    const { data: p0 } = await svc.from("profiles").select("wallet_balance").eq("id", CUSTOMER).single();
    const walletBefore = (p0 as { wallet_balance: number }).wallet_balance;

    // Item A completely unavailable.
    const r = await callFn(
      "mark_stock_out",
      { orderId, orderItemId: itemIds[0], availableQty: 0, delist: false, idempotencyKey: randomUUID() },
      packerJwt,
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data?.refundAmount, 10000, "server-computed: 2 x 5000, never sent by the client");
    assert.equal(r.data?.fulfilledQty, 0);

    const o = await orderRow(orderId);
    assert.equal(o.status, "confirmed", "stock-out is NOT a state transition");
    assert.equal(o.subtotal, 13000 - 10000, "subtotal reduced by the removed value");
    assert.equal(o.payment_status, "partially_refunded");

    const { data: p1 } = await svc.from("profiles").select("wallet_balance").eq("id", CUSTOMER).single();
    assert.equal((p1 as { wallet_balance: number }).wallet_balance, walletBefore + 10000, "refunded to wallet");

    assert.equal((await inv(F.pA)).qty_reserved, beforeA.qty_reserved, "unfulfilled reservation released");
    assert.equal((await inv(F.pB)).qty_reserved, beforeB.qty_reserved + 1, "the other line stays reserved");

    // The remaining item still packs, and only it moves stock.
    const packed = await callFn("mark_packed", { orderId }, packerJwt);
    assert.equal(packed.ok, true, JSON.stringify(packed));
    assert.equal((await orderRow(orderId)).status, "packed", "order reaches packed with the remaining line");
    assert.equal((await inv(F.pA)).qty_on_hand, beforeA.qty_on_hand, "stocked-out item never left the shelf");
    assert.equal((await inv(F.pB)).qty_on_hand, beforeB.qty_on_hand - 1, "the fulfilled item did");
  });

  it("a partial stock-out refunds only the missing units", async () => {
    const { orderId, itemIds } = await makeConfirmedOrder([{ productId: F.pA, qty: 3 }]);
    const r = await callFn(
      "mark_stock_out",
      { orderId, orderItemId: itemIds[0], availableQty: 1, delist: false, idempotencyKey: randomUUID() },
      packerJwt,
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data?.refundAmount, 10000, "2 missing x 5000");
    assert.equal(r.data?.fulfilledQty, 1);
  });

  it("a duplicate stock-out is harmless (§24.12)", async () => {
    const { orderId, itemIds } = await makeConfirmedOrder([{ productId: F.pA, qty: 2 }]);
    const { data: p0 } = await svc.from("profiles").select("wallet_balance").eq("id", CUSTOMER).single();
    const walletBefore = (p0 as { wallet_balance: number }).wallet_balance;

    const first = await callFn(
      "mark_stock_out",
      { orderId, orderItemId: itemIds[0], availableQty: 0, delist: false, idempotencyKey: randomUUID() },
      packerJwt,
    );
    assert.equal(first.data?.refundAmount, 10000);

    const second = await callFn(
      "mark_stock_out",
      { orderId, orderItemId: itemIds[0], availableQty: 0, delist: false, idempotencyKey: randomUUID() },
      packerJwt,
    );
    assert.equal(second.ok, true, "a repeat is success, not an error");
    assert.equal(second.data?.alreadyStockedOut, true);
    assert.equal(second.data?.refundAmount, 0, "and refunds nothing further");

    const { data: p1 } = await svc.from("profiles").select("wallet_balance").eq("id", CUSTOMER).single();
    assert.equal((p1 as { wallet_balance: number }).wallet_balance, walletBefore + 10000, "credited exactly once");
  });

  it("CONCURRENT duplicate stock-out produces exactly one refund (§24.13)", async () => {
    const { orderId, itemIds } = await makeConfirmedOrder([{ productId: F.pA, qty: 2 }]);
    const { data: p0 } = await svc.from("profiles").select("wallet_balance").eq("id", CUSTOMER).single();
    const walletBefore = (p0 as { wallet_balance: number }).wallet_balance;

    const results = await Promise.all([
      callFn("mark_stock_out", { orderId, orderItemId: itemIds[0], availableQty: 0, delist: false, idempotencyKey: randomUUID() }, packerJwt),
      callFn("mark_stock_out", { orderId, orderItemId: itemIds[0], availableQty: 0, delist: false, idempotencyKey: randomUUID() }, packerJwt),
      callFn("mark_stock_out", { orderId, orderItemId: itemIds[0], availableQty: 0, delist: false, idempotencyKey: randomUUID() }, packerJwt),
    ]);
    assert.ok(results.every((r) => r.ok), "all resolve successfully");
    const effective = results.filter((r) => r.data?.alreadyStockedOut === false);
    assert.equal(effective.length, 1, "exactly one performed the refund");

    const { data: p1 } = await svc.from("profiles").select("wallet_balance").eq("id", CUSTOMER).single();
    assert.equal((p1 as { wallet_balance: number }).wallet_balance, walletBefore + 10000, "wallet credited once");

    const { count } = await svc
      .from("wallet_ledger")
      .select("*", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("reason", "refund");
    assert.equal(count, 1, "exactly one refund ledger row");
  });

  it("cannot refund more than the ordered quantity (§24.14)", async () => {
    const { orderId, itemIds } = await makeConfirmedOrder([{ productId: F.pA, qty: 2 }]);
    const r = await callFn(
      "mark_stock_out",
      { orderId, orderItemId: itemIds[0], availableQty: 9, idempotencyKey: randomUUID() },
      packerJwt,
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "ITEM_UNAVAILABLE");
  });

  it("payment and refund records stay consistent after a stock-out (§24.18)", async () => {
    const { orderId, itemIds } = await makeConfirmedOrder([
      { productId: F.pA, qty: 2 },
      { productId: F.pB, qty: 1 },
    ]);
    await callFn(
      "mark_stock_out",
      { orderId, orderItemId: itemIds[1], availableQty: 0, delist: false, idempotencyKey: randomUUID() },
      packerJwt,
    );

    const { data: pay } = await svc
      .from("payments")
      .select("amount, refunded_amount, status")
      .eq("order_id", orderId)
      .single();
    const p = pay as { amount: number; refunded_amount: number; status: string };
    assert.equal(p.refunded_amount, 3000, "refunded_amount tracks the removed value");
    assert.ok(p.refunded_amount <= p.amount, "never exceeds what was captured");
    assert.equal(p.status, "partially_refunded");

    const o = await orderRow(orderId);
    assert.equal(
      (o.subtotal as number) + 1000 - (o.wallet_applied as number),
      o.payable,
      "payable_matches_math still holds",
    );
  });
});

describe("store fulfilment — audit", () => {
  it("packing and stock-out both write audit rows with the acting staff id (§24.19)", async () => {
    const { orderId, itemIds } = await makeConfirmedOrder([{ productId: F.pA, qty: 2 }]);
    await callFn(
      "mark_stock_out",
      { orderId, orderItemId: itemIds[0], availableQty: 1, delist: false, idempotencyKey: randomUUID() },
      packerJwt,
    );
    await callFn("mark_packed", { orderId }, packerJwt);

    const { data } = await svc
      .from("audit_logs")
      .select("action, actor_id, metadata")
      .eq("entity_id", orderId)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as { action: string; actor_id: string; metadata: Record<string, unknown> }[];

    const so = rows.find((r) => r.action === "order.stock_out");
    const pk = rows.find((r) => r.action === "order.packed");
    assert.ok(so, "order.stock_out audited");
    assert.ok(pk, "order.packed audited");
    assert.equal(so!.actor_id, "00000000-0000-4000-8000-000000001102", "records the acting packer, not the customer");
    assert.equal(so!.metadata.refund_amount, 5000, "carries the server-computed amount");
    assert.equal(pk!.actor_id, "00000000-0000-4000-8000-000000001102");
  });
});
