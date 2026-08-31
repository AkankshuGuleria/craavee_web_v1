// mark_delivery_failed — API_CONTRACTS.md §"Fulfilment Claim & Handoff",
// ORDER_STATE_MACHINE.md #12 (picked_up -> delivery_failed, actor
// `runner` on their own job, or `admin`).
//
// This closes the hole Phase 7 reported: a runner holding a bag they
// cannot deliver previously had no exit at all, because `picked_up` goes
// only to `delivered` or `delivery_failed` and release_job cannot reach
// `packed` from there.
//
// A failure is NOT a financial event. Row #12's wallet/payment column is
// "none yet (see #13/#14 for resolution)" — the admin decides afterwards
// whether to reassign (#13) or cancel with a full refund (#14).
// Refunding here would refund orders that succeed on a second attempt.
//
// `reason` is required and free text for now, exactly as the contract
// says. It is stored in the audit row, not on `orders`.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { markDeliveryFailedSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "mark_delivery_failed";

export async function handleMarkDeliveryFailed(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = markDeliveryFailedSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "runner" && caller.role !== "admin") {
    return fail("FORBIDDEN", "only the assigned runner or an admin may report a delivery failure", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_mark_delivery_failed", {
      p_order_id: input.orderId,
      p_actor_id: caller.userId,
      p_reason: input.reason,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, {
        fn: FN,
        userId: caller.userId,
        orderId: input.orderId,
        code: "DELIVERY_FAILURE_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "the failure could not be recorded, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderId: r.orderId,
      status: r.status,
      alreadyFailed: Boolean(r.alreadyFailed),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
