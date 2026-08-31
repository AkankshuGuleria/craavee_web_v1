// mark_picked_up — ORDER_STATE_MACHINE.md #10 (assigned -> picked_up,
// actor `runner`, must be the assigned runner).
//
// Ownership is the point of this endpoint: having the `runner` role is
// not enough, the caller must be the runner this order is actually
// assigned to. That is checked inside process_mark_picked_up against the
// locked order row, comparing the caller's resolved runners.id to
// orders.runner_id (D28) — not against anything in the request.
//
// A repeat call on an already picked-up order returns 200 with
// alreadyPickedUp=true. A phone in a pocket taps twice; that should not
// be an error.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { markPickedUpSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "mark_picked_up";

export async function handleMarkPickedUp(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = markPickedUpSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "runner" && caller.role !== "admin") {
    return fail("FORBIDDEN", "only the assigned runner or an admin may confirm pickup", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_mark_picked_up", {
      p_order_id: input.orderId,
      p_actor_id: caller.userId,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, {
        fn: FN,
        userId: caller.userId,
        orderId: input.orderId,
        code: "PICKUP_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "pickup could not be recorded, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderId: r.orderId,
      status: r.status,
      alreadyPickedUp: Boolean(r.alreadyPickedUp),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
