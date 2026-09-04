# Phase 10D — Design System Foundation

**Branch:** `feat/premium-design-system-10d`
**Base `main`:** `6c70687710d5e4f1a1ba7ff1a644cd9453b12499`
**Date:** 2026-09-04

**This is the foundation, not the redesign.** Per §3 and the scope agreed
with the owner: canonical tokens, the primitives the product actually
needs today, and adoption on **one screen per surface** to prove the
system survives contact with all four. Per-surface UX work is 10E+.

---

## 1. Existing UI audit — measured, not recalled

| Finding | Measured |
|---|---|
| Brand palette defined in | **3 places** — `packages/ui/globals.css`, `customer-runner/lib/theme.ts`, `customer-runner/tailwind.config.js`. Both native files carried comments admitting it |
| Hard-coded hex values | 15 in customer-runner, 7 in console, 2 in store, **70 in packages/ui** |
| Distinct hand-written control class strings | **14** across the product |
| Distinct radius values | **12**, across **3 vocabularies** (`rounded-xl`, `rounded-cravee`, `rounded-[24px]`) |
| `apps/store` state primitives | **0** — no skeleton, empty, error or confirm component anywhere |
| `apps/console` state primitives | 9 confirm dialogs, 10 error states — the real design system, in an app-local file |
| `react-native-safe-area-context` | declared, **0 import sites**; safe areas hard-coded as `pt-14` / `pt-16` |
| `expo-haptics` | declared since Phase 2B, **0 call sites** |
| a11y props | customer 30, console 20, **store 1** |

The single most important finding: **the Store's missing states were
never a Store oversight.** The components existed; they lived in
`apps/console/src/lib/admin/ui.tsx`, somewhere the Store could not import
from. Architecture, not discipline.

## 2. Design principles

Written in full in `packages/ui/DESIGN.md`. In short: calm under
pressure; the database is the truth and the UI is a view of it; say what
happened; money is typographic; two surfaces, one language.

## 3. Token architecture

`@craavee/tokens` — **imports nothing.** No React, no react-native, no
`document`, no Expo. That constraint is what lets Tailwind v4 CSS
variables, NativeWind's v3 config and direct TypeScript all read the same
source.

Two artefacts are generated and **committed** (`dist/tailwind.cjs`,
`dist/tokens.css`) because the two apps are on different Tailwind majors
and neither can import TypeScript at config-load time. A **drift test**
regenerates both and fails if either is stale — the price of committing
derived files, and the thing that makes them trustworthy.

Colour is two layers: `palette` (raw pigment, no meaning) and
`color.consumer` / `color.ops` (semantic, what screens use). Status
colours are deliberately **not** the brand green, so a green button never
reads as a confirmation message.

**8 token tests**, asserting rules rather than values — a test that
`brand === "#178a50"` would only restate the source. They check: no
imports in the token source, identical semantic keys across both
surfaces, every touch target ≥ 44pt, spacing on the 4pt grid, type scale
and line heights in step, reduced motion has a non-zero collapse target,
radius names ordered, artefacts in sync.

## 4. Component architecture

**Web ops** (`@craavee/ui/ops`) — the Console kit **promoted, not
rewritten** (a `git mv`, implementations unchanged), so the Store can
finally import it. Plus a new `Button`: `btnClass`/`btnPrimaryClass`
existed as raw strings pasted onto bare `<button>`s, which is how 14
distinct control styles happened — several with no focus ring, none with
a loading state.

**Native** (`components/ui`) — `Screen`, `Button`, `Skeleton`,
`SkeletonList`, `LoadingState`, `EmptyState`, `ErrorState`,
`StaleBanner`, `StatusPill`.

Two decisions worth naming:

**`ErrorState` requires `onRetry`.** A type-level decision, not a
convention. The audit's P0 was the customer's tracking screen offering
"We couldn't load this order" and a link back to the catalog — no retry,
on the screen someone stares at while waiting for food. That shape can no
longer be built with this component.

**`Button` uses `Pressable`'s own `pressed` state, not Reanimated.** The
first version used a shared value and `withSpring`; the React Compiler's
`react-hooks/immutability` rule rejects mutating it. Rather than suppress
the rule, the press scale moved to `style={({pressed}) => …}` — no
worklet, no extra dependency, and for a 3% scale the difference is
imperceptible.

## 5. Motion

Four durations, three easings, two springs. Reduced motion is honoured
**globally** — a media query in `tokens.css` for web, `useMotion()` for
native — so a screen cannot forget it. Durations collapse to `instant`
(1ms) rather than 0, because a zero-length animation can be dropped
mid-flight leaving a half-applied transform.

## 6. Haptics

`lib/haptics.ts` finally uses the dependency. Semantic (`success`,
`error`) rather than physical (`heavy`, `light`), so screens say what
happened and one module decides how it feels. Fire-and-forget: a
simulator must behave identically. **Not** on navigation, scrolling or
ordinary buttons.

## 7. Responsive

