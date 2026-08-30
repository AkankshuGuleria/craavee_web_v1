# Phase 5 — Real Payments + Webhook + Refunds Implementation Report

The first real-money phase. `create_order`'s Phase B now talks to a real
**Razorpay** adapter behind the unchanged D12 interface; a signed
`payment_webhook` is the sole authority on payment success; a
`refund` Edge Function returns money to the wallet, idempotently. Payment
success is a server-side fact — the mobile app can *request* payment, the
gateway can *report* it, only the verified webhook *confirms* it.

**Formal gate — MET (with one documented external blocker).** A sandbox
payment order is created with a server-authoritative amount and a
persisted gateway reference · a valid webhook verifies and confirms the
order · an invalid/forged/tampered webhook is rejected before parsing · a
duplicate webhook is a provable no-op · the capture → confirmed and
refund → refunded transitions comply with the existing DB triggers · the
late-capture-after-expiry path auto-refunds to wallet without resurrecting
the order · refunds are idempotent, bounded by the captured amount, and
admin-only. pgTAP **314/314** (was 264; +50 new, existing 264 unchanged).
New payment integration suite **29/29**. Order suite still **43/43**,
auth/catalog still **11/11**. Deno gateway/safety tests **8/8**.

**External blocker (unchanged from Phase 4 §21):** no Razorpay
`rzp_test_`/`rzp_live_` credentials are provisioned in this environment,
so a *live* sandbox transaction and production KYC could not be exercised
here. The real adapter's HMAC verification, event parsing, order-creation
request shape, and production-safety branching are all verified by direct
unit tests + deterministic mock fault-injection; §14 is the exact
runbook for the owner to complete the live check with real keys.

---

## 1. Selected gateway

