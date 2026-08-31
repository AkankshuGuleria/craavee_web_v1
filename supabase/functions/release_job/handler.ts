// release_job — ORDER_STATE_MACHINE.md #8 (assigned -> packed, actor
// `runner` releasing their own job, or `admin`).
//
// The order goes back on the queue for someone else. enforce_order_
// transition clears runner_id and assigned_at itself, and the DB
// function invalidates the delivery code so the releasing runner cannot
// still complete a delivery they gave up.
//
// Scope boundary worth stating: this is assigned -> packed only. There
// is no picked_up -> packed transition in the state machine — once the
// runner physically holds the bag the only exits are `delivered` and
// `delivery_failed`. Releasing after pickup therefore needs
// mark_delivery_failed, which is outside Phase 7's scope.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { releaseJobSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "release_job";

export async function handleReleaseJob(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = releaseJobSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "runner" && caller.role !== "admin") {
    return fail("FORBIDDEN", "only the assigned runner or an admin may release a job", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_release_job", {
      p_order_id: input.orderId,
      p_actor_id: caller.userId,
      p_reason: input.reason ?? null,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, {
        fn: FN,
        userId: caller.userId,
        orderId: input.orderId,
        code: "RELEASE_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "the job could not be released, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderId: r.orderId,
      status: r.status,
      alreadyReleased: Boolean(r.alreadyReleased),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
