// admin_cancel_order — API_CONTRACTS.md §3, ORDER_STATE_MACHINE #6/#9/#14.
//
// The contract calls this "a thin wrapper around the transitions", and it
// stays thin on purpose: every admin-cancel row in the state machine is
// paired with a FULL refund, and process_refund already performs that
// pairing atomically (money, reservation, order status, audit). So this
// function authorizes, then delegates. Two cancellation paths with two
// money behaviours is how a refund model rots.
//
// There is deliberately no `amount` in the request. A browser never
// chooses how much money moves (Phase 5 §13), and "cancel" means the
// whole thing by definition here.
import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { adminCancelOrderSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "admin_cancel_order";

export async function handleAdminCancelOrder(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = adminCancelOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") return fail("FORBIDDEN", "admin role required", 403);

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_admin_cancel_order", {
      p_order_id: input.orderId,
      p_actor_id: caller.userId,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, {
        fn: FN,
        userId: caller.userId,
        orderId: input.orderId,
        code: "ADMIN_CANCEL_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "the order could not be cancelled, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderId: r.orderId,
      status: r.status,
      fromStatus: r.fromStatus,
      refundedAmount: r.refundedAmount ?? 0,
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
