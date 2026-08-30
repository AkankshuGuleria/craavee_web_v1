import { useQuery } from "@tanstack/react-query";

import { supabase } from "../lib/supabase";

/**
 * Live catalog query — Phase 3 §10/§11.
 *
 * Reads `products_with_availability` (defined in
 * `supabase/migrations/0003_rls_policies.sql`), never the base `products`/
 * `inventory` tables directly:
 *   - `is_listed = true` is already applied by the view's own WHERE
 *     clause — an unlisted product never reaches this query.
 *   - `is_available` is a boolean computed server-side from
 *     `qty_on_hand - qty_reserved > 0` — the client never sees, and
 *     therefore can never spoof, an exact stock count (RBAC_MATRIX.md
 *     §5's `inventory` entry: "a deliberate choice to avoid a customer
 *     inferring exact stock/sales volume").
 *   - No supplier/admin-only/internal-inventory field exists on this view
 *     at all — there is nothing to accidentally over-select.
 *
 * The view is granted to `authenticated, anon` (RBAC_MATRIX.md's
 * "own store" note for customers is a UX/app-level scoping concern here,
 * not an RLS restriction — see PHASE_3_IMPLEMENTATION_REPORT.md §5; the
 * seed data has exactly one store, so no store filter is applied this
 * phase). This app still only calls it from behind the auth-gated
 * `(customer)` route group — Phase 3 §6/§7's flow — even though the
 * database itself would also permit a pre-auth read.
 */
export type CatalogProduct = {
  id: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  mrp: number;
  salePrice: number;
  unitLabel: string | null;
  category: string;
  isAvailable: boolean;
};

async function fetchCatalog(): Promise<CatalogProduct[]> {
  const { data, error } = await supabase
    .from("products_with_availability")
    .select("id, name, brand, image_url, mrp, sale_price, unit_label, category, is_available")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) throw error;

  // The view's generated Row type has every column nullable (a `left join`
  // result, per packages/types/src/database.ts) even though `id`/`name`/
  // `mrp`/`sale_price`/`category` are NOT NULL on the underlying `products`
  // table (0001_init.sql) — a left join against `inventory` can never
  // null out a `products` column. Narrowed here, once, rather than
  // threading `| null` through every consumer of a value that cannot
  // actually be null.
  return (data ?? []).map((row) => ({
    id: row.id!,
    name: row.name!,
    brand: row.brand,
    imageUrl: row.image_url,
    mrp: row.mrp!,
    salePrice: row.sale_price!,
    unitLabel: row.unit_label,
    category: row.category!,
    isAvailable: row.is_available ?? false,
  }));
}

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: fetchCatalog,
    staleTime: 60_000,
    retry: 2,
  });
}
