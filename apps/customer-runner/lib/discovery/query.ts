/**
 * The shopping query — one object describing everything the customer has
 * narrowed to, and the only thing screens pass around.
 *
 * Search, category browsing and filtering are NOT three different
 * mechanisms here. They are three ways of editing the same object, which
 * is why a customer can search "milk", then narrow to Dairy, then to
 * Amul, then sort by price, without any screen having to reconcile three
 * competing sources of truth. It is also what makes state restoration on
 * back-navigation trivial: restore one object.
 *
 * Everything in here is pure. No React, no network, no Supabase — so the
 * serialisation rules and the key builder can be tested directly, and so
 * this module can be imported from a screen, a hook or a test without
 * dragging a client along.
 *
 * MONEY: `minPrice`/`maxPrice` are RUPEES here, not paise. Internally the
 * product money is integer paise (D7) and this module converts at the
 * boundary. Rupees are used in the URL because a customer may see and
 * share it, and `min=20` is legible where `min=2000` is a trap.
 */

/** Sorts that REAL columns can back. Nothing here is aspirational. */
export type SortKey = "featured" | "price_asc" | "price_desc" | "newest";

export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  // The store's own `sort_order` column. This is genuine merchandising
  // intent set by whoever curates the catalogue - not a popularity score,
  // which the product does not have.
  { key: "featured", label: "Featured" },
  { key: "price_asc", label: "Price: low to high" },
  { key: "price_desc", label: "Price: high to low" },
  { key: "newest", label: "Newest" },
] as const;

/**
 * Deliberately ABSENT sorts, recorded so nobody adds them by reflex:
 *
 *   "Relevance"  - undefined for this product. Search is an `ilike`
 *                  match, which is binary: a row matches or it does not.
 *                  There is no score to sort by, so offering the option
 *                  would be a lie the customer cannot detect.
 *   "Discount"   - would require ordering by `(mrp - sale_price)`, an
 *                  expression PostgREST cannot order by unless it is a
 *                  real column. Adding one is a backend change and out of
 *                  scope.
 *   "Popularity" - no order-count or view-count data exists anywhere.
 */

export interface ProductQuery {
  /** Free-text search. Empty string means "not searching". */
  q: string;
  /** Exact `products.category` value, or null for all categories. */
  category: string | null;
  /** Exact `products.brand` values. Empty means "any brand". */
  brands: string[];
  /** Rupees. null means unbounded on that end. */
  minPrice: number | null;
  maxPrice: number | null;
  /** true = hide sold-out products. false = show everything. */
  inStockOnly: boolean;
  sort: SortKey;
}

export const EMPTY_QUERY: ProductQuery = {
  q: "",
  category: null,
  brands: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
  sort: "featured",
};

/**
 * How many of the FILTERS are active — used for the badge on the Filter
 * control. Deliberately excludes `q`, `category` and `sort`: those are
 * shown elsewhere in the UI (the search field, the category rail, the
 * sort control), and counting them would tell the customer they have
 * "3 filters" when they have merely opened a category.
 */
export function activeFilterCount(query: ProductQuery): number {
  let n = 0;
  if (query.brands.length > 0) n += query.brands.length;
  if (query.minPrice !== null || query.maxPrice !== null) n += 1;
  if (query.inStockOnly) n += 1;
  return n;
}

/** Any narrowing at all, filters included. Drives the "no results" copy. */
export function hasAnyNarrowing(query: ProductQuery): boolean {
  return (
    query.q.trim().length > 0 || query.category !== null || activeFilterCount(query) > 0
  );
}

/**
 * Clear the FILTERS but keep the shopping context.
 *
 * "Clear all" that also dropped the search term and the category would
 * throw the customer back to the top of the store, which is punishing
 * when all they wanted was to widen a price range. §25.
 */
export function clearFilters(query: ProductQuery): ProductQuery {
  return {
    ...query,
    brands: [],
    minPrice: null,
    maxPrice: null,
    inStockOnly: false,
  };
}

/**
 * A stable, canonical cache key.
 *
 * Two queries that mean the same thing MUST produce the same key or the
 * cache silently duplicates work: brands are sorted so ["b","a"] and
 * ["a","b"] are one entry, and the search term is trimmed and lowercased
 * so "Milk " and "milk" do not fetch twice.
 */
export type ProductQueryKey = readonly [
  "products",
  {
    q: string;
    category: string | null;
    brands: string[];
    minPrice: number | null;
    maxPrice: number | null;
    inStockOnly: boolean;
    sort: SortKey;
  },
];

export function queryKey(query: ProductQuery): ProductQueryKey {
  return [
    "products",
    {
      q: query.q.trim().toLowerCase(),
      category: query.category,
      brands: [...query.brands].sort(),
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      inStockOnly: query.inStockOnly,
      sort: query.sort,
    },
  ] as const;
}

// ---------------------------------------------------------------------
// URL / route-param serialisation
// ---------------------------------------------------------------------
// Round-trips through Expo Router params, which are the same shape on
// web (a query string a customer can share) and on native (route state
// that survives navigating to a product and back). One representation
// for both is what stops mobile and web drifting apart. §12, §13.

/** Only non-default values are emitted, so a plain URL stays plain. */
export function toParams(query: ProductQuery): Record<string, string> {
  const p: Record<string, string> = {};
  if (query.q.trim()) p.q = query.q.trim();
  if (query.category) p.category = query.category;
  if (query.brands.length) p.brand = [...query.brands].sort().join(",");
  if (query.minPrice !== null) p.min = String(query.minPrice);
  if (query.maxPrice !== null) p.max = String(query.maxPrice);
  if (query.inStockOnly) p.stock = "1";
  if (query.sort !== "featured") p.sort = query.sort;
  return p;
}

function positiveInt(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  // Rejects NaN, negatives, Infinity and fractional rupees. A hostile or
  // stale URL must degrade to "no bound", never to a broken query.
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function fromParams(params: Record<string, unknown>): ProductQuery {
  const raw = (k: string): string | undefined => {
    const v = params[k];
    // Expo Router hands back string | string[] depending on how a param
    // was set; the array form is a repeated key, where last wins.
    if (Array.isArray(v)) return typeof v[v.length - 1] === "string" ? (v[v.length - 1] as string) : undefined;
    return typeof v === "string" ? v : undefined;
  };

  const sortRaw = raw("sort");
  const sort = SORT_OPTIONS.some((o) => o.key === sortRaw) ? (sortRaw as SortKey) : "featured";

  let minPrice = positiveInt(raw("min"));
  let maxPrice = positiveInt(raw("max"));
  // An inverted range returns nothing and looks like a broken catalogue,
  // so swap rather than obey it literally.
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  return {
    q: raw("q")?.trim() ?? "",
    category: raw("category") || null,
    brands: (raw("brand") ?? "")
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean),
    minPrice,
    maxPrice,
    inStockOnly: raw("stock") === "1",
    sort,
  };
}
