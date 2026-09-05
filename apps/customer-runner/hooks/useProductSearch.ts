/**
 * Product search.
 *
 * SERVER-SIDE, against the view the catalog already reads. There is no
 * new table, function, index or migration behind this - `products_with_
 * availability` is a `security_barrier` view that already filters
 * `is_listed = true` and is already granted to `authenticated, anon`
 * (0003_rls_policies.sql). Searching it through PostgREST is the smallest
 * correct implementation, so the backend was left untouched.
 *
 * Why server-side at all, when the whole catalog is already cached and a
 * local `.filter()` would be instant and free? Because the cached catalog
 * is *one unpaginated page of a currently tiny seed*. Filtering it would
 * quietly become "search only finds the first N products" the moment the
 * catalog outgrows one response, and that failure is invisible in
 * testing. The query is cheap and correct instead.
 *
 * Known scaling limit, recorded rather than pre-solved: `ilike '%q%'`
 * cannot use a btree index, so this is a sequential scan. At campus
 * catalogue size (tens to low hundreds of products) that is nothing. A
 * `pg_trgm` GIN index is the fix when it stops being nothing - a backend
 * change, deliberately out of scope for this slice.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { CatalogProduct } from "./useCatalog";
import { MIN_QUERY_LENGTH, sanitiseQuery } from "../lib/search/query";
import { supabase } from "../lib/supabase";

export { MIN_QUERY_LENGTH } from "../lib/search/query";

export function useProductSearch(rawQuery: string) {
  const q = sanitiseQuery(rawQuery);
  const enabled = q.length >= MIN_QUERY_LENGTH;

  return useQuery({
    queryKey: ["search", q.toLowerCase()],
    enabled,

    // Two queries for the same term - from two screens, or from a
    // re-focus - are deduplicated by TanStack on the key alone. The
    // 5-minute staleTime then means retyping a recent term is answered
    // from cache with no request at all, which is what makes back-and-
    // forth searching feel instant.
    staleTime: 5 * 60_000,

    // Keeps the previous term's results on screen while the next term is
    // in flight, so the list does not blank out between keystrokes. The
    // caller distinguishes this from fresh data via `isPlaceholderData`.
    placeholderData: keepPreviousData,

    queryFn: async ({ signal }): Promise<CatalogProduct[]> => {
      const pattern = `%${q}%`;
      const { data, error } = await supabase
        .from("products_with_availability")
        .select("id, name, brand, image_url, mrp, sale_price, unit_label, category, is_available")
        .or(`name.ilike.${pattern},brand.ilike.${pattern},category.ilike.${pattern}`)
        // Available things first: a sold-out match is still a useful
        // answer ("we stock it, not right now") but never the headline.
        .order("is_available", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(50)
        // Cancellation. Without this an abandoned term's response can
        // land after a newer one and overwrite it.
        .abortSignal(signal);

      if (error) throw error;

      // Same narrowing as useCatalog: the view's generated Row type has
      // every column nullable because it is a left join, though a
      // `products` column cannot actually be nulled by it.
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
    },
  });
}