Native uses flex. Web uses `breakpoint.{sm,md,lg,xl}` with
`contentWidth.{reading,app,ops}` caps. Ops tables scroll in their own
container; the page body never scrolls horizontally.

## 8. Accessibility foundation

Built into the primitives rather than added at the end: roles, labels,
`disabled`/`busy` state, `role="alert"` on errors, polite live regions on
stale banners, skeletons hidden from screen readers, and **44pt minimum
targets** — which fixed two text-only controls the audit found below it.

## 9. Performance foundation — reviewed, deliberately not changed

Reviewed per §13 and §24; **no speculative optimisation was applied.**

Already correct: FlashList virtualisation, `expo-image`, explicit column
lists on every query, server-side pagination on all five 9B consoles,
`count: exact, head: true` instead of `rows.length`, no N+1.

Known and **left for a measured phase**: no query persistence (cold start
is always empty), Console Overview issues 16 queries in two parallel
batches, no image placeholder strategy, no bundle budget, and no native
build in CI. Each needs a before/after measurement to justify, and §24
says not to invent benchmarks. **See §12 for what that means for this
phase's numbers.**

## 10. Representative adoption

| Surface | Screen | Change |
|---|---|---|
| Customer | catalog | `pt-14` → `Screen`; hand-rolled states → shared; log-out gains a 44pt target + label; cart bar owns its bottom inset |
| Runner | queue | `pt-16` → `Screen`; same target fix; "Live updates paused" → shared `StaleBanner` |
| Store | packing queue | **first designed state components the Store has ever had** |
| Admin | runner board | bare `<button>` → shared ops `Button` (focus ring, 44pt, `aria-busy`) |

**No behaviour changed on any of the four**: same queries, same
mutations, same states.

## 11. Visual verification — IOS SIMULATOR + BROWSER

`Craavee_iPhone17`, Metro with a cleared cache (the Tailwind config
changed):

- Catalog renders with token colours — brand green, paper ground.
- **Header sits below the notch via the device inset**, not `pt-14`.
- Add-to-cart works; the stepper renders; the cart bar appears **above
  the home indicator** with its own inset.
- No layout regression against the pre-change screenshots.

Browser: both Next apps compile and build; the Store's new state
components and the Admin's shared `Button` render in the production
build.

## 12. Before / after

| Measure | Before | After |
|---|---|---|
| Places the brand palette is defined | **3** | **1** |
| Hand-written control class strings | **14** | **12** |
| Radius vocabularies | **3** | 1 canonical + 3 legacy names (§14) |
| `apps/store` state primitives | **0** | shares the full ops kit |
| Safe-area magic numbers | **3** (`pt-14`, `pt-16` ×2) | **0** on adopted screens |
| Unused declared dependencies | 2 (`safe-area-context`, `haptics`) | **0** |
| Unit tests | 44 | **52** |

**Runtime performance was not measured, and no numbers are claimed.**
This phase changed structure, not data flow: identical queries, identical
render trees, identical list virtualisation. A before/after with no
expected delta would be theatre. The measurable work — query persistence,
the Overview's 16 requests, image placeholders — is a phase of its own,
with §24's method applied properly.

## 13. Android

**BLOCKED, unchanged from 10C and not a 10D blocker per §27.** The app
cannot start in Expo Go: SDK 53 removed `expo-notifications` remote push,
a warning on iOS but a throw on Android. Needs a development build, which
needs EAS. No infrastructure was created to work around it.

## 14. Design drift — remaining legacy, classified (§33)

| Item | Where | Class |
|---|---|---|
| Legacy `@theme` names (`obsidian`, `ember`, `cravee`) | `packages/ui/globals.css` | **DEFERRED** — the marketing-era components still reference them; removing them is a rewrite |
| `rounded-cravee`, `rounded-pill`, `rounded-[24px]` | 13 uses | **MUST MIGRATE** in 10E, alongside the screens that use them |
| Brand hex in `phone.tsx`, `verify.tsx`, `LoadingScreen.tsx` | 3 files | **MUST MIGRATE** — auth screens, not adopted this phase |
| Brand hex in `craavee-loader.tsx` | packages/ui | **SAFE TO KEEP** — a self-contained brand animation |
| 12 remaining control class strings | across apps | **MUST MIGRATE** as each screen is adopted |
| `.next/` build output matches | — | **NOT APPLICABLE** — generated |

Zero matches was never the goal; the goal is that every remaining one is
known and classified.

## 15. Remaining UX work

Customer has no search, no product detail, no order history, no account
screen. Tracking still lacks the stale/offline wiring the `StaleBanner`
now makes possible. The Store has adopted one screen of several. Contrast
and screen-reader passes are not done. Dark mode is **not** a product
requirement today (`userInterfaceStyle: "light"`, web is dark-only by
design) and was deliberately not expanded into (§18).

---

**Customer full redesign NOT complete. Runner full redesign NOT complete.
Store full redesign NOT complete. Admin full redesign NOT complete.
Phase 10E NOT started. No backend behaviour changed — zero files under
`supabase/` differ from `main`.**
