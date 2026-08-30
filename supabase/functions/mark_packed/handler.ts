// mark_packed — API_CONTRACTS.md §"Store-Side Reconciliation",
// ORDER_STATE_MACHINE.md #4 (confirmed -> packed, actor `packer`).
//
// The request carries an order id and nothing else. Which lines are
// filled, how much stock moves and whether the caller may act at all are
// decided inside process_mark_packed (migration 0006) against a locked
// order row — the browser contributes no part of that decision. A button
// labelled "Packed" is not the guarantee; the transaction is.
//
// Authorization is deliberately checked twice. Here, so an ordinary
// customer gets a clean 403 without touching the database; and again
// inside the DB function, which resolves the caller's role and store from
// staff_roles rather than trusting anything this function passes. The
// second check is the one that actually holds (SECURITY_MODEL.md).
//
// Idempotent (Phase 6 §23): an already-packed order returns 200 with
// alreadyPacked=true rather than an error, so a double tap on a phone in
// a busy store is harmless. Two concurrent calls serialize on the order
// row lock and exactly one performs the effect.
//
// One transaction, no network I/O (D24).

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { markPackedSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "mark_packed";

export async function handleMarkPacked(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = markPackedSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "packer" && caller.role !== "admin") {
    return fail("FORBIDDEN", "only a packer or admin may pack an order", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_mark_packed", {
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
        code: "PACK_FAULT",
        level: "fatal",
      });
      return fail("SERVICE_UNAVAILABLE", "the order could not be packed, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      orderId: r.orderId,
      status: r.status,
      alreadyPacked: Boolean(r.alreadyPacked),
      linesPacked: r.linesPacked === undefined ? undefined : Number(r.linesPacked),
      unitsPacked: r.unitsPacked === undefined ? undefined : Number(r.unitsPacked),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, orderId: input.orderId, level: "fatal" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
