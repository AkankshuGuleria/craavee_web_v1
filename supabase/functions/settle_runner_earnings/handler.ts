// settle_runner_earnings — API_CONTRACTS.md §3.
//
// The money moves outside the system (dossier §9/§21: a manual transfer
// at this scale). This function only records that it happened, by
// stamping `settled_at` on rows that do not have it yet.
//
// Already-settled rows are skipped rather than re-stamped, so a double
// click settles nothing twice and honestly reports 0 — which is why
// there is no idempotency key: the filter IS the idempotency.
import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { settleRunnerEarningsSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "settle_runner_earnings";

export async function handleSettleRunnerEarnings(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = settleRunnerEarningsSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") return fail("FORBIDDEN", "admin role required", 403);

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_settle_runner_earnings", {
      p_runner_id: input.runnerId,
      p_actor_id: caller.userId,
      p_order_ids: input.orderIds ?? null,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, { fn: FN, userId: caller.userId, code: "SETTLE_FAULT", level: "error" });
      return fail("SERVICE_UNAVAILABLE", "earnings could not be settled, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({ runnerId: r.runnerId, settledCount: r.settledCount, totalAmount: r.totalAmount });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, level: "error" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
