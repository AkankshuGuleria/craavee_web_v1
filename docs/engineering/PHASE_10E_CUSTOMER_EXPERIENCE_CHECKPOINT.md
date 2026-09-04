# Phase 10E — Premium Customer Experience

**Branch:** `feat/customer-experience-10e`
**Base `main`:** `61007ed7b76d646ad5275181ab2f14db1751ef97`
**Date:** 2026-09-04

**Scope agreed with the owner:** toolchain audit and installs first, then
polish what already exists — Home, Cart, Checkout, Tracking — plus query
persistence and the measured performance pass. **Search, Product Detail,
Order History and Account are deferred to Phase 10F** and were not built.

The toolchain half is documented separately in
`PHASE_10E_FRONTEND_TOOLCHAIN_CHECKPOINT.md`.

---

## 1. What this phase actually fixed

Two of these were P0s in the Phase 10 audit. One was a defect **I
introduced in Phase 10D and my own visual QA passed** — recorded in full
in §7, because it is the most instructive thing in this phase.

| # | Issue | Source | Status |
|---|---|---|---|
| 1 | Order tracking had no retry — a dead-end error screen | Audit P0 | Fixed |
| 2 | Order tracking had no concept of a failed poll — stale status shown as current | Audit P0 | Fixed |
| 3 | No query persistence anywhere — cold start blocked on the network | Audit finding | Fixed |
| 4 | 163 Tailwind class usages silently unresolved by 10D | **Self-inflicted, 10D** | Fixed |
| 5 | Back button on the cart read `index` | Found in 10E | Fixed |

## 2. Tracking screen — both P0s closed

`app/(customer)/order/[id].tsx` is the screen a customer stares at while
waiting for food. It is poll-driven by D20 (8s, backing off to 30s after
two minutes of no status change, stopped entirely when backgrounded, and
stopped permanently on a terminal status).

**P0 #1 — no way to retry.** The failure branch rendered "We couldn't
load this order." and a link back to the catalog. On a polling screen,
that is a dead end presented as a conclusion. It now renders the shared
`ErrorState` with a working `onRetry`. Notably, `ErrorState`'s signature
**requires** `onRetry` — it is not optional — so this screen cannot
regress into a retry-less error state without a type error.

**P0 #2 — a failed poll was invisible.** A lost connection left the last
known status on screen indefinitely, presented as current. The screen now
distinguishes three states rather than two:

| Condition | Renders |
|---|---|
| `isPending` | `SkeletonList` shaped like the order card |
| `!data` | `ErrorState` with retry |
| `isError` **and** data present | The order, plus a `StaleBanner` with retry |

**The guard change that matters most** is one line. It was:

```ts
if (order.isError || !order.data)
```

and is now:

```ts
if (!order.data)
```

The original discarded perfectly good cached data the instant a single
poll failed — on a screen that polls every eight seconds. One dropped
packet replaced a live order with an error page. The corrected condition
reserves the error page for a genuine "nothing to show" and routes the
transient case to the stale banner, which is what it actually is.

The skeleton also replaced a bare `ActivityIndicator`. The layout is
known in advance, so holding its shape stops content jumping into place
when the poll lands.

## 3. Navigation chrome

`app/(customer)/_layout.tsx` was rewritten to own the header for the
whole route group, and **8 inline `<Stack.Screen options>` blocks were
removed from 4 screens** (cart, checkout, address/new, order/[id]) — the
duplication that made the titles inconsistent in the first place.

Without an explicit title, Expo Router falls back to the **route
filename**, so the back button on the cart read `index`. It now reads
`Craavee`, and every route has a deliberate title: `Craavee`, `Your
cart`, `Checkout`, `Add an address`, `Your order`. Header colours,
weights and sizes come from the tokens rather than platform defaults, and
`headerShadowVisible` is off, so the chrome belongs to the same design
language as the content under it.

This is a small change with an outsized effect: a back button reading
`index` signals unfinished software at the exact moment a customer is
deciding whether to trust the app with a payment.

## 4. Query persistence — an allowlist, deliberately

The audit found no persistence at all: every cold start showed an empty
catalog and blocked on the network.

The obvious fix is dangerous in **this** product specifically. The
customer's order view is poll-driven because the database is the truth
(D20). A persisted `orders` entry rehydrated on launch would put a stale
order status on screen and present it as current — which is precisely the
P0 this same phase just fixed, arriving by a new route.

So `lib/query/persist.ts` is a **whitelist, not a blacklist**:

```ts
const PERSISTABLE = new Set(["catalog"]);
```

| Query key | Persisted | Why |
|---|---|---|
| `catalog` | **Yes** | Public, identical for every customer, revalidated on mount. A stale price cannot become a wrong charge — the server prices the order (D7) |
| `orders` | No | Money and fulfilment state; must come from the server (D20) |
| `payments` | No | Never written to disk in any form |
| `profile` | No | Carries `wallet_balance`, which is money |
| `addresses` | No | Customer PII, cheap to fetch, no reason to persist |

A query added in a future phase is non-persistent **by default**, because
the set is an allowlist. That is the correct direction of failure when the
thing being cached might be money.

Two configuration details that are load-bearing:

