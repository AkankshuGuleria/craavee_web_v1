// create_order — API_CONTRACTS.md §3, PHASE_1_1_CORRECTIONS.md §4.
//
// Three phases, at most two short Postgres transactions, NO transaction
// held across the gateway network call (D24):
//
//   Phase A  -> rpc('create_order_phase_a')  (migration 0004) — one txn:
//              idempotency, address/zone/store validation, fixed-order
//              locking (wallet -> promo -> inventory), server pricing,
//              inventory reservation, promo redemption, wallet debit,
//              orders + order_items + one payments row. Returns confirmed
//              immediately if the wallet fully covered it (payable = 0).
//   Phase B  -> rpc('claim_payment_intent') then gateway.createPaymentIntent
//              with no txn open. The claim marker prevents a concurrent
//              duplicate from creating a second gateway intent.
//   Phase C  -> rpc('persist_gateway_ref') (3 retries) — persist the ref.
//
// Identity comes from the verified JWT ONLY. `customer_id` / `role` /
// `store_id` / any price field in the request body is never read
// (SECURITY_MODEL.md §2, Phase 4 prompt §12/§31).

import { serviceClient, verifyCaller, mockGatewayMode } from "../_shared/context.ts";
import { parseDbError, httpStatusFor } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { createOrderSchema } from "../_shared/validation.ts";
import { getGateway, GatewayError } from "../_shared/gateway/index.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "create_order";

interface PaymentRow {
  gateway: string | null;
  gateway_order_ref: string | null;
  gateway_intent_requested_at: string | null;
  status: string;
  amount: number;
}
interface OrderRow {
  id: string;
  status: string;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  wallet_applied: number;
  payable: number;
}

function summary(o: {
  orderId: string;
  status: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  walletApplied: number;
  payable: number;
  paymentIntent?: { gateway: string; gatewayOrderRef: string; checkoutParams: Record<string, unknown> };
}) {
  return o;
}

