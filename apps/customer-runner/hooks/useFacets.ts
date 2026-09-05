/**
 * The real classification of the catalogue: which categories exist, and
 * which brands.
 *
 * These are derived from the catalogue query the home screen already
 * loads, so opening the filter sheet costs **zero additional requests**.
 * That is the right trade at campus-catalogue size and it keeps filtering
 * feeling instant.
 *
 * RECORDED SCALING LIMIT, not pre-solved: this reads the facets off a
 * fetched page of products, so once the catalogue outgrows a single
 * response the brand list becomes "brands among the products we happened
 * to load", which is wrong in a way that is invisible. The fix is a
 * server-side distinct — either a small view or an RPC — and it is a
 * backend change, deliberately out of scope for this slice.
 *
 * Nothing here is invented. Categories and brands are the distinct values
 * of `products.category` and `products.brand`. There is NO subcategory
 * column in the schema, so this module exposes no subcategories; §4 says
 * do not fake them, and a two-level rail built on a one-level table would
 * be exactly that.
 */
import { useMemo } from "react";

import { useCatalog } from "./useCatalog";

export interface Facets {
  /** Distinct categories, ordered by how the catalogue itself is ordered. */
  categories: string[];
  /** Distinct non-null brands, alphabetical. */
  brands: string[];
  /** Rupee bounds of the whole catalogue, for the price control. */
  priceFloor: number;
  priceCeiling: number;
  isPending: boolean;
}

/**
 * @param category  When set, the BRAND list is narrowed to brands that
 *   actually appear in that category. Offering all 21 brands inside a
 *   4-product category means most choices return zero results - a filter
 *   that is technically correct and practically a trap.
 *
 *   The price bounds are deliberately NOT narrowed. They are the whole
 *   catalogue's range on purpose: buckets that silently re-scale as the
 *   customer switches category would make "Under ₹59" mean something
 *   different from one screen to the next.
 */
export function useFacets(category?: string | null): Facets {
  const catalog = useCatalog();

  return useMemo(() => {
    const products = catalog.data ?? [];
    const inScope = category ? products.filter((p) => p.category === category) : products;

    // Insertion order, not alphabetical: `useCatalog` orders by category
    // then sort_order, so this preserves the store's own arrangement.
    // Alphabetising would silently override merchandising intent.
    const categories: string[] = [];
    const seenCategory = new Set<string>();
    for (const p of products) {
      if (p.category && !seenCategory.has(p.category)) {
        seenCategory.add(p.category);
        categories.push(p.category);
      }
    }

    // Brands ARE alphabetical - there is no meaningful brand ordering in
    // the data, and a filter list the customer scans wants to be
    // predictable. Nulls are dropped rather than shown as "(none)":
    // "no brand recorded" is not a brand a customer would filter by.
    const brands = [...new Set(inScope.map((p) => p.brand).filter((b): b is string => !!b))].sort(
      (a, b) => a.localeCompare(b),
    );

    const prices = products.map((p) => p.salePrice);
    const priceFloor = prices.length ? Math.floor(Math.min(...prices) / 100) : 0;
    const priceCeiling = prices.length ? Math.ceil(Math.max(...prices) / 100) : 0;

    return {
      categories,
      brands,
      priceFloor,
      priceCeiling,
      isPending: catalog.isPending,
    };
  }, [catalog.data, catalog.isPending, category]);
}
