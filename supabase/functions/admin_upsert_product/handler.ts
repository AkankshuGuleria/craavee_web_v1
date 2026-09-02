// admin_upsert_product — Phase 9B.
//
// Catalog and pricing edits, audited with the before/after price. Same
// reasoning as admin_adjust_inventory: RBAC §4 allows the plain RLS
// write, but a price is what the next customer pays and that belongs in
// the record.
//
// Prices arrive as integers in paise (D7). There is no decimal anywhere
// in this path.
import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { adminUpsertProductSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "admin_upsert_product";

export async function handleAdminUpsertProduct(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = adminUpsertProductSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") return fail("FORBIDDEN", "admin role required", 403);

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_admin_upsert_product", {
      p_product_id: input.productId ?? null,
      p_store_id: input.storeId,
      p_actor_id: caller.userId,
      p_name: input.name,
      p_brand: input.brand ?? null,
      p_category: input.category,
      p_unit_label: input.unitLabel ?? null,
      p_mrp: input.mrp,
      p_sale_price: input.salePrice,
      p_is_listed: input.isListed ?? null,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, { fn: FN, userId: caller.userId, code: "PRODUCT_UPSERT_FAULT", level: "error" });
      return fail("SERVICE_UNAVAILABLE", "the product could not be saved, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({ productId: r.productId, action: r.action, salePrice: r.salePrice, isListed: r.isListed });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, level: "error" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