export async function handleCreateOrder(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  // ---- 1. input validation (never trusted; the DB re-checks everything)
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;
  // Normalized items: merge duplicate lines, sort by productId — so the
  // request hash (and the DB's own normalization) are order-independent.
  const mergedItems = Object.entries(
    input.items.reduce<Record<string, number>>((acc, i) => {
      acc[i.productId] = (acc[i.productId] ?? 0) + i.qty;
      return acc;
    }, {}),
  )
    .map(([productId, qty]) => ({ productId, qty }))
    .sort((a, b) => (a.productId < b.productId ? -1 : 1));

  // ---- 2. authorization
  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "customer") {
    return fail("FORBIDDEN", "only a customer may place an order", 403);
  }

  const db = serviceClient();

  // Stable hash of the normalized request — the idempotency payload guard
  // (migration 0004, orders.idempotency_request_hash). A replay of the
  // same key with a materially different request is a deterministic
  // ORDER_ALREADY_EXISTS conflict, not a silent "return some other order".
  const canonical = JSON.stringify({
    customerId: caller.userId,
    addressId: input.addressId,
    items: mergedItems,
    promoCode: input.promoCode ?? null,
    useWallet: input.useWallet ?? false,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

  try {
    // ---- 3. idempotency pre-check + resume matrix (PHASE_1_1_CORRECTIONS.md §4.3)
    const { data: existing } = await db
      .from("orders")
      .select("id, status, subtotal, discount, delivery_fee, wallet_applied, payable, idempotency_request_hash, payments(gateway, gateway_order_ref, gateway_intent_requested_at, status, amount)")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();

    if (existing) {
      const order = existing as unknown as OrderRow & { idempotency_request_hash: string | null; payments: PaymentRow[] | PaymentRow };
      // Same key, materially different request -> deterministic conflict
      // (Phase 4 prompt §14-§15, D23). Never silently return an order the
      // caller did not ask for.
      if (order.idempotency_request_hash && order.idempotency_request_hash !== requestHash) {
        return fail("ORDER_ALREADY_EXISTS", "this idempotency key was already used for a different order", 409);
      }
      const pay = (Array.isArray(order.payments) ? order.payments[0] : order.payments) as PaymentRow;
      return await resume(req, db, order, pay);
    }

    // ---- 4. Phase A
    const { data: aData, error: aErr } = await db.rpc("create_order_phase_a", {
      p_customer_id: caller.userId,
      p_idempotency_key: input.idempotencyKey,
      p_address_id: input.addressId,
      p_items: mergedItems,
      p_promo_code: input.promoCode ?? null,
      p_use_wallet: input.useWallet ?? false,
      p_request_hash: requestHash,
    });

    if (aErr) {
      const mapped = parseDbError(aErr.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(aErr, { fn: FN, userId: caller.userId, code: "PHASE_A_FAULT" });
      return fail("PAYMENT_SETUP_FAILED", "order could not be created, please retry", 500);
    }

    const a = aData as Record<string, unknown>;
    const orderId = a.orderId as string;

    if (a.alreadyExisted) {
      // A concurrent request won the insert race between our pre-check
      // and Phase A. Re-fetch and resume.
      const { data: reFetched } = await db
        .from("orders")
        .select("id, status, subtotal, discount, delivery_fee, wallet_applied, payable, payments(gateway, gateway_order_ref, gateway_intent_requested_at, status, amount)")
        .eq("id", orderId)
        .single();
      const order = reFetched as unknown as OrderRow & { payments: PaymentRow[] | PaymentRow };
      const pay = (Array.isArray(order.payments) ? order.payments[0] : order.payments) as PaymentRow;
      return await resume(req, db, order, pay);
    }

    // Fully wallet-covered — confirmed in Phase A, no gateway step.
    if (a.status === "confirmed" || Number(a.payable) === 0) {
      return ok(summary({
        orderId,
        status: "confirmed",
        subtotal: Number(a.subtotal),
        discount: Number(a.discount),
        deliveryFee: Number(a.deliveryFee),
        walletApplied: Number(a.walletApplied),
        payable: Number(a.payable),
      }));
    }

    // ---- 5/6. Phase B + C
    return await runGatewayPhases(req, db, {
      orderId,
      userId: caller.userId,
      subtotal: Number(a.subtotal),
      discount: Number(a.discount),
      deliveryFee: Number(a.deliveryFee),
      walletApplied: Number(a.walletApplied),
      payable: Number(a.payable),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, level: "fatal" });
    return fail("PAYMENT_SETUP_FAILED", "unexpected error, please retry", 500);
  }
}

async function resume(
  req: Request,
  db: ReturnType<typeof serviceClient>,
  order: OrderRow,
  pay: PaymentRow | undefined,
): Promise<Response> {
  const base = {
    orderId: order.id,
    subtotal: order.subtotal,
    discount: order.discount,
    deliveryFee: order.delivery_fee,
    walletApplied: order.wallet_applied,
    payable: order.payable,
  };

  if (order.status === "confirmed") {
    return ok(summary({ ...base, status: "confirmed" }));
  }
  if (order.status === "payment_failed" || order.status === "cancelled") {
    // terminal — no resume; a genuine retry needs a new idempotencyKey.
    return ok(summary({ ...base, status: order.status as "created" }));
  }
  // status === 'created'
  if (pay?.gateway_order_ref) {
    const gw = getGateway(mockGatewayMode(req));
    return ok(summary({
      ...base,
      status: "created",
      paymentIntent: {
        gateway: pay.gateway ?? gw.name,
        gatewayOrderRef: pay.gateway_order_ref,
        checkoutParams: gw.buildCheckoutParams(pay.gateway_order_ref, order.payable),
      },
    }));
  }
  if (
    pay?.gateway_intent_requested_at &&
    Date.now() - new Date(pay.gateway_intent_requested_at).getTime() < 60_000
  ) {
    return ok(summary({ ...base, status: "payment_setup_in_progress" }));
  }
  // created, no live claim -> resume at Phase B
  return await runGatewayPhases(req, db, { ...base, userId: "", orderId: order.id });
}

async function runGatewayPhases(
  req: Request,
  db: ReturnType<typeof serviceClient>,
  o: { orderId: string; userId: string; subtotal: number; discount: number; deliveryFee: number; walletApplied: number; payable: number },
): Promise<Response> {
  // ---- Phase B: claim
  const { data: claim, error: claimErr } = await db.rpc("claim_payment_intent", { p_order_id: o.orderId });
  if (claimErr) {
    const mapped = parseDbError(claimErr.message);
    return fail(mapped?.code ?? "PAYMENT_SETUP_FAILED", mapped?.detail || "payment setup failed", httpStatusFor(mapped?.code ?? "PAYMENT_SETUP_FAILED"));
  }
  const action = (claim as { action: string }).action;

  if (action === "in_progress") {
    return ok(summary({
      orderId: o.orderId, status: "payment_setup_in_progress",
      subtotal: o.subtotal, discount: o.discount, deliveryFee: o.deliveryFee,
      walletApplied: o.walletApplied, payable: o.payable,
    }));
  }

  const gw = getGateway(mockGatewayMode(req));

  if (action === "already_done") {
    const ref = (claim as { gatewayOrderRef: string }).gatewayOrderRef;
    return ok(summary({
      orderId: o.orderId, status: "created",
      subtotal: o.subtotal, discount: o.discount, deliveryFee: o.deliveryFee,
      walletApplied: o.walletApplied, payable: o.payable,
      paymentIntent: { gateway: gw.name, gatewayOrderRef: ref, checkoutParams: gw.buildCheckoutParams(ref, o.payable) },
    }));
  }

  // action === 'proceed' — call the gateway with NO transaction open.
  let ref: string;
  let checkoutParams: Record<string, unknown>;
  try {
    const intent = await gw.createPaymentIntent({ orderId: o.orderId, amountPaise: o.payable, currency: "INR" });
    ref = intent.gatewayOrderRef;
    checkoutParams = intent.checkoutParams;
  } catch (err) {
    if (err instanceof GatewayError) {
      // Order + reservation untouched. Client retries with the same key.
      return fail("PAYMENT_SETUP_FAILED", "payment setup failed, please retry", 422);
    }
    captureException(err, { fn: FN, orderId: o.orderId, code: "GATEWAY_FAULT" });
    return fail("PAYMENT_SETUP_FAILED", "payment setup failed, please retry", 422);
  }

  // ---- Phase C: persist the ref (3 retries — this is a single-row write;
  // failure here means real infra trouble, not a business conflict).
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error: pErr } = await db.rpc("persist_gateway_ref", { p_order_id: o.orderId, p_gateway_order_ref: ref });
    if (!pErr) {
      return ok(summary({
        orderId: o.orderId, status: "created",
        subtotal: o.subtotal, discount: o.discount, deliveryFee: o.deliveryFee,
        walletApplied: o.walletApplied, payable: o.payable,
        paymentIntent: { gateway: gw.name, gatewayOrderRef: ref, checkoutParams },
      }));
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 100 * attempt));
    else {
      // Gateway succeeded, persistence did not — P0 reconciliation path.
      captureException(new Error("persist_gateway_ref failed after 3 attempts"), {
        fn: FN, orderId: o.orderId, code: "PAYMENT_RECONCILIATION_REQUIRED", level: "fatal",
        extra: { gatewayOrderRef: ref },
      });
      return fail("PAYMENT_RECONCILIATION_REQUIRED", "payment set up but not recorded — support has been alerted", 500);
    }
  }
  return fail("PAYMENT_SETUP_FAILED", "payment setup failed, please retry", 422);
}
