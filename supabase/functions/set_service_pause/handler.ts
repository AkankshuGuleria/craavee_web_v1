// set_service_pause — the kill switch.
//
// Read this before assuming the switch lives here: it does not. The
// ENFORCEMENT already existed and is not in this file. create_order
// (migration 0004, step 4) reads `stores.is_open` INSIDE the same
// transaction that creates the order and raises STORE_CLOSED — so a
// checkout racing a pause is resolved by Postgres, not by a disabled
// button, and not by anything this function does.
//
// What was missing is the audit. RBAC_MATRIX.md routes store config
// through plain admin RLS, but audit_logs is service-role-INSERT only,
// so a browser writing `stores` directly can never record who paused the
// business and why. That gap is the entire reason this function exists:
// same write, same authority, one transaction, plus the audit row the
// RLS path cannot produce.
import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { setServicePauseSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "set_service_pause";

export async function handleSetServicePause(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = setServicePauseSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") return fail("FORBIDDEN", "admin role required", 403);

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_set_service_pause", {
      p_store_id: input.storeId,
      p_actor_id: caller.userId,
      p_is_open: input.isOpen,
      p_pause_reason: input.pauseReason ?? null,
      p_max_queue_depth: input.maxQueueDepth ?? null,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, { fn: FN, userId: caller.userId, code: "SERVICE_PAUSE_FAULT", level: "fatal" });
      return fail("SERVICE_UNAVAILABLE", "the service state could not be changed, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      storeId: r.storeId,
      isOpen: r.isOpen,
      pauseReason: r.pauseReason ?? null,
      maxQueueDepth: r.maxQueueDepth,
      changed: Boolean(r.changed),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
