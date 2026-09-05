# Craavee — Customer Experience: Current State

**Date:** 2026-09-05
**Companion to:** `CUSTOMER_EXPERIENCE_MASTER_PLAN.md`

Every customer capability, with an unambiguous status. No "mostly", no
"largely working".

**Status vocabulary**

| | |
|---|---|
| **DONE** | Built, and validated on a real device against real staging |
| **PARTIAL** | Works, but a named part of it is missing |
| **MISSING (FE)** | Backend and data exist; the client does not |
| **MISSING (BE)** | No backend at all — schema decision required |
| **BLOCKED** | Cannot proceed without a decision or credential someone else owns |
| **DEFERRED** | Possible now, deliberately not done |

---

## Authentication and session

| Capability | Status | Notes |
|---|---|---|
| Phone entry, E.164 normalisation | **DONE** | Verified on device against staging |
| OTP request / verify | **DONE** | Staging uses fixed test OTPs |
| Session restore across relaunch | **DONE** | SecureStore; verified |
| Logout | **DONE** | |
| Resend countdown | **PARTIAL** | Renders on iOS and web; on Android the countdown number appeared absent — consistent with the Android trailing-glyph defect, unconfirmed |
| Session expiry / re-auth UX | **PARTIAL** | `AuthBoundary` routes out; no explicit "session expired" message |
| **Real SMS delivery** | **BLOCKED** | No provider chosen. Owner decision + Indian DLT registration |
| Social login | **N/A** | Not in the product spec; not invented |

## Onboarding

| Capability | Status | Notes |
|---|---|---|
| Progressive profile | **PARTIAL** | `full_name` optional and unprompted |
| Address capture before first order | **DONE** | Enforced at checkout |
| Location / store selection | **N/A** | Single store in the data; no selection to make |

## Discovery

| Capability | Status | Notes |
|---|---|---|
| Home as structured storefront | **DONE** | Slice 3 — rail + capped sections + "See all" |
| Category rail (8 real categories) | **DONE** | |
| **Subcategories** | **MISSING (BE)** | No column. Not faked |
| Browse with filters + sort | **DONE** | Server-side, URL-addressable |
| Search (debounced, cancelled, cached) | **DONE** | 22 keystrokes → 2 requests, measured |
| Filters: category, brand, price, availability | **DONE** | Brand facets scoped to category |
| Discount filter | **N/A** | 24/24 discounted — zero selectivity |
| Relevance / popularity sort | **N/A** | No score, no counts. Not invented |
| Recently viewed / bought / trending | **MISSING (BE)** | No view or purchase history recorded |

## Product

| Capability | Status | Notes |
|---|---|---|
| Product detail | **DONE** | Zero-request open from cache |
| Real fields only | **DONE** | No description column ⇒ no description section |
| **Product imagery** | **BLOCKED (DATA)** | 0 of 24 have `image_url`. Architecture ready, data absent |
| Related products | **DEFERRED** | Possible by category; not built |

## Wishlist

| Capability | Status | Notes |
|---|---|---|
| **Entire feature** | **MISSING (BE)** | No table, no column, no code. Schema proposed in master plan §5.1; **not built** per §44 |

## Cart and checkout

| Capability | Status | Notes |
|---|---|---|
| Cart, quantity, remove, persistence | **DONE** | Survives force-stop; verified |
| Unavailable / removed item handling | **DONE** | Surfaced, never silently dropped |
| Address select at checkout | **DONE** | |
| **Address edit / delete / default** | **MISSING (FE)** | Table supports it; UI is add + select only |
| Promo | **DONE** | Server-validated |
| Wallet | **DONE** | |
| Razorpay + webhook authority | **DONE** | Externally verified in 10C |
| Payment failure states | **PARTIAL** | Distinct pending/failed states exist; not differentiated per cause (declined vs timeout vs gateway) |

## Post-purchase

| Capability | Status | Notes |
|---|---|---|
| Single-order tracking | **DONE** | Poll-driven (D20), stale banner, retry |
| **Order timeline** | **DONE** | ← this slice. Real timestamps only, no ETA |
| **Order history** | **DONE** | ← this slice. Paginated, active/past split |
| Order detail amounts + items | **DONE** | |
| Delivery code flow | **DONE** | D14 preserved |
| **Reorder** | **BLOCKED** | Needs availability-checked partial-success path |
| **Refund visibility** | **PARTIAL** | Wallet-only refunds (D38) happen; refund *history* has no UI |
| **Support** | **MISSING (BE)** | No ticket/thread table. Framework proposed §5.2; **not built** |

## Account

| Capability | Status | Notes |
|---|---|---|
| **Account screen** | **MISSING (FE)** | No hub exists |
| Profile view/edit | **MISSING (FE)** | `profiles` supports it |
| Wallet balance + ledger | **MISSING (FE)** | `wallet_ledger` readable by RLS today |
| Notification preferences | **MISSING (BE)** | No preference column |

## Cross-cutting

| Capability | Status | Notes |
|---|---|---|
| Offline / stale handling | **PARTIAL** | Stale banners + retry everywhere; no `NetInfo`/`onlineManager` |
| Query persistence | **DONE** | Allowlist — catalog only, never orders/payments/profile |
| Deep links | **PARTIAL** | Routes exist and are auth-gated; not systematically tested |
| Push notifications | **BLOCKED** | Dispatcher works; no EAS `projectId` ⇒ no token can be minted |
| Accessibility | **PARTIAL** | Strong on shipped surfaces; `address/new` still has **0** a11y props |
| Analytics | **N/A** | Instrumentation points documented, nothing added |

---

## Launch blockers this slice moves

| Blocker | Before | After |
|---|---|---|
| B20 — no order history | Open | **Closed (frontend)** |

Still open: B4 real SMS, B5 push, B6 load tests, B8 `address/new` accessibility, B9 real-handset push.

---

## The honest one-line summary

Craavee can **discover, buy and now remember**. It cannot yet **save for
later, ask for help, or manage an account** — and two of those three need
a schema decision that has been written up rather than taken unilaterally.
