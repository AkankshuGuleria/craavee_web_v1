// verify_delivery_code — ORDER_STATE_MACHINE.md #11 (picked_up ->
// delivered, actor `runner`, must be the assigned runner). D14.
//
// This is the endpoint that decides an order is complete, so it is the
// one a malicious runner would attack. Four things stop that, none of
// them in this file:
//
//   * the code is compared as a bcrypt hash inside the DB function; the
//     plaintext is never readable by the runner at any point
//   * every attempt writes a rate_limit_events row BEFORE the comparison,
//     and 5 attempts per order per 15 minutes is the ceiling — without
//     it a 4-digit code is 10,000 guesses, which is nothing
//   * the caller must be the runner the order is actually assigned to,
//     resolved from the JWT, not from the body
//   * the transition itself still goes through enforce_order_transition,
//     so `assigned -> delivered` is rejected even with a correct code
//
// The submitted code is never logged, never echoed back, and never put
// in Sentry context — audit_logs' own comment forbids storing it.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { verifyDeliveryCodeSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "verify_delivery_code";

export async function handleVerifyDeliveryCode(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = verifyDeliveryCodeSchema.safeParse(body);
  if (!parsed.success) {
    // The flatten() output names the failing field but never carries the
    // submitted value, so a malformed code is not echoed back.
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "runner" && caller.role !== "admin") {
    return fail("FORBIDDEN", "only the assigned runner or an admin may verify delivery", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_verify_delivery_code", {
      p_order_id: input.orderId,
      p_actor_id: caller.userId,
      p_code: input.code,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      // Note the context: order and user, never `input.code`.
      captureException(error, {
        fn: FN,
        userId: caller.userId,
        orderId: input.orderId,
        code: "DELIVERY_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "delivery could not be confirmed, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderId: r.orderId,
      status: r.status,
      alreadyDelivered: Boolean(r.alreadyDelivered),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
