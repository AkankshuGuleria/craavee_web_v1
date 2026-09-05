/**
 * The one product query. Search, category browse and filtered results all
 * come through here.
 *
 * There is deliberately no second code path for "search results" versus
 * "category results" versus "the catalogue": they differ only by which
 * fields of `ProductQuery` are set. A single path means a filter cannot
 * work in one place and silently not in another, and it means the cache
 * is shared — narrowing from a search to a category reuses everything
 * already known.
 *
 * EVERYTHING IS SERVER-SIDE. Filtering, sorting and paging are PostgREST
 * operations against `products_with_availability` — the same
 * `security_barrier` view the catalogue already reads, already granted to
 * `authenticated, anon`. No migration, no function, no index, no RLS
 * change. The client never downloads the catalogue to filter it locally,
 * which is the thing that quietly stops working at scale (§15, §39).
 *
 * Ordering note: an `is_available` tiebreak is applied first on every
 * sort. A sold-out product is still a legitimate answer — "we stock this,
 * just not now" — but it should never head the list a customer is trying
 * to buy from.
 */
import { useInfiniteQuery } from "@tanstack/react-query";

import type { CatalogProduct } from "./useCatalog";
import { queryKey, type ProductQuery, type ProductQueryKey } from "../lib/discovery/query";
import { sanitiseQuery } from "../lib/search/query";
import { supabase } from "../lib/supabase";

/**
 * Bounded page size. The point is not this number, it is that a page is
 * bounded at all: without `.range()` the query returns whatever the
 * catalogue happens to be, which is fine at 24 products and a download at
 * 10,000.
 */
export const PAGE_SIZE = 20;

const COLUMNS =
  "id, name, brand, image_url, mrp, sale_price, unit_label, category, is_available";

export interface ProductPage {
  products: CatalogProduct[];
  /** Total matching rows, from PostgREST's exact count — used for "N results". */
  total: number;
  nextPage: number | null;
}

function mapRow(row: Record<string, unknown>): CatalogProduct {
  // Same narrowing as useCatalog: the view's generated Row type has every
  // column nullable because it is a left join, though a `products` column
  // cannot actually be nulled by it.
  return {
    id: row.id as string,
    name: row.name as string,
    brand: (row.brand as string | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    mrp: row.mrp as number,
    salePrice: row.sale_price as number,
    unitLabel: (row.unit_label as string | null) ?? null,
    category: row.category as string,
    isAvailable: (row.is_available as boolean | null) ?? false,
  };
}

export function useProductFeed(query: ProductQuery, enabled = true) {
  return useInfiniteQuery<ProductPage, Error, { pages: ProductPage[]; pageParams: number[] }, ProductQueryKey, number>({
    queryKey: queryKey(query),
    enabled,
    initialPageParam: 0,
    staleTime: 60_000,
    // Narrowing a filter should not blank the screen. The previous
    // result set stays visible while the new one loads; callers show it
    // dimmed via `isPlaceholderData` rather than replacing it with a
    // spinner, which is what makes filtering feel immediate.
    placeholderData: (prev) => prev,

    getNextPageParam: (last: ProductPage) => last.nextPage,

    queryFn: async ({ pageParam, signal }): Promise<ProductPage> => {
      const page = pageParam;
      const from = page * PAGE_SIZE;

      let req = supabase
        .from("products_with_availability")
        // `exact` so the result count is truthful rather than estimated;
        // the catalogue is small enough that the cost is irrelevant, and
        // "12 results" has to actually mean 12.
        .select(COLUMNS, { count: "exact" });

      const term = sanitiseQuery(query.q);
      if (term.length >= 2) {
        const pattern = `%${term}%`;
        req = req.or(
          `name.ilike.${pattern},brand.ilike.${pattern},category.ilike.${pattern}`,
        );
      }

      if (query.category) req = req.eq("category", query.category);
      if (query.brands.length > 0) req = req.in("brand", query.brands);

      // Rupees at the boundary -> integer paise for the column (D7).
      if (query.minPrice !== null) req = req.gte("sale_price", query.minPrice * 100);
      if (query.maxPrice !== null) req = req.lte("sale_price", query.maxPrice * 100);

      if (query.inStockOnly) req = req.eq("is_available", true);

      req = req.order("is_available", { ascending: false });
      switch (query.sort) {
        case "price_asc":
          req = req.order("sale_price", { ascending: true });
          break;
        case "price_desc":
          req = req.order("sale_price", { ascending: false });
          break;
        case "newest":
          req = req.order("created_at", { ascending: false });
          break;
        case "featured":
        default:
          // The store's own curation column, not a popularity score.
          req = req.order("sort_order", { ascending: true });
          break;
      }
      // A stable final tiebreak. Without it, rows with equal sort values
      // can come back in a different order per page and a product can
      // appear twice across page boundaries, or not at all.
      req = req.order("id", { ascending: true });

      const { data, error, count } = await req
        .range(from, from + PAGE_SIZE - 1)
        .abortSignal(signal);

      if (error) throw error;

      const products = (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
      const total = count ?? products.length;
      const seen = from + products.length;

      return {
        products,
        total,
        nextPage: seen < total && products.length > 0 ? page + 1 : null,
      };
    },
  });
}

/** Flatten pages for rendering, and report the honest total. */
export function flattenFeed(pages: ProductPage[] | undefined): {
  products: CatalogProduct[];
  total: number;
} {
  if (!pages || pages.length === 0) return { products: [], total: 0 };
  return {
    products: pages.flatMap((p) => p.products),
    total: pages[0].total,
  };
}
