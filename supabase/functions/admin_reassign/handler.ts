// admin_reassign — API_CONTRACTS.md §"Administrative / Privileged".
// ORDER_STATE_MACHINE.md #13 (delivery_failed -> assigned), plus the
// same-status runner swap and the release-to-queue case.
//
// `runnerId` is a runners.id (D28), not a profile id, and omitting it
// means "put this back on the queue" rather than "assign to nobody".
//
// The runner swap is worth calling out: moving an `assigned` order from
// runner A to runner B does not change orders.status, so
// enforce_order_transition returns early and validates nothing. Every
// check that matters — admin role, target runner exists, target is at
// this store, target has no live job — therefore happens inside
// process_admin_reassign, with the partial unique index as the backstop
// if a concurrent claim slips between the check and the write.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { adminReassignSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "admin_reassign";

export async function handleAdminReassign(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = adminReassignSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") {
    return fail("FORBIDDEN", "admin role required", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_admin_reassign", {
      p_order_id: input.orderId,
      p_actor_id: caller.userId,
      p_runner_id: input.runnerId ?? null,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, {
        fn: FN,
        userId: caller.userId,
        orderId: input.orderId,
        code: "REASSIGN_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "the order could not be reassigned, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderId: r.orderId,
      status: r.status,
      runnerId: r.runnerId ?? null,
      unchanged: Boolean(r.unchanged),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
