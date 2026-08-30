# Implementation Gap Matrix — craavee_web_v1

Audit date: 2026-08-29. Status values: DONE, PARTIAL, UI_ONLY, MOCKED,
BROKEN, MISSING, UNKNOWN. A feature is DONE only if it works end-to-end at
the layer the requirement targets — a rendered screen is never sufficient
on its own.

## Customer surface

| Requirement | Dossier Ref | Existing Implementation | Status | Risk | Required Work | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| Landing/onboarding | §6, §7.1 | Landing page, intro gate animation | UI_ONLY | Low | Rebuild copy/flow around campus framing once domain confirmed | Domain decision | P2 |
| Sign in (phone OTP) | §7.1, §12 | Fake email-string localStorage sign-in | MOCKED | Critical | Full rebuild: Supabase Auth, phone OTP | Supabase project | P0 |
| Address capture (structured campus geo) | §7.1, §11 | Free-text + reverse-geocode lat/lng via 3rd-party API | MOCKED | High | Rebuild as hostel/block/floor/room structured form | Domain decision, `addresses`/`zones` tables | P0 |
| Catalog / product browsing | §6 | `/shop`, static 28-item array in `src/lib/products.ts` | UI_ONLY | Medium | Wire to real `products`/`inventory` tables | Schema, RLS | P1 |
| Cart | §7.1 | `/shop/cart`, localStorage only | UI_ONLY | Low | Keep UX, wire pricing/stock checks server-side | Order flow | P1 |
| Checkout / payment | §7.1, §9 | **Absent** — no payment step exists in the UI flow at all | MISSING | Critical | Full build: Razorpay/Cashfree, server-computed amounts, webhook | Gateway KYC (external), Edge Functions | P0 |
| Order status / tracking | §7.1 | `/shop/track`, static 5-stage UI, no live data | UI_ONLY | Medium | Wire to real order status; customer polls own order (dossier §14) | Order flow, realtime infra | P1 |
| Order history / reorder | §7.2 | **Absent** | MISSING | Medium | Build "Order again" (dossier calls this the highest-leverage retention feature) | Order flow | P1 (per dossier, cheap + high impact) |
| Wallet / promo | §9, §18 | `credit_ledger` table only (unused), no UI | MISSING | High | Full rebuild as real-money wallet ledger, not event credits | Payments, ledger schema | P1 |

## Store / Packer surface

| Requirement | Dossier Ref | Existing Implementation | Status | Risk | Required Work | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| Order queue / pick list | §7.3 | `/packing`, hardcoded inline mock list | UI_ONLY | Medium | Wire to real orders, sorted by placement time | Order flow, RLS for `packer` role | P0 |
| Mark packed | §7.3 | Static "Packed" button, no state persistence | UI_ONLY | Medium | Wire to order state-machine transition | State machine (trigger) | P0 |
| Stock-out handling | §7.3 | **Absent** | MISSING | High | Delist item, notify customer, auto-refund to wallet | Inventory, wallet ledger | P1 |
| Receive stock / inventory intake | §6 (P1 scope) | **Absent** | MISSING | Low | Explicitly scoped to Phase P1, not P0 | Inventory schema | P2 |

## Runner surface

| Requirement | Dossier Ref | Existing Implementation | Status | Risk | Required Work | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| Online/offline toggle | §7.4 | **Absent** — no such control in `/queue` or `/active` | MISSING | Medium | Build `runners.is_online` toggle | Auth, runner role | P1 |
| Job queue (claim) | §7.4 | `/queue`, hardcoded list, no claim action wired | UI_ONLY | High | Real claim with `FOR UPDATE SKIP LOCKED`, one-live-job constraint | Correctness guarantees #4/#5 | P0 |
| Active job (picked up → delivered) | §7.4 | `/active`, static screen | UI_ONLY | High | Wire to order state machine | State machine | P0 |
| Delivery code verification | §7.4, §13 | **Absent** — no `delivery_code` field anywhere | MISSING | Critical | Add 4-digit code generation + verification step | Orders schema | P0 |
| Earnings ledger | §9, §19 (P1) | **Absent** | MISSING | Low | Explicitly scoped to Phase P1 ("track in console, pay manually" if solo) | Payments, `runner_earnings` table | P2 |

## Admin / Console surface

