# Phase 10E — Slice 2: Premium Customer Experience + Search + Product Detail

**Branch:** `feat/customer-search-product-10e`
**Based on:** `feat/customer-experience-10e` @ `f308c84` (PR #24, still open)
**`main`:** `61007ed7b76d646ad5275181ab2f14db1751ef97`
**Date:** 2026-09-05

**Backend changes: zero.** `git diff --name-only -- supabase` returns 0 files.

---

## 1. Why this is a stacked branch, not more commits on PR #24

PR #24 is open, green and awaiting the owner's merge decision, which is
not mine to make. §46 prefers separate reviewable PRs, and piling a
catalog redesign plus two new screens onto a PR that is already about
query persistence, tracking P0s and Android validation would make it
unreviewable.

So this branch is **stacked on** `feat/customer-experience-10e` rather
than on `main`. Its PR is independently reviewable, and it merges after
#24 does. Nothing here presumes that merge has happened.

## 2. Search backend audit (§9) — nothing was needed

The audit ran **before** any code was written, because §9 is a stop-gate.

| Question | Finding |
|---|---|
| Does a server-side product query exist? | **Yes.** `products_with_availability` (0003_rls_policies.sql) |
| Is it safe to search directly? | **Yes.** `security_barrier = true`, filters `is_listed = true`, granted to `authenticated, anon` |
| Does it expose what search needs? | **Yes.** It selects `p.*`, so name, brand, category, prices, unit and image are all present |
| Is a migration required? | **No** |

Search is therefore a PostgREST `ilike` against a view that already
exists and is already granted. **No migration, no function, no index, no
RLS change.**

**Recorded scaling limit, not pre-solved.** `ilike '%q%'` cannot use a
btree index, so this is a sequential scan. At campus-catalogue size (tens
to low hundreds of products) that is irrelevant. The fix, when it stops
being irrelevant, is a `pg_trgm` GIN index — a backend change, and
deliberately out of scope here.

## 3. The Android strike-through bug — the most important finding

This slice found, diagnosed and centrally fixed a **real rendering
defect** that had already produced two separate patches in PR #24 without
anyone understanding it.

**Symptom.** A `<Text>` with `textDecorationLine: "line-through"` drops
its **final glyph** on the physical vivo V2250 (Android 15, `font_scale`
1.0): a ₹30.00 MRP renders `₹30.0`, while the strike-through line is
still drawn to the full measured width.

**Four fixes that did NOT work**, tested on the device and recorded so
nobody repeats them:

| # | Attempt | Result |
|---|---|---|
| 1 | `shrink-0` on the Text | No effect |
| 2 | Padding on the Text (`pr-2`, then inline `paddingRight: 14`) | Gap widened — **glyph still missing** |
| 3 | An outer `View` owning the padding | No effect |
| 4 | `items-end` instead of `items-baseline` | No effect |

Attempt 2 is the informative one: the padding was demonstrably applied
(the gap to the next sibling grew) and the glyph was *still* absent. That
rules out container clipping and points at text measurement.

**What works:** a trailing thin space (U+2009) inside the Text. Android
drops *that* instead, and the last real digit survives.

**Why it is now a component.** The bug is size-dependent — the same
decoration at 11px renders fine, at 14px it does not — which is exactly
why per-call-site padding was never going to hold. All prices now render
through `components/ui/Price.tsx`, which carries the fix once. PR #24's
two ad-hoc `pr-1` patches were correct in effect but wrong in
understanding; this supersedes them.

**Honest limitation.** The app loads no custom font, so it renders in
vivo's OEM system font. This is **not confirmed on stock Android**. The
workaround is harmless on every platform; what is unknown is the blast
radius, not the remedy.

## 4. Catalog composition (§2, §5, §7)

| Problem (from the brief) | What changed |
|---|---|
| P1 "vertical collection of large white cards" | Two-column grid of image-led tiles. **No card, no border** — tiles sit on the paper ground |
| P2 "imagery visually absent" | `ProductImage` with three distinct states; see §5 |
| P3 "repetitive: bg → white card → text → green button" | The image block is the structure; borders removed; the Add control is a quiet pill, not a filled bar |
| P4 "insufficient typographic hierarchy" | Name 15px semibold → price 16px bold → metadata 11px muted. Brand and unit merged onto **one** line (they were two full rows competing with the name) |
| P5 "feels like a database listing" | ~6 products visible per viewport instead of 3, grouped under real `category` headings |

**No fabricated merchandising.** There are no "trending", "popular" or
"recommended" sections, because no such data exists. Grouping uses the
`category` column that genuinely exists, and the heading is suppressed
entirely when there is only one category.

Rows are assembled manually (`buildRows`) rather than with `numColumns`,
because a flat two-column list cannot interleave full-width section
headings. That keeps one FlashList and its recycling.

## 5. Image architecture (§6, §12)

Three states, deliberately distinguishable:

| State | Rendering |
|---|---|
| **loaded** | Real image, `contentFit="cover"`, 200ms transition, `memory-disk` cache |
| **absent** (`imageUrl` null) | Brand monogram on `brandSoft` at 55% — reads as *"before photography"* |
| **failed** (URL present, load failed) | Same monogram at 35% — quieter, legible as a failure |

`absent` and `failed` must not look identical, and they don't. Staging
currently has **no image URLs at all**, so every tile is in the `absent`
state; that has to read as intentional rather than broken.

Layout stability comes from `aspectRatio` reserving the box on the first
frame, so a late image never reflows the grid.

**No image was fabricated, scraped, hot-linked or embedded.** Populating
real product photography in staging is recorded as a **data task**, not a
code task.

## 6. Search (§8, §10)

| Requirement | Implementation |
|---|---|
| Debounce | 300ms (`lib/useDebounced.ts`) — the pause between words, not a throttle |
| Cancellation | `.abortSignal(signal)` — stops a stale response overwriting a newer one |
| Deduplication | TanStack query key `["search", term]` |
| Caching | `staleTime` 5 minutes |
| No blanking between terms | `keepPreviousData`, previous results dimmed to 55% while settling |
| Loading / empty / error / retry / stale | All present; `ErrorState` requires `onRetry`, so no dead end is constructible |
| Minimum length | 2 characters — one character matches the whole catalogue |

Search reuses `ProductCard`. There is deliberately **no second product
card design**.

**Injection guard.** PostgREST's `or=(...)` is a comma-separated list
inside parentheses, so a raw comma, paren or `*` in the search box is
*syntax the customer gets to write*. `sanitiseQuery` strips them. This is
a security property, so it lives in a pure module (`lib/search/query.ts`)
and is pinned by tests that import the **real** function rather than a
copy that could drift.

## 7. Product Detail (§11–§13)

Hierarchy: image → name → brand → price → availability → action, then a
quiet definition list.

**Only real fields.** The view exposes name, brand, image_url, mrp,
sale_price, unit_label, category and computed availability — and that is
the whole list. There is no description column, so there is no
description section. No ratings, reviews, or "customers also bought":
inventing any of those means inventing data.

**Zero-request navigation.** `useProduct` seeds `initialData` from the
catalog cache, so arriving by tap paints complete on the first frame.
`initialDataUpdatedAt` is set to the catalog's own `dataUpdatedAt`, which
is what keeps it honest — the seeded value is treated as exactly as old
as it really is, and revalidates when stale. Availability is the field
that matters: a product that sold out since the catalog loaded must not
stay green here.

This is the whole prefetch strategy, and it is better than prefetching:
nothing speculative is fetched for products never opened. §32's "do not
prefetch the entire catalog" is satisfied by prefetching nothing.

`maybeSingle` rather than `single`: a stale deep link to a de-listed
product is a "not found" to render, not an exception.

## 8. Measured performance (§31, §39)

Measured on the physical device with temporary `console.log`
instrumentation in the query function, read from `logcat`, **since
removed**. These are counts, not timings — no timing claim is made.

| Scenario | Keystrokes | Requests |
|---|---|---|
| Type "chocolate" | 9 | **1** |
| Clear and retype "chocolate" (cache hit) | 9 | **0** |
| Clear and type "curd" (new term) | 4 | **1** |
| **Total** | **22** | **2** |

Per-keystroke behaviour would have been 22 requests. Debounce collapses a
typed word to one; the 5-minute cache makes a repeat term free.

| Navigation | Requests |
|---|---|
| Catalog tile → Product Detail (catalog cached) | **0** on first paint |
| Product Detail cold (deep link) | 1 |

**No claim is made** about startup time, frame rate, memory or "faster"
rendering. Nothing measured those.

## 9. Motion, haptics, accessibility

**Motion (§20).** No new animation was added. The press states are
`Pressable`'s own `pressed`, and the search "settling" state is an
opacity change, not a transition. This is deliberate: §20 says motion
should communicate state change, and adding animation to a screen whose
problem was *hierarchy* would have been decoration.

**Haptics (§21).** `success` on add-to-cart (a committed change the
customer may not be watching); `selection` on an ordinary quantity step;
`warning` on the decrement that would remove the line — a physical "are
you sure" at a destructive edge. Nothing on navigation or scrolling.

**Accessibility (§25).**
- Tiles are buttons announcing name, brand, price and sold-out status,
  with a hint that they open details.
- `QtyStepper` is one component with `accessibilityRole="adjustable"`,
  an `accessibilityValue` for the count, and per-control labels naming
  the product — "minus" alone is meaningless in a grid.
- The decrement at qty 1 announces "Remove X from cart", not "Decrease".
- Touch targets: `hitSlop` keeps both stepper controls ≥44pt even at the
  `sm` size where the drawn circle is smaller.
- Sold-out and in-stock are stated **in words**, never colour alone.
- The image is `importantForAccessibility="no-hide-descendants"` — the
  product name is already read beside it, and the monogram fallback
  carries no information at all.

**One consistent stepper** now serves catalog, product detail and cart.
The cart previously hand-rolled its own, which is why its buttons
announced a bare "Decrease".

## 10. A test-discovery gap found while adding tests

The customer app's unit script is:

```
node --experimental-strip-types --test lib/**/__tests__/*.test.ts
```

npm runs scripts through `sh`, where `**` is a **single** level. That
glob therefore expands to `lib/*/__tests__/` only. A test at
`lib/__tests__/` is silently skipped — and so would any test under
`hooks/`.

I hit this by placing a new test at `lib/__tests__/` and watching the
count not move. The test now lives at `lib/search/__tests__/`, where the
existing glob finds it, so **no script change was needed** and CI
behaviour is unchanged.

Recorded rather than fixed, because widening the glob is a CI-behaviour
change that belongs in its own review: **a test file placed at
`lib/__tests__/` or anywhere under `hooks/` will not run, and will not
warn.**

## 10A. Cross-platform validation

All three platforms were driven interactively, not inspected from source.

| Platform | How | Result |
|---|---|---|
| **Android** | Physical vivo V2250, Android 15, real staging | Catalog grid, search ("milk", "chocolate", "curd"), Product Detail, cart bar, back navigation |
| **iOS** | `Craavee_iPhone17` simulator, real staging | Same flow; renders identically |
| **Web** | `expo export --platform web`, served, driven in a browser | Auth, catalog, search; visible focus rings on inputs |

### Two cross-platform defects found by doing this

**Duplicate clear control on iOS.** The search field had
`clearButtonMode="while-editing"`, which is **iOS-only**. iOS therefore
drew the native grey ⊗ *and* our custom ×; Android drew only ours. Fixed
by removing the native one: the custom control now serves both, is
identical across platforms, and carries a real `accessibilityLabel`,
which the native one does not allow.

**Desktop web stretched to the window.** The customer app is a phone
layout, and without a cap the two-column grid became two billboards and a
text field ran the full width of the monitor. `Screen` now applies a
centred 720px maximum **on web only** (`Platform.OS === "web"`); a phone
viewport is already narrower, so native is untouched. 720 rather than a
phone width, because pinning a 400px column on a desktop is its own kind
of wrong.

### Consistency

| Aspect | Result |
|---|---|
| Tokens, spacing, typography, hierarchy | Identical across all three |
| Money rendering | Correct everywhere after the `Price` fix |
| Back affordance | Android arrow vs iOS "Craavee" back-title — correct native divergence |
| Search state across navigation | Query and results preserved returning from Product Detail |

**A lead, not a finding.** On Android the auth screen's "Resend code in"
appeared to be missing its countdown number, where iOS and web both show
"Resend code in 26s". That is consistent with the same trailing-glyph
loss described in §3. The auth screen is outside this slice's scope and
was not changed; it is worth checking when the strike-through defect is
confirmed on stock Android.

## 11. Test matrix

| Check | Result |
|---|---|
| `typecheck` | 0 errors |
| `lint` | 0 errors, 2 warnings (pre-existing, `packages/ui`, byte-identical on `main`) |
| `test` (unit) | **65 / 65** (was 58; +7 search-sanitiser tests) |
| `functions:check` | exit 0 |
| `functions:test` (gateway) | 9 passed, 0 failed |
| `db:test` (pgTAP) | 19 files, all green |
| `test:integration` | **223 / 223**, 0 failed, 0 skipped |
| `build` (Store + Console) | 2 apps compiled |
| Backend files changed | **0** |

## 12. Dependencies and security (§39, §37)

**No dependency was installed.** Not one. Everything here is built from
Expo Router, TanStack Query, Zustand, FlashList, expo-image, expo-haptics
and `@craavee/tokens` — all already present.

Reanimated, Gesture Handler, `@gorhom/bottom-sheet` and moti remain
declared and unused. This slice needed none of them, and §39 forbids
installing alternatives.

**Server authority unchanged.** Prices, availability and totals continue
to come from the server; nothing here trusts a route parameter or a
client-side price. `create_order` remains the only authority on what is
charged.

## 13. Known limitations

- **Product images do not exist in staging.** Every tile shows the
  monogram fallback. Populating real photography is a **data task**; no
  image was invented to hide it.
- **Stock-Android reproduction of the strike-through bug is untested.**
  See §3.
- **Search is a sequential scan.** Fine at current catalogue size; needs
  `pg_trgm` later. See §2.
- **No timing measurements.** Request counts only.
- **Tile height.** The 1:1 image was kept rather than squashed to fit
  more rows; ~6 products per viewport instead of 3. Squashing product
  photography to gain a row is the wrong trade.
- **A test at `lib/__tests__/` or under `hooks/` silently will not run.**
  See §10.

## 14. Not implemented, per §44

Order History, Account, Runner redesign, Store redesign, Console
redesign, load testing, production deployment, real push, real SMS,
Sentry, production Razorpay, loyalty, recommendations, personalisation,
reviews, ratings, wishlists. **None started.**

Checkout was not redesigned (§18) — only the money-clipping fix from
PR #24 stands. Tracking was not redesigned (§19).

## 15. Next slice

1. Order History and Account, on these same primitives.
2. Populate staging product imagery (data task) and re-validate the
   loaded-image path, which cannot currently be exercised.
3. Confirm the strike-through defect on stock Android; if universal,
   audit every remaining `line-through` in the product.
4. Widen the unit-test glob, as its own reviewable change.
