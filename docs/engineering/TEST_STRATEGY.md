# Test Strategy

## 1. Layers

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest (matches existing TS toolchain) | `packages/validation` Zod schemas, pure business logic helpers (price computation, transition-table lookup mirrored in TS for client-side UX hints) |
| Integration | Vitest + a real local Supabase instance (`supabase start`) | Edge Functions called end-to-end against a real (local) Postgres — not mocked, since the entire point of this architecture is DB-enforced correctness that a mock would hide |
| Database / RLS | pgTAP | Every RLS policy in `RBAC_MATRIX.md` §5, every CHECK constraint, every index in `DATABASE_SPEC.md`, the `enforce_order_transition` trigger |
| Edge Function contract | Vitest, against `packages/api-contracts` types | Request/response shape conformance — a function returning something that doesn't match its documented contract fails CI, catching drift between `API_CONTRACTS.md` and the implementation |
| End-to-end | Playwright (`apps/store`, `apps/console`), Detox or Maestro (`apps/customer-runner`, once Phase 10 exists) | Full user flows through the real UI against a real (local/staging) backend |
| Load | k6 | §3 below |

## 2. Correctness guarantee tests (dossier §13 — the six, tested at the database/API layer, never only through the UI, per Phase 1 prompt §7.27)

| # | Guarantee | Test approach |
|---|---|---|
| 1 | No duplicate orders | pgTAP: insert two `orders` rows with the same `idempotency_key` directly via SQL, assert the second violates the UNIQUE constraint. Integration: call `create_order` twice with the same `idempotencyKey` concurrently (two parallel requests, not sequential — a sequential test would only prove the check-then-insert logic works when uncontended, not under a real race), assert exactly one order exists and both calls return the same `orderId`. |
| 2 | No duplicate payment captures | pgTAP: two `payments` rows with the same `gateway_payment_ref`, assert UNIQUE violation. Integration: POST the same webhook payload (same `gateway_event_id`) to `payment_webhook` twice, assert `payments` has exactly one `captured` row and the second call is a no-op (checked via `webhook_events` row count = 1, not 2). |
| 3 | No overselling | Integration: seed `inventory` with `qty_on_hand=1, qty_reserved=0`; fire two concurrent `create_order` calls for that SKU (`Promise.all`, genuinely parallel against the local Postgres, not `await`ed sequentially); assert exactly one succeeds and the other receives `INSUFFICIENT_STOCK`; assert final `qty_reserved=1`, never `2`. |
| 4 | No double assignment | Integration: two concurrent `claim_job` calls for the same `packed` order from two different runners; assert exactly one succeeds (`assigned`), the other gets `JOB_ALREADY_CLAIMED`. |
| 5 | One live job per runner | pgTAP: attempt to insert/update a second `orders` row to `status='assigned', runner_id=X` while another row already has `runner_id=X, status='assigned'`; assert the partial unique index rejects it. Integration: same scenario through `claim_job` (runner already has a live job, attempts to claim a second) → `RUNNER_ALREADY_ASSIGNED`. |
| 6 | No illegal order transitions | pgTAP, parameterized over every `(from, to)` pair **not** in `ORDER_STATE_MACHINE.md` §2's table (generated from that table, not hand-maintained separately, so the test suite and the spec can't silently drift apart) — assert every one of them raises `INVALID_ORDER_TRANSITION`. Also parameterized over every valid pair attempted by the *wrong actor role* — assert rejection even when the `(from,to)` pair itself is otherwise legal. |

Every one of these six is tested by directly hitting the database/Edge
Function layer (raw SQL for pgTAP, direct function invocation for
integration tests) — **never only through a UI interaction**, per the
Phase 1 prompt's explicit instruction, because a UI test can only prove
"the button is disabled," not "the database would reject this even if
the button weren't."

## 2.1 Concurrency & payment-flow correctness tests (new, Phase 1.1)

Added by the Phase 1.1 specification review (`PHASE_1_1_CORRECTIONS.md`
§10) — these target the three real correctness gaps that review found
(payment transaction scope, wallet concurrency, promo concurrency) plus
the new payment/order consistency invariant (D30). Same discipline as §2
above: database/API layer, never UI-only.