**Razorpay** (D37), per D12's preferred order (Razorpay → Cashfree). It
is the more widely-integrated Indian gateway, its Checkout shape is
exactly what the Phase 4 mock already emulated (`name='razorpay'`,
`order_...` refs, the `checkoutParams` keys), and a free test-mode account
exercises Orders + webhooks end to end with no KYC. The project owner
confirmed the gateway choice ("choose the best option for the project and
the most affordable") — Razorpay test mode is free and needs no KYC.
Cashfree was **not** implemented (D12: "build one, keep the seam").

## 2. Sandbox / production status

| | Status |
|---|---|
| Adapter implemented | ✅ `supabase/functions/_shared/gateway/razorpay.ts` — real Orders API call, real HMAC-SHA256 webhook verification, real event normalization |
| Contract preserved | ✅ `packages/api-contracts/src/gateway.ts` unchanged — the D12 `PaymentGatewayAdapter` interface is byte-for-byte the same; only `getGateway()` changed |
| Deterministic fault-injection tests | ✅ mock adapter (ok / timeout / fail) drives the integration suite |
| Real HMAC / parse unit tests | ✅ `RazorpayGateway` imported directly and tested against real `node:crypto` HMACs (valid / tampered body / wrong secret / missing header) |
| Production-safety branching tests | ✅ `functions:test` — mock impossible in production/staging, Razorpay refuses to start without all 3 secrets |
| **Live sandbox transaction** | ⛔ **blocked** — needs real `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` (test mode). Runbook: §14. |
| **Production KYC / live keys** | ⛔ **external** — a merchant onboarding step outside engineering (`docs/audit/PHASE_0_REPOSITORY_AUDIT.md` blocker #3). No live-money verification is claimed. |

## 3. Payment adapter architecture

`getGateway(mode)` (`_shared/gateway/index.ts`) is the **only** selection
point. `create_order`'s Phase A/B/C control flow, `payment_webhook`, and
`refund` call only the D12 interface.

```
PAYMENT_GATEWAY = "razorpay" (or unset)
  ├─ all 3 RAZORPAY_* secrets present  → new RazorpayGateway(...)
  └─ secrets missing
       ├─ unset + CRAAVEE_ALLOW_MOCK_CONTROL=1 + CRAAVEE_ENV∉{production,staging}
       │     → MockGateway   (local / CI only)
       └─ otherwise → throw PRODUCTION_SAFETY   (fail closed)

PAYMENT_GATEWAY = "mock"
  ├─ CRAAVEE_ALLOW_MOCK_CONTROL=1 AND CRAAVEE_ENV∉{production,staging} → MockGateway
  └─ otherwise → throw PRODUCTION_SAFETY
```

`RazorpayGateway`:
- `createPaymentIntent` — `POST api.razorpay.com/v1/orders`, HTTP Basic
  (`key_id:key_secret`), 10 s `AbortController` timeout, `receipt` +
  `notes.craavee_order_id` = the internal order id. Any fault →
  `GatewayError` (`timeout` / `rejected` / `unavailable`); the Edge
  Function maps all of them to `PAYMENT_SETUP_FAILED` (safe to retry with
  the same `idempotencyKey`). Defense in depth: rejects a response whose
  echoed `amount` ≠ what was requested.
- `buildCheckoutParams` — pure function of `(gatewayOrderRef, amountPaise)`
  + the stable publishable `key` id. **Never** contains a secret. Rebuilt
  on an idempotent replay with no gateway call (`PHASE_1_1_CORRECTIONS.md`
  §4.3 scenario C).
- `verifyWebhookSignature` — synchronous `node:crypto` HMAC-SHA256 over
  the **raw** body, constant-time compared to `X-Razorpay-Signature`.
  Synchronous specifically so the D12 `: boolean` return type is
  unchanged (no `Promise<boolean>` widening).
- `parseWebhookEvent` — normalizes `payment.captured` / `payment.failed` /
  `order.paid`. `gatewayEventId` is derived from the body
  (`<event>:<payment id>`); the handler prefers the `x-razorpay-event-id`
  header when present. An unhandled event type throws
  `UNSUPPORTED_EVENT:<type>` — the handler acks `200` and ignores it.

## 4. `create_order` payment interaction

**Unchanged.** The Phase 4 three-part architecture (D24/D34) is intact:
Phase A (one plpgsql transaction, no network I/O), Phase B (claim marker
+ gateway call, no transaction held), Phase C (persist the ref, 3
retries). The only difference is that `getGateway()` now returns
`RazorpayGateway` when configured, so `createPaymentIntent` makes a real
`api.razorpay.com` call and `gatewayOrderRef` is a real `order_…` id. No
gateway call moved into a transaction; no inventory/wallet/promo lock is
held during it. `payments.amount` is set once in Phase A from the
server-computed `orders.payable`; the gateway request uses that value,
never a client figure.

## 5. Webhook architecture

`supabase/functions/payment_webhook/` (`handler.ts` + `index.ts`) →
`process_payment_webhook` (migration 0005), **one transaction**:

1. **Handler:** raw body → `getGateway()` (fail-closed on a misconfigured
   deployed env) → `verifyWebhookSignature` → `403` (no detail) on
   failure → `parseWebhookEvent` (`UNSUPPORTED_EVENT:` → `200` ignore) →
   `redact()` the payload → one RPC.
2. **`process_payment_webhook`:**
   - `INSERT … webhook_events … ON CONFLICT (gateway, gateway_event_id)
     DO NOTHING` — 0 rows ⇒ `duplicate`, return (true no-op).
   - Server-side lookup: `payments JOIN orders` by `(gateway,
     gateway_order_ref)` **only** — no client-supplied order id is ever
     read. Unknown ref ⇒ `unknown_order` (still acked, audited, Sentry).
   - `SELECT … FROM orders … FOR UPDATE` — serializes against
     `expire_stale_reservations` (`FOR UPDATE SKIP LOCKED`).
   - Currency ≠ INR ⇒ `currency_mismatch`, not captured.
     `captured` amount ≠ `payments.amount` ⇒ `amount_mismatch`, not
     captured, audited, Sentry (§10).
   - Branch on `(outcome, orders.status, payments.status)` — §11.
   - Mark `webhook_events.processed_at`, write `audit_logs` (`actor_id =
     null`).
3. **Handler:** always `{ ok: true }` `200` on a *processed* event
   (failed-payment events too). Sentry alerts on `amount_mismatch`,
   `currency_mismatch`, `late_capture_reconciled`, `unknown_order`. A
   genuine DB fault ⇒ `500` so the gateway retries.

**The webhook is the source of truth.** No client callback confirms a
payment (§17); `usePaymentCheckout`'s success is provisional and only
triggers a re-poll.

## 6. Signature verification

- Verified against the **raw request body bytes** (`await req.text()`),
  before any `JSON.parse` — the exact order Phase 5 §8 requires.
- HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET` (`EDGE_FUNCTION_ONLY`),
  constant-time compared (`crypto.timingSafeEqual`).
- Missing / malformed / wrong-secret / tampered-body → `403` with body
  `"forbidden"` only (no hint why — Phase 5 §8, `API_CONTRACTS.md` §3).
- Negative tests (all green): invalid signature, missing signature,
  altered body, wrong secret — `payment.integration.test.ts` §19.4/5 +
  `gateway.test.ts`.
- The secret is never logged, never in an `audit_logs` row, never in a
  Sentry payload, never in `checkoutParams`.

## 7. Idempotency

| Layer | Mechanism |
|---|---|
| Webhook transport | `webhook_events (gateway, gateway_event_id)` UNIQUE — `INSERT … ON CONFLICT DO NOTHING`; 0 rows ⇒ immediate `duplicate` no-op. Event id = `x-razorpay-event-id` header, else `<event>:<payment id>` from the body (stable across a redelivery). |
| Late-capture double-fire | `process_payment_webhook` reconciles only when `payments.refunded_amount = 0`; a redelivered late-capture event (distinct id) sees `refunded_amount > 0` ⇒ `noop`. |
| Refund | `refunds.idempotency_key` UNIQUE (D29). Same key + same request ⇒ the original `refunds` row. Same key + different amount ⇒ `ORDER_ALREADY_EXISTS` (409). Concurrent duplicate ⇒ the `refunds` row is inserted **first** (before any wallet/payment effect), so the loser catches the `unique_violation` and returns the winner's row — exactly one effect. |

Tested: identical webhook ×2, concurrent identical webhooks
(`Promise.all`), redelivered late-capture, duplicate refund key,
concurrent duplicate refund (`Promise.all`), same-key-different-amount —
all green (§20 E/F, §20 J/J2/J3, pgTAP 12).

## 8. Amount verification

`process_payment_webhook` compares the webhook's reported `amount`
against `payments.amount` (set once in Phase A from the server-computed
`orders.payable`) **before** writing `status='captured'`. A mismatch:
`payments` is **not** marked captured, `orders.status` is unchanged, an
`audit_logs` row (`action='payment.amount_mismatch'`, `expected` /
`reported`) is written, and the handler raises a Sentry P0
(`PAYMENT_AMOUNT_MISMATCH`, `level: fatal`). Currency ≠ INR is handled
the same way. The `webhook_events` row is still kept (a redelivery of the
bad event is a no-op). Verified: pgTAP 12 (direct, incl. the
currency-mismatch path the handler can't reach since it always sends INR)
+ integration §20 G.

## 9. Order / payment state transitions

All comply with the **existing** triggers (`enforce_order_transition`,
`enforce_payment_transition`, deferred `check_payment_order_consistency`)
— no parallel state model, no weakened test.

| Event | `payments` | `orders` | Resting pair |
|---|---|---|---|
| capture, order `created` | `pending → captured` | `created → confirmed` | `confirmed + captured` ✓ |
| failure, order `created` | `pending → failed` | `created → payment_failed` (+ release reservation, reverse wallet as `reservation_reversal`) | `payment_failed + failed` ✓ |
| capture, order already terminal | (see §11 — D36) | unchanged | `payment_failed + failed` / `cancelled + failed` ✓ |
| partial refund | `captured → partially_refunded` | unchanged (`payment_status` synced) | `confirmed + partially_refunded` ✓ |
| full refund, live order | `captured → refunded` (or `partially_refunded → refunded`) | `confirmed/assigned/delivery_failed → cancelled` (+ release reservation) | `cancelled + refunded` ✓ |

`orders.payment_status` (the denormalized column) is now kept in step
with `payments.status` on every write `process_*` makes (Phase 4 set it
only at creation).

## 10. Late-capture handling (D36)

`PHASE_1_1_CORRECTIONS.md` §9 sketched a `payment_failed + refunded`
resting pair for a capture that clears after the reservation-expiry sweep
already ran. But migration 0002's `enforce_payment_transition` makes a
`failed` payment **strictly terminal** (`failed → *` illegal), and its
pgTAP guard (`07_…` line ~168) asserts exactly that. Phase 5 §6/§21
forbid changing either. So the late capture is recorded **without moving
`payments.status`**:

- `refunds` row — `reason='late_capture_reconciliation'`, `actor_id=null`
- `payments.refunded_amount` bumped to the captured amount (keeps the D29
  `refunded_amount == Σ refunds.amount` invariant true)
- `payments.raw_event` = the redacted capture payload;
  `payments.gateway_payment_ref` set
- `wallet_ledger` credit (`reason='refund'`) + `profiles.wallet_balance`
  increment — the customer is made whole
- `audit_logs` row (`action='payment.late_capture_reconciled'`,
  `actor_id=null`) + a Sentry alert
- `orders.status` is **never touched** — the customer never receives an
  order that was already safely expired/cancelled (§12)

Guarded against double-firing (a redelivered event with a distinct id):
reconcile only when `refunded_amount = 0`, else `noop`. Full rationale:
DECISION_LOG **D36**. Verified: pgTAP 12 (six assertions) + integration
§20 L (incl. the redelivered-event guard and wallet-ledger consistency).

## 11. Refund architecture

`supabase/functions/refund/` → `process_refund` (migration 0005), **one
transaction, no network I/O** (D24), **wallet destination only** (D38 —
dossier §18 default; gateway-instrument refunds are a later-phase support
tool needing a D12 interface addition §3 forbids now).

1. Idempotency check (`refunds.idempotency_key`).
2. Locks: `profiles` (wallet) **then** `payments` — D25 fixed order.
3. Guard: `payments.status ∈ {captured, partially_refunded, refunded}`
   else `PAYMENT_FAILED`.
4. `amount` (optional; default = `payments.amount - refunded_amount`)
   bounded by the remaining balance — `REFUND_EXCEEDS_CAPTURED` otherwise
   (also when the payment is already fully refunded: remaining = 0).
5. `refunds` row inserted **first** (concurrency — §7).
6. `payments.refunded_amount +=`, `status → partially_refunded` or
   `refunded` (via `enforce_payment_transition`).
7. `wallet_ledger` credit (`reason='refund'`) + balance increment.
8. **Full refund of a live order** (`confirmed`/`assigned`/
   `delivery_failed`) → release the still-held reservation + `orders →
   cancelled` (D38). Full refund of `packed`/`picked_up`/`delivered` →
   `INVALID_ORDER_TRANSITION` (post-pack cancellation is a later phase).
9. `audit_logs` (`action='refund.issued'`, `actor_id` = the admin).

Auth: `refund` handler requires a verified `admin` JWT — `AUTH_REQUIRED`
(401) with no token, `FORBIDDEN` (403) for any non-admin (incl. a
customer). Response: `{ refundId, amount, walletCredited, gatewayRefunded }`
— `gatewayRefunded` is always `0` this phase.

## 12. Refund idempotency

`refunds.idempotency_key UNIQUE` (D29). Replay → the original row
unchanged. Same key + different amount → `ORDER_ALREADY_EXISTS`.
Concurrent duplicate → the `refunds` insert is the first side-effecting
statement, so the losing transaction's `unique_violation` is caught and
returns the winner's row; the wallet is credited **exactly once**.
Verified under genuine `Promise.all` (integration §20 J2) and directly
(pgTAP 12, five assertions).

## 13. Security tests

`payment.integration.test.ts` + `gateway.test.ts` + pgTAP 12 — every
Phase 5 §19 item, each asserting the manipulated path **fails safely**:

| # | Attack | Result | Where |
|---|---|---|---|
| 1 | fake payment amount | not captured, order stays `created`, audited, Sentry | int §20 G, pgTAP 12 |
| 2 | fake gateway order reference | server-side lookup by ref only → `unknown_order`, acked, no order touched | int §20 O, pgTAP 12 |
| 3 | fake gateway payment reference (reused) | `(gateway, gateway_payment_ref)` UNIQUE → 500, second order not confirmed | int §19.3 |
| 4 | forged webhook | `403`, no state change | int §20 H, `gateway.test.ts` |
| 5 | modified webhook body | HMAC over raw bytes fails → `403` | int §19.5, `gateway.test.ts` |
| 6 | duplicate webhook | one `webhook_events` row, captured once, no double effect | int §20 E/F, pgTAP 12 |
| 7 | wrong payment amount | not captured | int §20 G, pgTAP 12 |
| 8 | wrong currency | not captured, audited (DB guard; handler always sends INR) | pgTAP 12 |
| 9 | wrong gateway order ID | `unknown_order` | int §20 O |
| 10 | duplicate refund | one `refunds` row, one wallet credit | int §20 J/J2, pgTAP 12 |
| 11 | refund > captured | `REFUND_EXCEEDS_CAPTURED` | int §19.11, pgTAP 12 |
| 12 | refund on failed payment | `PAYMENT_FAILED` | int §19.12, pgTAP 12 |
| 13 | refund after full refund | `REFUND_EXCEEDS_CAPTURED` | int §19.13, pgTAP 12 |
| 14 | unauthorized refund (no JWT) | `AUTH_REQUIRED` 401 | int §19.14 |
| 15 | customer attempting admin refund | `FORBIDDEN` 403, no effect | int §19.15 |
| 16 | late capture after reservation expiry | order stays `payment_failed`, wallet auto-credited, payment stays terminal `failed` | int §20 L, pgTAP 12 |

## 14. Gateway tests — and the live-sandbox runbook

**Automated (green in CI):**
- `functions:test` (Deno, 8/8) — `getGateway()` production-safety
  branching (mock impossible in production/staging; Razorpay refuses to
  start without all 3 secrets; real adapter selected when creds present);
  `buildCheckoutParams` purity + secret-non-leakage; real HMAC round-trip
  + tamper.
- `payment.integration.test.ts` §0 — `RazorpayGateway.verifyWebhookSignature`
  against real `node:crypto` HMACs; `parseWebhookEvent` normalization +
  the `UNSUPPORTED_EVENT` sentinel.
- The full §20 A–O matrix runs against the **mock** adapter for
  deterministic fault injection — clearly labelled MOCK, not "real-money
  verification."

**Manual live-sandbox check (owner, ~15 min — the one item this
environment cannot do):**
1. Create a free Razorpay test-mode account. Copy `rzp_test_…` key id +
   secret.
2. `supabase secrets set PAYMENT_GATEWAY=razorpay RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=…`
   (or a gitignored `.env.local` for `functions:serve`).
3. Dashboard → Webhooks → add `…/functions/v1/payment_webhook`, events
   `payment.captured` + `payment.failed`, set the signing secret to match
   `RAZORPAY_WEBHOOK_SECRET`.
4. Place an order in the app → `create_order` returns a real `order_…`
   ref → open Checkout with `checkoutParams` → pay with a Razorpay test
   card → the webhook fires → order reaches `confirmed`.
5. Refund it from an admin session → `refunds` row + wallet credit.
No production/live keys until this passes in each environment tier
(PHASE_PLAN.md Phase 5 "Rollback").

## 15. Database tests

`npm run db:reset && npm run db:test` → **314/314**, 13 files, ALL GREEN.

- Existing **264 unchanged** (00–11).
- New `12_payment_webhook_refund_test.sql` — **50** assertions:
  ordinary capture (confirm + captured + gateway_payment_ref + redacted
  raw_event + processed_at), duplicate event, distinct-event-for-captured
  no-op, failure webhook (payment_failed + inventory release + wallet
  reversal), stray failure for a confirmed order, amount mismatch,
  currency mismatch, unknown order ref, **late capture** (order stays
  payment_failed, payment stays failed, refunded_amount == amount, one
  reconciliation refund row, wallet credit, redelivered-event guard),
  refund partial → full-with-cancel (+ reservation release + valid
  resting pair), over-refund, refund-on-pending, refund-after-full,
  refund idempotency (replay + count + different-amount conflict).

New authoritative pgTAP count: **314**. No test was weakened; D36 exists
specifically so `07_…`'s "a failed payment is terminal" assertion stays
exactly as approved.

## 16. Integration tests

`npm run test:integration` (real local Supabase + real handlers via
`_dev/serve.ts`) → **83/83**:
- `auth-catalog.integration.test.ts` — 11/11 (unchanged)
- `order.integration.test.ts` — 43/43 (unchanged)
- `payment.integration.test.ts` — **29/29** (new): §0 real-adapter unit
  tests, §20 A–O test matrix, §19 security matrix, genuine `Promise.all`
  for the concurrent-webhook and concurrent-refund cases.

**REAL SANDBOX vs DETERMINISTIC MOCK** — clearly separated: §0 unit-tests
the real `RazorpayGateway` crypto/parse code; everything else drives the
**mock** adapter and is labelled as such. No mock test is presented as
real-money verification.

Dedicated test-OTP customers `9990000007` / `9990000008` (config.toml +
seed.sql) so the payment suite never races the Phase 4 order suite under
`node --test`'s parallel file execution.

## 17. Environment variables

Added to `.env.example` (`EDGE_FUNCTION_ONLY` unless noted):

| Var | Purpose |
|---|---|
| `PAYMENT_GATEWAY` | `razorpay` (or unset) \| `mock`. Selects the adapter. |
| `CRAAVEE_ENV` | `development` (default) \| `staging` \| `production`. In staging/production the mock adapter is impossible and a missing gateway config is a hard startup failure. |
| `RAZORPAY_KEY_ID` | Publishable key id — returned to the client in `checkoutParams` (not a secret; kept server-side for simplicity). |
| `RAZORPAY_KEY_SECRET` | Orders API auth. Never bundled, never logged. |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook HMAC verification only. |
| `CRAAVEE_ALLOW_MOCK_CONTROL` | Existing (Phase 4). Now also gates mock-adapter selection, not just the `x-craavee-mock-gateway` header. |

`CASHFREE_*` slots kept documented but blank (not selected). No secret is
committed — only the well-known local anon/service keys are used in
tests. No `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` gateway var exists.

## 18. Sentry events

`_shared/sentry.ts` `captureException` (structured `console.error`
always; HTTP POST only when `SENTRY_DSN` set) — Phase 5 additions:

| Code | Level | When |
|---|---|---|
| `WEBHOOK_SIGNATURE_INVALID` | error | signature verification failed |
| `WEBHOOK_PARSE_FAILED` | error | signed body could not be parsed |
| `WEBHOOK_PROCESS_FAULT` | fatal | `process_payment_webhook` RPC error (→ 500, gateway retries) |
| `PAYMENT_AMOUNT_MISMATCH` | fatal | webhook amount/currency ≠ `payments.amount` |
| `LATE_CAPTURE_RECONCILIATION` | fatal | D36 path fired |
| `WEBHOOK_UNKNOWN_ORDER` | error | webhook for a gateway ref with no internal payment |
| `GATEWAY_CONFIG` | fatal | `getGateway()` threw (misconfigured deployed env) |
| `REFUND_FAULT` | fatal | `process_refund` RPC error not mapped to a known code |
| `GATEWAY_FAULT` | error | (existing) non-`GatewayError` gateway fault in `create_order` |

**Never logged:** API secrets, `RAZORPAY_WEBHOOK_SECRET`, payment
credentials, OTP, full gateway payloads. `webhook_events.payload` and
`payments.raw_event` store the **redacted** payload (`_shared/redact.ts`
— strips `vpa`, `email`, `contact`, `card`* beyond `last4`/`network`/
`type`, `bank`, `acquirer_data`, …) at write time (D32).

## 19. Files changed

**Database**
- `supabase/migrations/0005_payment_webhook_refunds.sql` (new) —
  `process_payment_webhook`, `process_refund`, grants (service-role only).
- `supabase/tests/12_payment_webhook_refund_test.sql` (new, 50).
- `supabase/config.toml` — `[functions.payment_webhook]` /
  `[functions.refund]` (`verify_jwt = false`); test-OTP `9990000007` /
  `9990000008`.
- `supabase/seed.sql` — `auth.users` rows `1907` / `1908`.

**Edge Functions** (`supabase/functions/`)
- `_shared/gateway/razorpay.ts` (new) — the real adapter.
- `_shared/gateway/index.ts` — rewritten `getGateway()` + `mockGatewayAllowed()`.
- `_shared/gateway/gateway.test.ts` (new) — Deno production-safety + adapter tests.
- `_shared/redact.ts` (new) — D32 payload redaction.
- `_shared/validation.ts` — `refundSchema`.
- `payment_webhook/{handler,index}.ts` (new).
- `refund/{handler,index}.ts` (new).
- `_dev/serve.ts` — routes `payment_webhook` + `refund`.

**Packages** — none changed (`gateway.ts` deliberately untouched — §3).
`packages/ui/src/components/magicui/warp-background.tsx` — a pre-existing
`react-hooks/purity` lint error (unrelated to Phase 5) fixed to keep the
gate's `lint` step green.

**App** (`apps/customer-runner/`)
- `hooks/useOrder.ts` — bounded polling, `paymentStatus` + `refundedAmount`.
- `hooks/usePaymentCheckout.ts` (new) — opens Razorpay Checkout with the
  server-built params; native SDK loaded lazily (not a hard dep).
- `app/(customer)/order/[id].tsx` — payment-state UI (pending / successful
  / failed / refunded / cancelled) + "Complete payment" / "Check status".
- `app/(customer)/checkout.tsx` — carries `paymentIntent` to the order screen.
- `__tests__/payment.integration.test.ts` (new, 29).

**Scripts / CI / docs**
- `package.json` — `functions:check` (+2 fns), `functions:test` (new).
- `.env.example` — the gateway block.
- `.github/workflows/database.yml` — `functions:test` step.
- `docs/engineering/DECISION_LOG.md` — D36 / D37 / D38.
- `docs/engineering/API_CONTRACTS.md` — `payment_webhook` / `refund`
  implementation notes.
- `docs/engineering/PHASE_PLAN.md` — Phase 5 status.
- `README.md`.

## 20. Commands executed (verification)

```
npm run db:reset                                   # 0001–0005 + seed, clean
npm run db:test                                    # pgTAP 314/314 (13 files)
npm run functions:check                            # deno check, exit 0 (5 fns + serve)
npm run functions:test                             # deno test, 8/8
npm run test:integration                           # 83/83 (11 auth + 43 order + 29 payment)
npm run test                                       # unit: 26 + 15 + 3, all pass
npm run typecheck                                  # 7 workspaces, exit 0
npm run lint                                       # exit 0 (2 pre-existing packages/ui warnings)
rm -rf apps/{store,console}/.next && npm run build  # Store + Console compiled successfully
```

## 21. Exact acceptance status (Phase 5 §27)

- [x] real gateway adapter exists — `_shared/gateway/razorpay.ts`
- [~] sandbox payment can be created — **request shape + auth + timeout +
      error mapping verified; a live sandbox call needs real `rzp_test_`
      keys (§14)**. Mock path proven end to end.
- [x] amount is server-authoritative — `payments.amount` from
      `orders.payable`; the gateway request + webhook check both use it;
      client figures ignored (Phase 4 `§24.20-21` still green)
- [x] gateway reference is persisted — `persist_gateway_ref` (Phase 4,
      unchanged); webhook then verifies against it
- [x] valid webhook verifies — int §20 A, `gateway.test.ts`
- [x] invalid webhook is rejected — `403` before parsing — int §20 H/H2, §19.4/5
- [x] duplicate webhook is idempotent — int §20 E/F, pgTAP 12
- [x] payment capture transition works — `pending → captured` — int §20 A, pgTAP 12
- [x] order confirmation transition works — `created → confirmed` — int §20 A, pgTAP 12
- [x] payment/order consistency passes — `09_…` unchanged (3/3); pgTAP 12 forces immediate checks on the new resting pairs
- [x] late-capture path works — int §20 L, pgTAP 12 (D36)
- [x] refund works — int §20 I/K, pgTAP 12
- [x] refund is idempotent — int §20 J/J2/J3, pgTAP 12
- [x] partial refund works — int §20 K, pgTAP 12
- [x] over-refund fails — `REFUND_EXCEEDS_CAPTURED` — int §19.11, pgTAP 12
- [x] unauthorized refund fails — int §19.14/15
- [x] payment security matrix passes — §13 table, all green
- [x] database tests remain fully green — 264 unchanged; **new total 314** (264 + 50)
- [x] order integration remains green — 43/43
- [x] auth/catalog integration remains green — 11/11
- [x] TypeScript passes — 7 workspaces, exit 0
- [x] lint passes — exit 0 (2 pre-existing `packages/ui` warnings)
- [x] Store / Console builds pass — `next build`, both compiled (needs
      `rm -rf .next` first on the exFAT dev volume — carried from Phase 4 §20)
- [x] customer-runner typecheck passes — `tsc --noEmit`, exit 0
- [x] no secrets committed — only the well-known local keys; `RAZORPAY_*`
      never committed; `.env.local` gitignored
- [x] mock gateway cannot activate accidentally in production —
      `getGateway()` throws unless `CRAAVEE_ALLOW_MOCK_CONTROL=1` **and**
      `CRAAVEE_ENV ∉ {production, staging}`; `functions:test` proves it
- [x] production KYC status is documented — §2 (⛔ external blocker)
- [~] real sandbox verification evidence is documented — **§14 is the
      exact runbook; the live run is blocked on credentials not present
      in this environment** (unchanged from Phase 4 §21). The adapter's
      real crypto/parse/request code is unit-tested.

**Two items (`[~]`) are blocked solely on Razorpay test credentials not
provisioned here** — an external dependency `PHASE_PLAN.md` Phase 5 always
flagged, not an engineering gap. Everything reachable without live keys
is green.

## 22. Recommended Phase 6 starting point

Per the stop condition, **none** of the following was started: store
packing workflow, runner claim, runner delivery, delivery codes,
Realtime, notifications, admin operational dashboards.

Phase 6 (store fulfilment) entry point: `mark_packed` / `mark_stock_out`
Edge Functions on `confirmed` orders — `ORDER_STATE_MACHINE.md`
transition #4 (`confirmed → packed`, consume the reservation:
`qty_reserved -= qty`, `qty_on_hand -= qty`) and the "stock-out is not a
state transition" `mark_stock_out` path (which produces the
`confirmed + partially_refunded` pair Phase 5's `refund` already
exercises). The `refund` function's `process_refund` is the right
primitive for `mark_stock_out`'s partial-refund step — reuse it rather
than re-implementing the wallet/ledger/`refunds` writes. The post-pack
cancellation flow (`admin_cancel_order` for `packed`/`assigned` orders)
is the natural companion — Phase 5's `process_refund` deliberately
rejects a full refund on a `packed`/`picked_up` order pending exactly
that function.

**Still an external blocker:** production Razorpay KYC + a live-sandbox
verification pass (§14) before any environment tier activates a real key.
