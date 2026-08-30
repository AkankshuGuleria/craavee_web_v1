// validate_promo — API_CONTRACTS.md §3. Advisory ONLY: the checkout UI
// calls this to show the discount before the customer commits. The
// authoritative re-validation happens inside create_order Phase A under
// the promos row lock — this response is never trusted.
//
// Never throws: an inapplicable promo is a normal outcome, expressed as
// { valid: false, reason }.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { validatePromoSchema } from "../_shared/validation.ts";

export async function handleValidatePromo(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = validatePromoSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "customer") return fail("FORBIDDEN", "customer only", 403);

  const db = serviceClient();
  const { data, error } = await db.rpc("validate_promo_preview", {
    p_code: parsed.data.code,
    p_customer_id: caller.userId,
    p_subtotal: parsed.data.orderSubtotal,
  });

  if (error) {
    // Advisory endpoint — degrade to "can't validate right now" rather
    // than surfacing a DB fault.
    return ok({ valid: false, reason: "INVALID_PROMO" });
  }

  const r = data as { valid: boolean; discountAmount?: number; reason?: string };
  return ok(
    r.valid
      ? { valid: true, discountAmount: r.discountAmount ?? 0 }
      : { valid: false, reason: r.reason ?? "INVALID_PROMO" },
  );
}
