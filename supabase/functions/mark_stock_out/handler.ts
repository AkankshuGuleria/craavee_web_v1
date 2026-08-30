// mark_stock_out — API_CONTRACTS.md §"Store-Side Reconciliation",
// ORDER_STATE_MACHINE.md §2.1 "Stock-out is not a state transition".
//
// A packer discovering a missing item does NOT move the order to a new
// status. The line's fulfilled_qty is set to what was actually on the
// shelf, the unfulfilled portion's reservation is released, the removed
// value is refunded to the wallet, and the order carries on toward
// `packed` with whatever remains.
//
// The client sends a COUNT, never money. `availableQty` is how many units
// the packer found; the refund is derived inside process_stock_out from
// the stored order_items.unit_price (Phase 6 §13/§15). There is no
// refundAmount field in this request and adding one would be a defect.
//
// Idempotent per line (Phase 6 §18/§23) on order_items.stock_out_at: a
// second call for the same line returns the original outcome with
// alreadyStockedOut=true and issues no second refund. Concurrent
// duplicates serialize on the order and line row locks, so a packer
// double-tapping cannot produce two refunds.
//
// One transaction, no network I/O (D24) — the refund settles to the
// wallet (D38), so no gateway call happens here.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { markStockOutSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "mark_stock_out";

export async function handleMarkStockOut(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = markStockOutSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "packer" && caller.role !== "admin") {
    return fail("FORBIDDEN", "only a packer or admin may record a stock-out", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_stock_out", {
      p_order_id: input.orderId,
      p_order_item_id: input.orderItemId,
      p_available_qty: input.availableQty,
      // null lets the DB apply the documented default: delist on a total
      // miss, leave the catalogue alone on a partial shortfall.
      p_delist: input.delist ?? null,
      p_actor_id: caller.userId,
      p_idempotency_key: input.idempotencyKey,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, {
        fn: FN,
        userId: caller.userId,
        orderId: input.orderId,
        code: "STOCK_OUT_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "the stock-out could not be recorded, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderItemId: r.orderItemId,
      fulfilledQty: Number(r.fulfilledQty),
      refundAmount: Number(r.refundAmount),
      newPayable: Number(r.newPayable),
      alreadyStockedOut: Boolean(r.alreadyStockedOut),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
