/**
 * Shopping-query tests.
 *
 * Three properties matter here and all three are silent when broken:
 * cache-key canonicality (a mismatch duplicates every request rather than
 * erroring), round-trip fidelity (a lost filter looks like the server
 * ignoring the customer), and hostile-input tolerance (a shared or stale
 * URL must degrade, never break the screen).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_QUERY,
  activeFilterCount,
  clearFilters,
  fromParams,
  hasAnyNarrowing,
  queryKey,
  toParams,
  type ProductQuery,
} from "../query.ts";

const base: ProductQuery = { ...EMPTY_QUERY };

test("brand order does not change the cache key", () => {
  // Two customers reaching the same filtered view from different
  // directions must share one cache entry, not fetch twice.
  const a = queryKey({ ...base, brands: ["Amul", "Bisleri"] });
  const b = queryKey({ ...base, brands: ["Bisleri", "Amul"] });
  assert.deepEqual(a, b);
});

test("search term casing and padding do not change the cache key", () => {
  assert.deepEqual(queryKey({ ...base, q: "  Milk " }), queryKey({ ...base, q: "milk" }));
});

test("genuinely different queries produce different keys", () => {
  const k = (q: Partial<ProductQuery>) => JSON.stringify(queryKey({ ...base, ...q }));
  const keys = new Set([
    k({}),
    k({ category: "Dairy" }),
    k({ brands: ["Amul"] }),
    k({ minPrice: 20 }),
    k({ maxPrice: 20 }),
    k({ inStockOnly: true }),
    k({ sort: "price_asc" }),
  ]);
  assert.equal(keys.size, 7, "two distinct queries collapsed onto one cache key");
});

test("params round-trip without losing a filter", () => {
  const q: ProductQuery = {
    q: "milk",
    category: "Dairy",
    brands: ["Amul", "Mother Dairy"],
    minPrice: 20,
    maxPrice: 100,
    inStockOnly: true,
    sort: "price_asc",
  };
  assert.deepEqual(fromParams(toParams(q)), q);
});

test("a default query serialises to nothing", () => {
  // A plain category URL should stay plain rather than carrying six
  // redundant "everything" parameters.
  assert.deepEqual(toParams(EMPTY_QUERY), {});
});

test("featured sort is omitted from params because it is the default", () => {
  assert.equal(toParams({ ...base, sort: "featured" }).sort, undefined);
  assert.equal(toParams({ ...base, sort: "newest" }).sort, "newest");
});

test("an unknown sort in a URL falls back to featured rather than breaking", () => {
  assert.equal(fromParams({ sort: "price_desc" }).sort, "price_desc");
  assert.equal(fromParams({ sort: "rating" }).sort, "featured");
  assert.equal(fromParams({ sort: "" }).sort, "featured");
});

test("hostile or stale price params degrade to no bound", () => {
  for (const bad of ["abc", "-5", "1e999", "3.5", "", "  "]) {
    const out = fromParams({ min: bad });
    assert.equal(out.minPrice, null, `min=${JSON.stringify(bad)} should be ignored`);
  }
});

test("an inverted price range is swapped, not obeyed", () => {
  // Obeying min=100&max=20 returns nothing, which reads as an empty shop
  // rather than as a bad URL.
  const out = fromParams({ min: "100", max: "20" });
  assert.equal(out.minPrice, 20);
  assert.equal(out.maxPrice, 100);
});

test("a repeated param takes the last value", () => {
  assert.equal(fromParams({ category: ["Dairy", "Snacks"] }).category, "Snacks");
});

test("empty brand segments are dropped", () => {
  assert.deepEqual(fromParams({ brand: "Amul,,  ,Bisleri" }).brands, ["Amul", "Bisleri"]);
});

test("the filter count excludes search, category and sort", () => {
  // Those three are visible elsewhere in the UI. Counting them would tell
  // a customer they have filters applied when they only opened a category.
  assert.equal(activeFilterCount({ ...base, q: "milk", category: "Dairy", sort: "newest" }), 0);
  assert.equal(activeFilterCount({ ...base, brands: ["Amul", "Bisleri"] }), 2);
  assert.equal(activeFilterCount({ ...base, minPrice: 20 }), 1);
  assert.equal(activeFilterCount({ ...base, minPrice: 20, maxPrice: 90 }), 1, "a range is one filter");
  assert.equal(activeFilterCount({ ...base, inStockOnly: true }), 1);
});

test("clearing filters keeps the shopping context", () => {
  const q: ProductQuery = {
    q: "milk",
    category: "Dairy",
    brands: ["Amul"],
    minPrice: 20,
    maxPrice: 90,
    inStockOnly: true,
    sort: "price_asc",
  };
  const cleared = clearFilters(q);
  assert.equal(cleared.q, "milk", "clearing filters must not drop the search");
  assert.equal(cleared.category, "Dairy", "clearing filters must not drop the category");
  assert.equal(cleared.sort, "price_asc", "clearing filters must not reset the sort");
  assert.equal(activeFilterCount(cleared), 0);
});

test("hasAnyNarrowing sees search, category and filters", () => {
  assert.equal(hasAnyNarrowing(EMPTY_QUERY), false);
  assert.equal(hasAnyNarrowing({ ...base, q: "milk" }), true);
  assert.equal(hasAnyNarrowing({ ...base, category: "Dairy" }), true);
  assert.equal(hasAnyNarrowing({ ...base, inStockOnly: true }), true);
  assert.equal(hasAnyNarrowing({ ...base, sort: "newest" }), false, "sorting is not narrowing");
});