| # | Case | Test approach |
|---|---|---|
| 1 | Two simultaneous wallet-spending checkouts, same customer | Seed `wallet_balance` to cover exactly one of two concurrent `create_order` calls requesting `useWallet`; fire both genuinely in parallel; assert exactly one succeeds, the other gets `INSUFFICIENT_BALANCE`, and `SUM(wallet_ledger.delta) = profiles.wallet_balance` immediately after both resolve (not just checking the final balance value — a bug that transiently double-counted mid-transaction should still be caught) |
| 2a | Concurrent promo redemption, `max_uses=1` | Two different customers, concurrent `create_order` calls with the same promo code where `max_uses=1`; assert exactly one redemption succeeds, `promos.uses_count=1`, exactly one `promo_redemptions` row |
| 2b | Concurrent promo redemption, `per_user_limit=1` | Same customer, two concurrent `create_order` calls with the same promo code; assert exactly one succeeds, one `promo_redemptions` row for that customer |
| 2c | Concurrent promo redemption, `per_user_limit=3` | Same customer, five concurrent `create_order` calls with the same promo code; assert exactly three succeed, `promo_redemptions` count for that customer never exceeds 3 |
| 3 | Gateway timeout immediately after Phase A commits | Mock the gateway adapter to time out; call `create_order`; assert `orders.status` remains `'created'`, `reservation_expires_at` unchanged, inventory still reserved |
| 4 | Retry after a gateway timeout | Following case 3, call `create_order` again with the same `idempotencyKey` against a now-succeeding mock gateway; assert exactly one `payments` row and exactly one `gateway_order_ref` ever set — the gateway adapter's `createPaymentIntent` was invoked at most twice total (once failed, once succeeded), never producing two live intents |
| 5 | Gateway succeeds but the client "disconnects" before reading the response | Mock gateway succeeds; simulate the response never reaching the caller; a subsequent call with the same `idempotencyKey` returns the same `checkoutParams`; assert the mocked `createPaymentIntent` was called exactly once across both attempts |
| 6 | Duplicate payment-setup attempts within the 60-second claim window | Two concurrent `create_order` calls with the same `idempotencyKey`, both landing in Phase B before either completes; assert one proceeds to call the gateway and the other receives `status: 'payment_setup_in_progress'` without a second gateway call |
| 7 | Late webhook after reservation expiry | Force an order into `payment_failed` via `expire_stale_reservations`; then deliver a `captured` webhook for that order's `gateway_order_ref`; assert `orders.status` remains `payment_failed` (never reverts to `confirmed`), a `refunds` row is created crediting the wallet for the full captured amount, and `payments.status` ends at `refunded` — all within the webhook's own transaction |
| 8 | Duplicate refund request | Call `refund` twice with the same `idempotencyKey`; assert exactly one `refunds` row and `payments.refunded_amount` incremented exactly once |
| 9 | Invalid order/payment state combinations | pgTAP, parameterized over every ✗ combination in `ORDER_STATE_MACHINE.md` §2.1 / `PHASE_1_1_CORRECTIONS.md` §9 (generated from that table, same discipline as guarantee #6's test above); assert each raises `PAYMENT_ORDER_STATE_MISMATCH` |

## 3. Load testing (k6)

**Target:** 1,600 virtual users (2× the dossier §14 launch-day peak
estimate of ~800 concurrent — "anything that breaks at 2× would have
broken at 1× under real jitter and cold starts").

**Scenarios** (per Phase 1 prompt §7.26, mapped onto dossier §14's launch
burst shape — fig. 06 in the dossier: install/signup stampede, then a
first-order wave):

| Scenario | Shape | What it exercises |
|---|---|---|
| Authentication flow | Ramp 0→800 VUs over 90s (matches dossier's "800 people opening the app inside ninety seconds"), each doing phone-submit + OTP-verify | Supabase Auth OTP throughput (dossier §14 failure mode #1) — **note:** k6 cannot receive real SMS; this scenario needs a test-mode OTP bypass (a Supabase Auth test phone number / fixed OTP for load-test-tier accounts only, never enabled in production) — flagged here as a Phase 12 implementation prerequisite, not resolved in this spec |
| Catalog load | 1,600 VUs, each fetching the product catalog + images | PostgREST read throughput, CDN/image-cache behavior (dossier failure mode #3) |
| Browsing | 1,600 VUs with realistic think-time, paging through catalog/categories | Sustained read load, not just the initial burst |
| Order placement | 400 VUs (a smaller, realistic fraction actually check out, not all 1,600) calling `create_order` with varied, mostly-non-overlapping SKUs | `create_order` **Phase A** transaction latency under load (Phase B/C's gateway call runs against the gateway's own test-mode infrastructure, not something this load test's thresholds should hold Craavee's own database accountable for — see the mocked-gateway note under the pass/fail thresholds, below) |
| Concurrent purchase contention | 50 VUs deliberately targeting the *same* 3–5 low-stock SKUs simultaneously | The overselling guarantee under real concurrency, at load — the deliberately adversarial version of the correctness test in §2, run at scale rather than just 2 concurrent calls |
| Concurrent promo contention (new, Phase 1.1) | 100 VUs deliberately redeeming the *same* launch-hackathon promo code simultaneously, `per_user_limit=1`, a realistic `max_uses` | The promo concurrency guarantee (D26/§2.1 case 2a) at load — asserts `promos.uses_count` never exceeds `max_uses` even under the exact "800 people in one room" contention shape the hackathon launch actually produces |
| Customer order polling | 400 VUs (the order-placement cohort) polling their own order every 8s (D20) for the scenario's duration | Sustained polling read load — this is the scenario that validates D20's "100 req/s at 800 concurrent trackers" estimate against reality |
| Runner claims | 10–15 VUs (realistic runner headcount, dossier §3: "six to ten runners") repeatedly attempting `claim_job` against the `packed` queue | Claim contention at *realistic* (low) runner concurrency — deliberately not scaled up, since inflating runner count would test an unrealistic scenario |
| Status transitions | Scripted sequence per synthetic order: `mark_packed` → `claim_job` → `mark_picked_up` → `verify_delivery_code`, timed end-to-end | Full fulfilment-loop latency under background load from the other scenarios running concurrently |

**Pass/fail thresholds** (initial proposal — dossier §22's launch targets
are the north star, adapted into k6 `thresholds`):

- `http_req_duration{scenario:catalog}`: p95 < 500ms
- `http_req_duration{scenario:order_placement}`: p95 < 1500ms (this is a
  multi-table transaction with row locks, not a simple read — a higher
  bar than catalog reads is appropriate, not a red flag)
- `http_req_failed` rate < 1% across all scenarios **except** the
  concurrent-purchase-contention scenario, where a meaningful fraction of
  `INSUFFICIENT_STOCK` responses are the *expected, correct* outcome —
  that scenario's pass criterion is "zero orders exceed available stock,"
  not "zero failed requests" (a naive failure-rate threshold would
  actively penalize the system for working correctly)
- Connection pool: zero `PgBouncer`/Supavisor connection exhaustion
  errors (dossier §14 failure mode #2) at any point during any scenario
- Realtime: staff-surface channel count stays at the dossier's own
  estimate (~15 connections) throughout — a regression here (e.g. a bug
  that subscribes customers to Realtime despite D20) should fail the
  test even if raw throughput numbers look fine

**Explicitly not in scope for this spec:** the actual k6 script files.
Per Phase 1 prompt §7.26, this section is the scenario/threshold design;
implementation is a Phase 12 (or a `load-tests/k6/` scaffold introduced
opportunistically once Phase 4's `create_order` exists, whichever comes
first — see `PHASE_PLAN.md`).

## 4. Definition of "tested" for this project

A correctness-critical mechanism (the six guarantees, RLS policies,
payment/refund paths) is not considered done until it has a pgTAP or
integration test that fails without the mechanism and passes with it
(i.e., the test was verified to actually catch the bug it claims to catch
— written by temporarily reverting the fix and confirming red, not just
trusted to be meaningful). This is a testing-discipline note for Phase 2+
implementers, not a new mechanism — flagged here because "we have a test"
and "we have a test that would catch a regression" are different claims,
and only the second one is worth anything for a system with six explicit
correctness guarantees as its headline engineering promise.