- `gcTime` is set to `PERSIST_MAX_AGE`. If `gcTime` is shorter than the
  persister's `maxAge`, the cache is garbage-collected before the restored
  entry can be used and **persistence silently does nothing** — it fails
  green.
- `throttleTime: 2_000` on the persister keeps the AsyncStorage write off
  the interaction path on a busy list.
- `maxAge` is 24 hours: long enough that a daily user never sees an empty
  catalog, short enough that a phone left in a drawer for a week starts
  clean rather than showing last week's menu.

**5 unit tests** pin all of it, including that a malformed query key is
refused rather than coerced.

## 5. Request budget (§45)

Unchanged by this phase — recorded here as the measured baseline.

| Query | Policy |
|---|---|
| `orders` (tracking) | 8s poll → 30s after 120s idle; stops when backgrounded; stops on `delivered` / `cancelled` / `payment_failed`; refetches on focus |
| `catalog` | `staleTime` 60s, now served from disk on cold start |
| `profile` | `staleTime` 60s |
| `addresses` | `staleTime` 5min |
| `zones` | `staleTime` 5min |
| Runner jobs | `staleTime` 0 — Realtime-driven (D21), not customer-facing |
| Global | `refetchOnWindowFocus: false`, `retry: 2` |

The tracking poll is the only sustained request cost in the customer app,
and it is already bounded on four axes (interval, backoff, app state,
terminal status). Nothing here needed changing; persistence removes the
cold-start fetch, it does not change the steady-state budget.

## 6. iOS validation against real staging

Run on the iOS simulator against the **real Supabase staging project**,
not local Docker.

| Check | Result |
|---|---|
| Paper ground restored (10D regression) | Confirmed |
| Card borders back (`border-inkdeep/10`) | Confirmed |
| Header reads "Your cart" with a "Craavee" back label | Confirmed |
| Cart persisted across a full app relaunch | Confirmed |
| Metro bundle | 1948 modules / 5683ms |

## 7. An honest record: my 10D visual QA passed a broken screen

This belongs in the permanent record.

In Phase 10D I **replaced** the native Tailwind theme rather than
extending it. Tailwind drops unknown class names without erroring, so
**163 class usages silently stopped resolving**: `text-inkdeep` ×76,
`border-inkdeep` ×24, `bg-paper` ×20, `text-brand-deep` ×14. Nothing
failed to build. No test failed. No lint rule fired.

**And my own 10D visual QA passed it.** I took screenshots of the catalog,
looked at them, and signed off — on cards that had lost their borders and
a ground that had lost its colour. The screens still looked plausible,
because "plausible" is all an unstyled-but-well-structured screen has to
be to survive a glance.

The lesson is not "look harder at screenshots". It is that **a visual
check performed by whoever made the change is not evidence.** I had no
before-image to compare against, no expectation written down in advance,
and a strong prior that my own work was correct. Those three things
together make a visual sign-off worth approximately nothing.

The fix is legacy aliases in `craaveeTheme()` mapping `paper → bg`,
`inkdeep → text`, `brand-deep → brandStrong`, `mango → accent`,
`cream → surfaceAlt`, plus a **pinning test** that fails if any alias
stops resolving to the token it replaced. The aliases are a shim, not the
destination — the 163 usages should migrate to semantic names in a later
phase, and the test is what makes it safe to do that incrementally.

Committed separately as `9141c7a` with the regression described honestly
in the message, rather than folded into unrelated work.

## 8. Commits

| SHA | Commit |
|---|---|
| `2ed7d98` | `feat(customer): add safe query persistence and close both tracking P0s` |
| `9141c7a` | `fix(design): restore the legacy Tailwind class names 10D silently broke` |

## 9. Test evidence

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 2 warnings — **pre-existing, byte-identical on `main`** |
| `npm test` (unit) | **58 / 58** (52 → 58: +5 persistence, +1 token alias) |
| `npm run functions:check` | exit 0 |
| `npm run functions:test` (gateway) | 9 passed, 0 failed |
| `npm run db:test` (pgTAP) | **596 assertions, 19 files, all green** |
| `npm run test:integration` | **223 / 223**, 0 failed, 0 skipped |
| `npm run build` | 2 apps compiled |

**Backend untouched (§63):** `git diff --name-only main...HEAD -- supabase`
returns **0 files**. No schema, state machine, RLS, payment, refund,
inventory, runner or notification-scheduler code was modified.

Full diff: **13 files, +307 / −37**.

## 10. Explicitly not done

Per the agreed scope and §69's stop condition:

- **Search, Product Detail, Order History, Account** — deferred to 10F
- Runner, Store and Admin redesigns — not started
- Full accessibility phase — not started
- Load testing, production rollout — not started
- Reanimated adoption — deliberately deferred; see toolchain checkpoint §1.1

---

## 11. Conclusion

Both audit P0s on the tracking screen are closed, and the more important
of the two was closed by **deleting** a condition rather than adding a
feature. Persistence is in, scoped to the one query that can safely have
it. The 10D regression is fixed and pinned by a test.

The phase's real finding is §7: the check that should have caught the
worst defect here was performed, by me, and passed.

**Status: complete. Awaiting owner review. Not merged.**