| Requirement | Dossier Ref | Existing Implementation | Status | Risk | Required Work | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| Live order board | §6 | `/live-ops`, hardcoded mock cards | UI_ONLY | Medium | Wire to Supabase Realtime, staff-only channel | Realtime, `admin` RLS | P1 |
| Catalog/pricing CRUD | §6 | `/catalog`, hardcoded mock table, no persistence | UI_ONLY | Medium | Wire to `products`/`inventory` with server-side price authority | Schema, RLS | P1 |
| Inventory management | §6, §11 | **Absent** (products have a flat `stock` int, no `qty_on_hand`/`qty_reserved` split) | MISSING | Critical | Build reservation-aware inventory model | Schema (correctness guarantee #3) | P0 |
| Users / runner management | §6 | **Absent** | MISSING | Medium | Build runner roster, shift management | Auth, runners table | P2 |
| Wallet/credits admin | §6 | **Absent** | MISSING | Medium | Manual credit/adjustment tooling | Wallet ledger | P2 |
| Promos | §6, §11 | **Absent** — `promos` table not in schema | MISSING | Low | Build promo code system | Wallet, orders | P2 |
| Refunds | §6, §8 | **Absent** | MISSING | Critical | Auto-refund-to-wallet on cancel/stock-out, manual override in console | Payments, wallet ledger | P0 |
| Runner payouts | §6, §9 | **Absent** | MISSING | Low | Weekly settlement export | Runner earnings | P2 |
| Overrides / kill switch / queue threshold | §6, §14 | **Absent** | MISSING | High | Auto-pause on queue depth, store open/close, pause reason | Orders, stores schema | P1 |
| Metrics dashboard | §6, §22 | **Absent** | MISSING | Medium | D7/D30 repeat rate, fulfilment time, payment success rate | PostHog, orders/payments data | P1 |
| CSV export | §6, §21 | **Absent** | MISSING | Low | Export orders/ledger/earnings for reconciliation | Payments, ledger | P2 |

## Correctness guarantees (dossier §13 — six required)

| Requirement | Dossier Ref | Existing Implementation | Status | Risk | Required Work | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| No duplicate orders (idempotency) | §13 | No `idempotency_key` field anywhere; order id = `Date.now()` string | MISSING | Critical | `UNIQUE(idempotency_key)` + client-generated key | Orders schema, Edge Function | P0 |
| No duplicate payment captures | §13 | No payments table, no gateway integration | MISSING | Critical | `UNIQUE(gateway_ref)`, idempotent webhook handler | Payments schema, gateway | P0 |
| No overselling | §13 | Single `stock` int on products, never decremented by any route | MISSING | Critical | `qty_on_hand`/`qty_reserved` split + row lock | Inventory schema | P0 |
| No double assignment | §13 | `PATCH /api/runner/queue` blind-writes `runnerId` with no locking or check | MISSING | Critical | `FOR UPDATE SKIP LOCKED` claim function | Edge Function, orders schema | P0 |
| One live job per runner | §13 | No constraint; nothing stops multiple orders assigned to one runner | MISSING | High | Partial unique index on `runner_id` | Orders schema | P0 |
| No illegal order transitions | §13 | `PATCH /api/orders` accepts any status string with no transition table | MISSING | Critical | `BEFORE UPDATE` trigger validating the state machine | Orders schema | P0 |

## Payments, realtime, notifications, performance

| Requirement | Dossier Ref | Existing Implementation | Status | Risk | Required Work | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| Payment gateway integration | §9 | **Absent entirely** | MISSING | Critical | Full Razorpay/Cashfree integration | Gateway KYC (external, 3–7 days) | P0 |
| Server-computed amounts | §9 | `POST /api/orders` trusts `body.totalCredits` from client | BROKEN (as a pattern; not exploitable today, no real money) | High | Server-side price computation only | Order flow rebuild | P0 |
| Webhook signature verification | §9 | **Absent** — no webhook endpoint exists | MISSING | Critical | Build alongside gateway integration | Gateway, Edge Functions | P0 |
| Wallet / payment ledger | §9, §11 | `credit_ledger` exists but models the superseded event-credit system | MISSING (functionally) | High | Real append-only `wallet_ledger` + `payments` tables | Schema rebuild | P0 |
| Supabase Realtime (staff surfaces) | §10, §12 | **Absent** | MISSING | Medium | Wire live-ops/packing/runner queue to Realtime channels | Supabase project | P1 |
| Customer order polling | §10, §14 | **Absent** — `/shop/track` is static, no polling loop | MISSING | Medium | Poll own order with backoff | Order flow | P1 |
| Push notifications | §12 | **Absent** — no Expo app, no `expo-notifications` | MISSING | Low | Depends on Expo app existing first | Expo app (also missing) | P2 |
| Rate limiting / OTP throughput | §14 | **Absent** | MISSING | Medium | Needed before real OTP volume (launch-day failure mode #1) | Auth build | P1 |
| Caching / CDN | §14 | **Absent** (also correctly not needed yet) | MISSING | Low | Not needed until load test proves it | k6 results | P3 |
| Load testing (k6) | §14, §22 | **Absent** | MISSING | Medium | Build k6 scripts per dossier §14 scenarios | Working order flow to test against | P2 |

## Legal / operational (not code-verifiable — flagged, not audited)

| Requirement | Dossier Ref | Existing Implementation | Status | Risk | Required Work | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| Business entity + bank account | §17 | Not visible from repository | UNKNOWN | Critical | Founder to confirm status directly | External, 3–10 days | P0 |
| Payment gateway KYC | §17 | Not visible from repository | UNKNOWN | Critical | Founder to confirm status directly | External, 3–7 days | P0 |
| FSSAI registration | §17 | Not visible from repository | UNKNOWN | High | Founder to confirm status directly | External, 7–15 days | P0 |
| University permission | §17 | Not visible from repository | UNKNOWN | Critical | Founder to confirm status directly ("most underrated risk") | External, unpredictable | P0 |

## Deployment / tooling

| Requirement | Dossier Ref | Existing Implementation | Status | Risk | Required Work | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| Repository structure (all 4 surfaces) | §12, §24 | Only the Next.js web app exists; no Expo app for customer/runner | PARTIAL | High | Scaffold Expo app or confirm web-only pivot | Domain/platform decision | P0 |
| CI/CD | — | **Absent** | MISSING | Low | Add before team grows past founder | — | P2 |
| Environment variable handling | §24 | **Absent** — no `.env.example`, no `process.env` reads anywhere | MISSING | Medium | Establish before any integration (Supabase, gateway) is wired | — | P0 |
| Sentry | §12 | **Absent** | MISSING | Medium | Add alongside first server-side code | — | P1 |
| Test suite | §24 | **Absent** | MISSING | Medium | Acceptance tests per phase, per dossier freeze checklist | Spec | P1 |
