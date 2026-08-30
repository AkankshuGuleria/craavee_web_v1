// refund — API_CONTRACTS.md §3, Phase 5 §13/§14.
//
// Admin/system-authorized. The refund AMOUNT is server-computed
// (client `amount` is only an optional cap; omitting it means "full
// remaining captured amount") — a client never controls how much money
// moves (Phase 5 §13). Idempotency-keyed (D29): a replay with the same
// key returns the original refund, a concurrent duplicate resolves to
// exactly one refund, and the same key with a different amount is a
// deterministic conflict.
//
// Phase 5 implements the WALLET destination only (dossier §18 — refunds
// to wallet keep money inside the system). A gateway-instrument refund
// path is a later-phase support tool that also needs a
// PaymentGatewayAdapter interface addition this phase is told not to
// make (D38 / Phase 5 §3).
//
// All money movement is one transaction inside process_refund (migration
// 0005) — no network I/O (D24). A full refund of a still-live order also
// cancels it, since `confirmed + refunded` is not a valid resting pair
// (ORDER_STATE_MACHINE.md §2.1).

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { refundSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "refund";

export async function handleRefund(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = refundSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") {
    return fail("FORBIDDEN", "only an admin may issue a refund", 403);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_refund", {
      p_order_id: input.orderId,
      p_idempotency_key: input.idempotencyKey,
      p_amount: input.amount ?? null,
      p_reason: input.reason,
      p_actor_id: caller.userId,
      p_destination: "wallet",
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, { fn: FN, userId: caller.userId, code: "REFUND_FAULT", level: "fatal" });
      return fail("PAYMENT_SETUP_FAILED", "refund could not be processed", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      refundId: r.refundId,
      amount: Number(r.amount),
      walletCredited: Number(r.walletCredited),
      gatewayRefunded: Number(r.gatewayRefunded),
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, level: "fatal" });
    return fail("PAYMENT_SETUP_FAILED", "unexpected error, please retry", 500);
  }
}
