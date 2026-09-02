// admin_adjust_inventory — Phase 9B.
//
// RBAC_MATRIX.md §4 permits a manual stock count as a plain RLS write.
// This exists for the one thing that path cannot do: write audit_logs,
// which is service-role-INSERT only. A stock correction changes what the
// store claims it can deliver, so it belongs in the record.
//
// Only qty_on_hand is adjustable. qty_reserved belongs to the order
// lifecycle and there is deliberately no field for it in the request.
import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { adminAdjustInventorySchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "admin_adjust_inventory";

export async function handleAdminAdjustInventory(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = adminAdjustInventorySchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") return fail("FORBIDDEN", "admin role required", 403);

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_admin_adjust_inventory", {
      p_store_id: input.storeId,
      p_product_id: input.productId,
      p_actor_id: caller.userId,
      p_qty_on_hand: input.qtyOnHand,
      p_reason: input.reason,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, { fn: FN, userId: caller.userId, code: "INVENTORY_ADJUST_FAULT", level: "error" });
      return fail("SERVICE_UNAVAILABLE", "stock could not be corrected, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({
      storeId: r.storeId, productId: r.productId,
      qtyOnHand: r.qtyOnHand, qtyReserved: r.qtyReserved,
      previousOnHand: r.previousOnHand,
    });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, level: "error" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
