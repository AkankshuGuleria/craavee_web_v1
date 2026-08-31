// claim_job — API_CONTRACTS.md §"Fulfilment Claim & Handoff",
// ORDER_STATE_MACHINE.md #7 (packed -> assigned, actor `runner`).
//
// The request is one order id. Which runner is claiming is never sent:
// it is resolved inside process_claim_job from the caller's JWT to a
// staff_roles row to a runners.id (D28). A client that puts `runnerId`
// in the body is ignored — there is no such field to ignore.
//
// Deliberately NOT idempotent (API_CONTRACTS.md §6): claiming is a
// contest, not a retryable write. A client that times out should re-read
// the order to see whether its own attempt won, rather than re-POSTing
// and possibly stealing a job it already lost.
//
// The race is settled in the database by FOR UPDATE SKIP LOCKED (D13),
// not here. Two runners tapping "claim" in the same millisecond both
// reach this handler; exactly one leaves with `assigned`.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { claimJobSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "claim_job";

export async function handleClaimJob(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = claimJobSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  // A cheap 403 for an obviously wrong role. The check that actually
  // holds is inside the DB function, which re-resolves role and store
  // from staff_roles rather than trusting anything passed from here.
  if (caller.role !== "runner") {
    return fail("FORBIDDEN", "only a runner may claim a job", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_claim_job", {
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
        code: "CLAIM_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "the job could not be claimed, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderId: r.orderId,
      status: r.status,
      address: r.address ?? {},
      itemSummary: r.itemSummary ?? "",
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
