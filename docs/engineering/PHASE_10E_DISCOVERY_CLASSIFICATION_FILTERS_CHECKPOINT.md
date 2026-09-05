# Phase 10E — Slice 3: Discovery Architecture, Classification & Filters

**Branch:** `feat/customer-discovery-filters-10e`
**Based on:** `feat/customer-search-product-10e` @ `4816d60` (PR #25, open)
**`main`:** `61007ed7b76d646ad5275181ab2f14db1751ef97`
**Date:** 2026-09-05

**Backend changes: zero.** `git diff --name-only -- supabase` returns 0 files.

---

## 1. Branching (§0, §46)

§47 nominates `main` as the base. That is not possible without discarding
work: PR #24 and PR #25 are both open and unmerged, and this slice builds
directly on Slice 2's `ProductCard`, `Price`, `ProductImage`, `QtyStepper`
and search plumbing. Basing on `main` would mean re-implementing all of
it.

§0 anticipates exactly this — "if the previous Customer slice is still
unmerged, determine the cleanest reviewable branching strategy" — so this
is a third stacked branch. Merge order: **#24 → #25 → this**. Nothing here
presumes any of those merges have happened.

## 2. Product data audit (§3) — run before any UI

Measured against **real staging** (`awahemlbgmymahpvhczk`), 24 products.

| Field | Source | Available? | Filter? | Classification? |
|---|---|---|---|---|
| `category` | `products.category` (text) | **Yes — 8 values** | Yes | **Yes, primary** |
| *subcategory* | — | **No such column** | No | **No — not faked** |
| `brand` | `products.brand` | Yes — 21 values, 2 null | Yes | Secondary |
| `name` | `products.name` | Yes | Search only | No |
| `sale_price` | `products.sale_price` | Yes — ₹18–₹140 | Yes (range) | No |
| `mrp` | `products.mrp` | Yes | No (see below) | No |
| `is_available` | computed in view | Yes — 23 / 1 | Yes | No |
| `sort_order` | `products.sort_order` | Yes — 24 distinct | No | Sort (default) |
| `created_at` | `products.created_at` | Yes | No | Sort (newest) |
| `unit_label` | `products.unit_label` | Yes — 19 distinct | No — too granular | No |
| `image_url` | `products.image_url` | **0 of 24 populated** | No | No |
| inventory count | `inventory` | **Deliberately not exposed** — the view publishes only a boolean, so a customer cannot infer stock or sales volume | No | No |

Category distribution: Munchies & Snacks 4, Cold Drinks & Beverages 4,
Tea & Coffee 3, Ice Cream & Desserts 3, Instant Meals 3, Dairy 3,
Fruits & Vegetables 2, Personal Care 2.

### 2.1 Two findings that changed the design

**Subcategories do not exist.** There is no subcategory column, no
taxonomy table, and no delimiter convention inside `category`. §4 says do
not fake them, so the classification is deliberately **one level deep**.
A two-level rail over a one-level table would be invented structure.

**A discount filter would filter nothing.** All **24 of 24** products have
`sale_price < mrp`. A "Discounted" control would match the entire
catalogue — it would appear to work and do nothing, which is worse than
its absence. It is omitted, and becomes real the moment undiscounted
products exist.

## 3. Classification architecture (§4, §7)

**Category is the spine**, because it is the only real classification the
data has. It appears in three places, all reading the same values:

- a horizontal rail on Home (navigates into Browse)
- the same rail on Browse (switches category in place)
- the same rail on Search (connects search to classification, §22)

**Why a rail and not a tile grid.** Three reasons, in order of weight:
8 categories as large tiles push every product below the fold, so the
first screen becomes navigation furniture; there is **no category
artwork** in the data and the only way to fill a tile grid is to invent
imagery; and a rail keeps switching category to one tap, in place, rather
than a navigation round trip.

"All" is a first-class pill rather than a separate reset, because
clearing a category *is* choosing one — modelling it as one control keeps
the selected state unambiguous.

## 4. Home information architecture (§6, §27)

Before: header → search → one flat grid. It answered "what is in stock?"
and nothing else.

Now the screen answers four questions in order:

| Question | Answered by |
|---|---|
| Where am I? | Header |
| What can I get? | Category rail — real `products.category` values |
| How do I narrow? | Search entry; Browse with filters and sort |
| What's here? | Per-category sections, **capped at 4**, each with "See all" |

The cap is the point. A section rendering its whole category is the old
flat grid with headings; capping it turns Home into an **index** rather
than a dump, and gives every category a real entry point into filtered
results.

**Nothing is fabricated.** There is no "trending", "popular",
"recommended", "recently viewed" or "recently bought" section, because
the backend records no popularity, no view history and no purchase
history. Sections are category groupings of the real catalogue in the
store's own `sort_order`.

## 5. One query object, three surfaces (§12, §13, §17, §22, §26)

Search, category browsing and filtering are **not three mechanisms**.
They are three ways of editing one `ProductQuery`:

```
{ q, category, brands[], minPrice, maxPrice, inStockOnly, sort }
```

That single decision is what makes the rest fall out:

- **Cache** — one `queryKey` shape, canonicalised (brands sorted, term
  trimmed and lowercased) so two equivalent queries cannot become two
  cache entries.
- **URL state (§12)** — the query lives in **route params**, so on web
  `/browse?category=Dairy&brand=Amul&sort=price_asc` is shareable.
- **State restoration (§13, §26)** — on native the same params are route
  state, so product-detail-and-back restores category, filters and sort
  **with no save/restore code at all**. Nothing was ever held outside the
  route.
- **No duplicate paths** — a filter cannot work on Browse and silently
  not on Search.

`setParams` replaces rather than pushes, so adjusting a filter does not
bury the customer under back-presses.

Serialisation is defensive: unknown sorts fall back to `featured`,
hostile price params degrade to "no bound", and an inverted range is
swapped rather than obeyed (obeying `min=100&max=20` returns nothing and
reads as an empty shop rather than a bad URL). **19 unit tests** pin this.

## 6. Filters (§9, §10, §25)

| Filter | Backed by | Notes |
|---|---|---|
| Category | `category` eq | Also the rail |
| Brand | `brand` in (…) | Multi-select, 21 real values |
| Price | `sale_price` gte/lte | Three buckets derived from the real ₹18–₹140 range |
| Availability | `is_available` eq | "In stock only" |
| ~~Discount~~ | — | **Omitted — zero selectivity, see §2.1** |

**Price buckets, not a slider.** A two-thumb slider is fiddly one-handed,
hard to make accessible, and needs gesture wiring. Buckets computed from
the catalogue's actual range are one tap, screen-reader friendly by
construction, and cannot suggest a range the catalogue does not contain.

**The sheet holds draft state and commits on Apply.** Live-applying every
toggle would fire a request per tap and make a multi-part filter
impossible to assemble without watching the list thrash.

**"Clear all" keeps the shopping context** — it clears brands, price and
availability but preserves the search term, the category and the sort
(§25). Clearing filters should widen results, not evict the customer from
the aisle.

**Why `Modal` and not `@gorhom/bottom-sheet`**, which is a declared
dependency: adopting it requires wiring `GestureHandlerRootView` and the
gesture handler into the root layout — a native integration change
affecting every screen — and its web story is the weakest of the three
platforms this slice ships on. `Modal` is already proven here, behaves
natively on iOS and Android, works on web, and needs no new wiring. A
gesture-driven sheet is a worthwhile change on its own merits, not a
dependency this feature should take on.

## 7. Sorting (§14)

| Offered | Backed by |
|---|---|
| Featured (default) | `sort_order` — the store's real curation column |
| Price: low to high | `sale_price` asc |
| Price: high to low | `sale_price` desc |
| Newest | `created_at` desc |

**Deliberately absent, and why** — recorded in the source so nobody adds
them by reflex:

- **Relevance** — undefined here. Search is an `ilike` match, which is
  binary: a row matches or it does not. There is no score to sort by, so
  the option would be a lie the customer cannot detect.
- **Discount** — needs ordering by `(mrp - sale_price)`, an expression
  PostgREST cannot order by unless it is a real column. That is a backend
  change.
- **Popularity** — no order-count or view-count data exists anywhere.

Every sort applies an `is_available` tiebreak first: a sold-out product is
a legitimate answer ("we stock this, just not now") but must never head a
list someone is buying from. A final `id` tiebreak keeps paging stable —
without it, rows with equal sort values can reorder between pages and a
product can appear twice or not at all.

## 8. Server-side everything (§15, §39)

Filtering, sorting and paging are PostgREST operations against
`products_with_availability` — the same `security_barrier` view the
catalogue already reads, already granted to `authenticated, anon`. **No
migration, no function, no index, no RLS change.**

The client never downloads the catalogue to filter locally. Pages are
bounded at 20 rows via `.range()` with an exact count, so "12 items" means
12. Infinite scroll appends pages.

### Recorded scaling limits, not pre-solved

- **`ilike '%q%'` is a sequential scan** — no btree index can serve a
  leading wildcard. Irrelevant at 24 products; `pg_trgm` is the fix.
- **Facets are derived from the loaded catalogue page.** Once the
  catalogue outgrows one response, the brand list becomes "brands among
  the products we happened to load", which is wrong invisibly. The fix is
  a server-side distinct (a small view or RPC) — a backend change.

Both are backend changes and deliberately out of scope.

## 9. Product grid and card (§18, §19)

Unchanged from Slice 2 and deliberately so — the grid was rebuilt one
slice ago and re-doing it would be churn. It is now rendered through a
single shared `ProductResults`, so category results and search results
cannot drift apart, and every result state (pending / error / empty /
settling / paging) exists once.

The persistent cart bar was extracted to `CartBar` — it was duplicated on
two screens and about to be duplicated onto two more.

## 10. Image strategy (§20)

Unchanged from Slice 2: three genuinely distinct states — loaded, absent
(no URL in the catalogue), failed (URL that did not load). Staging has
**0 of 24** products with an image URL, so every tile shows the monogram
fallback, which reads as "before photography" rather than as breakage.

**No image was fabricated, scraped, hot-linked or embedded.** Populating
staging photography remains a **data task**.

## 11. Motion and haptics (§30, §31)

**Motion.** Deliberately restrained. The sheets use the platform's own
slide presentation; filtering shows the previous results dimmed to 55%
rather than animating a transition. §30 warns that motion must not make
filtering feel slower, and an animated list re-flow on every filter
change is exactly that. No new animation was added.

**Haptics.** `selection` on a category pill, a filter toggle, a sort
choice and a chip removal — all discrete selections. `success` on **Apply
only**, because that is the one committed change in the flow. §31 says do
not vibrate for every filter toggle; the toggles get the light selection
tick, not the notification.

## 12. Accessibility (§32)

| Requirement | Implementation |
|---|---|
| Category rail semantics | `tablist` / `tab` with `accessibilityState.selected` |
| Filter toggles | `checkbox` role with `accessibilityState.checked` |
| Sort options | `radio` role with `accessibilityState.selected` |
| Sheet semantics | `accessibilityViewIsModal`; Android hardware back closes via `onRequestClose` |
| Result count announced | `accessibilityLiveRegion="polite"` so the count change is heard after applying a filter |
| Chips | Each announces "Remove filter *X*" |
| Touch targets | Pills ≥40pt in a padded row; controls ≥36pt with `hitSlop`; sheet buttons 52pt; close 44×44 |
| Not colour alone | Selected pills carry weight + fill; selected toggles prefix "✓"; the sort choice shows a tick |

## 13. Performance (§16, §37)

**Architecture, measured where it matters:**

| Behaviour | Mechanism |
|---|---|
| Filter change → requests | One. `setParams` changes the query key; TanStack fetches once |
| Repeated filter combination | Zero — served from cache, `staleTime` 60s |
| Equivalent queries | One cache entry — brands sorted, term normalised in `queryKey` |
| Typing | 300ms debounce + `abortSignal` cancellation (measured in Slice 2: 22 keystrokes → 2 requests) |
| Result set size | Bounded at 20 per page via `.range()` |
| Full-catalogue download | **Never** — all filtering and sorting is server-side |
| Opening the filter sheet | Zero requests — facets derive from the already-cached catalogue |

**Observed on the physical device against real staging:** switching
category, applying a price filter and removing a chip each updated the
count (4 → 3 → 4) without a full-screen reload, with previous results
held on screen while the new set landed.

**No timing claim is made.** Nothing here measured milliseconds, frame
rate or memory, so nothing is asserted about them.

## 14. Validation

| Platform | Journeys exercised |
|---|---|
| **Android** (physical vivo V2250, real staging) | Home → See all → Browse → Filter → Apply → Product → Back with **state preserved**; category rail switching; chip removal |
| **iOS** (`Craavee_iPhone17`, real staging) | Same |
| **Web** (exported, served, driven in a browser) | Same, plus URL-addressable filter state |

### Two flaws found by running it, not by reading it

**"See all" would never have rendered.** It was conditional on
`total > SECTION_LIMIT`, and the largest category holds exactly 4 products
against a cap of 4. Every section would have been a dead end with no route
to its filters. The link is now unconditional — it is also the only path
to a category's filter and sort controls, which is worth offering even
when nothing is hidden.

**The brand filter offered brands that could not match.** Inside "Cold
Drinks & Beverages" — 4 products, 4 brands — the sheet listed all 21
catalogue brands, so most choices guaranteed zero results. Brand facets
are now scoped to the active category. Price bounds are deliberately NOT
scoped: buckets that silently re-scale per category would make "Under ₹59"
mean something different from one screen to the next.

## 15. Test matrix

| Check | Result |
|---|---|
| `typecheck` | 0 errors |
| `lint` | 0 errors, 2 warnings (pre-existing, `packages/ui`, identical on `main`) |
| `test` (unit) | **79 / 79** (was 65; +14 shopping-query tests) |
| `functions:check` | exit 0 |
| `functions:test` (gateway) | 9 passed, 0 failed |
| `db:test` (pgTAP) | 19 files, all green |
| `test:integration` | **223 / 223** |
| `build` (Store + Console) | 2 apps compiled |
| Backend files changed | **0** |
| Dependencies added | **0** |
| Secret scan | Clean — only `.env.example` tracked |

A React Compiler **error** (not a warning) was fixed properly rather than
suppressed: the filter sheet seeded its draft with
`useEffect(() => setDraft(query), [visible])`, the "you might not need an
effect" pattern. The draft now lives in a body component mounted only
while the sheet is open, so mounting seeds it and unmounting discards a
cancelled edit.

## 16. Known limitations

- **Subcategories do not exist** in the schema and were not invented.
  One-level classification is the honest ceiling of this data.
- **No discount filter** — 24/24 products are discounted, so it would
  filter nothing.
- **No relevance or popularity sort** — neither is defined by any column.
- **Facets derive from the loaded catalogue page.** Correct at 24
  products; needs a server-side distinct before the catalogue outgrows one
  response. Backend change, out of scope.
- **`ilike '%q%'` is a sequential scan.** `pg_trgm` when it matters.
- **0 of 24 products have image URLs**, so every tile is the monogram
  fallback. Data task; no image was invented.
- **Catalogue is small.** No claim is made about ranking quality,
  category relevance at scale, or filter behaviour on a large catalogue —
  only that the architecture is server-side, bounded and paginated.
- **No timing measurements** — request behaviour and counts only.

## 17. Next Customer slice

1. Order History and Account, on these same primitives.
2. Populate staging product imagery (data task) and validate the loaded-
   image path, which still cannot be exercised.
3. Server-side facets and a `pg_trgm` index — one small backend change,
   proposed and approved on its own.
4. Confirm the Android strike-through defect on stock Android.
