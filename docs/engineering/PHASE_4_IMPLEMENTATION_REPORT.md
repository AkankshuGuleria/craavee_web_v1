# Phase 4 — Order Creation + Inventory Correctness Implementation Report

Second real product-feature phase. A signed-in customer can now build a
cart, save a structured campus address, check out, and get a real order
row created **transactionally** by the `create_order` Edge Function —
with server-authoritative pricing, pessimistic inventory reservation,
atomic wallet spend, concurrency-safe promo redemption, client-generated
idempotency, and a scheduled reservation-expiry sweep. Phases B/C of
`create_order` run against a **mock** gateway adapter (D12) — no real
money gateway this phase (Phase 5).

**Formal gate — MET.** No duplicate orders · no overselling · no negative
wallet · promo limits cannot be exceeded · no client-controlled pricing ·
no illegal order creation · no duplicate transactional side effects.
Every one is proven by a test that hits the DB / Edge-Function layer
directly, most under genuine `Promise.all` concurrency. pgTAP
**264/264** (was 218; existing 218 unchanged). Order integration suite
**43/43**. Phase 3 auth/catalog suite still **11/11**. Full acceptance
checklist with evidence: §19. One limitation carried forward
unresolved: §20.

---

## 1. Cart architecture

`apps/customer-runner/lib/cart/` — a Zustand store (`store.ts`) over a
pure-function core (`logic.ts`), persisted to AsyncStorage. The client
cart holds **only `{ productId -> qty }`** (Phase 4 prompt §3). It is
never authoritative for price, subtotal, delivery fee, discount, wallet
balance, payable, or inventory — `hooks/useCart.ts` joins it at render
time with the live catalog (`useCatalog`, TanStack Query) to produce an
**indicative** subtotal, clearly labelled as such everywhere it appears.
Qty per line is clamped 1–20 (matches `@craavee/validation`'s
`quantitySchema`; the server re-checks regardless).

`logic.ts` is pure (no React / storage / network) and unit-tested
directly — `add / setQty / increment / decrement / remove / clear`, the
clamp, and `toOrderItems` (the `create_order` wire shape). `store.ts` is
a thin persisted wrapper. Zustand for client cart state, TanStack Query
for server catalog state — exactly the split the prompt specifies; no
duplicated product data source (the cart only ever holds ids).

**Stale-cart handling** (§4/§21): `useCart` surfaces `unavailableLines`
(product exists but sold out) and `missingLines` (product gone from the
catalog) and blocks checkout (`canCheckout = false`) until the customer
resolves them. The cart screen shows a correction banner; items are
never silently dropped. If `create_order` *itself* later reports a
stale-cart error, the checkout screen renders a correction state keyed on
the error code (`lib/orders/errors.ts`, `needsCorrection`), again without
mutating the order.

## 2. Checkout architecture

`app/(customer)/checkout.tsx` + `hooks/useCreateOrder.ts`. The customer
picks an address (`useAddresses`), optionally a promo code
(`useValidatePromo` — advisory preview) and the wallet toggle. Everything
shown before "Place order" is indicative: the promo preview comes from
the advisory `validate_promo` Edge Function, the wallet figure from the
read-only `profiles` row. On "Place order", `useCreateOrder.submit` calls
`create_order`; **its response's financial summary is the only
authoritative one**, and the customer is routed to
`app/(customer)/order/[id].tsx`. Flow: catalog → cart → checkout →
order — four screens, no more (§28).

## 3. `create_order` flow

`supabase/functions/create_order/` — `handler.ts` (the request handler,
also unit-importable) + `index.ts` (the deployed `Deno.serve` wrapper).

1. **Input validation** (`_shared/validation.ts`, a Deno mirror of
   `@craavee/validation`'s `createOrderRequestSchema`, kept in sync by an
   integration assertion): shape / uuid / qty 1–20 / non-empty items.
   Failure → `VALIDATION_FAILED` 400 with the Zod issue list. Unknown
   body keys (`price`, `payable`, `store_id`, …) are stripped by the
   schema — never read.
2. **Authorization** (`_shared/context.ts`): `getUser(token)` verifies
   the JWT; the server-injected `role` claim (D8) must be `customer`
   (else `FORBIDDEN` 403 / `AUTH_REQUIRED` 401). `customerId` / `role` /
   `storeId` come from the token **only**, never the body (§31). Fails
   **closed**: an unreadable role → `null`, never a guessed `customer`.
3. **Idempotency pre-check**: `SELECT` on `orders.idempotency_key`. Same
   key + different request hash → `ORDER_ALREADY_EXISTS` 409 (§9). Found +
   matching → resume per the matrix below. New key → Phase A.
4. **Phase A** — `rpc('create_order_phase_a', …)` (migration 0004, one
   plpgsql transaction, D34): idempotency, address/zone/store validation,
   fixed-order locking, server pricing, inventory reservation, promo
   redemption, wallet debit, `orders` + `order_items` + one `payments`
   row (§4/§5/§6/§10 below). Returns `confirmed` immediately if the
   wallet fully covered it (`payable = 0`).
5. **Phase B** — `rpc('claim_payment_intent', orderId)` (short txn: lock
   `payments`, check the marker, set `gateway_intent_requested_at`,
   commit — releasing the lock), then `gateway.createPaymentIntent(...)`
   via the mock adapter **with no Postgres transaction open** (D24).
6. **Phase C** — `rpc('persist_gateway_ref', orderId, ref)` (3 retries),
   then return `paymentIntent`. Gateway failure/timeout →
   `PAYMENT_SETUP_FAILED` (order + reservation untouched, retry with the
   same key). Persist failure after 3 tries →
   `PAYMENT_RECONCILIATION_REQUIRED` + Sentry P0.

**Resume matrix** (`PHASE_1_1_CORRECTIONS.md` §4.3, implemented in
`handler.ts::resume`): `created` + no intent → Phase B · `created` +
fresh (<60s) claim → `payment_setup_in_progress` · `created` +
`gateway_order_ref` set → rebuild `checkoutParams` (pure fn of ref +
payable, no gateway call) · `confirmed` → return as-is · `payment_failed`
/ `cancelled` → return as-is, **no resume** (a genuine retry needs a new
key).

## 4. Transaction boundaries

| Boundary | Covers | Held across network I/O? |
|---|---|---|
| **Phase A** (`create_order_phase_a`, one plpgsql call) | idempotency check, address/zone/store validation, `profiles`/`promos`/`inventory` row locks, price computation, `qty_reserved` increment, promo `uses_count`++ / `promo_redemptions` insert / wallet_credit payout, wallet debit + `wallet_ledger`, `orders` + `order_items` + one `payments` insert, the `payable=0` → `confirmed` transition, `audit_logs` insert | **No** — commits before any gateway call (D24) |
| **Phase B claim** (`claim_payment_intent`) | lock `payments`, decide, set `gateway_intent_requested_at`, commit | **No** — lock released before the gateway call |
| **Phase C** (`persist_gateway_ref`) | single-row `UPDATE payments SET gateway_order_ref` | **No** |
| **Sweep** (`expire_stale_reservations`, one plpgsql call) | per stale order: release every line's `qty_reserved`, reverse the wallet debit, `payments → failed`, `orders → payment_failed`, `audit_logs` | **No** — no gateway involvement at all |

A single SQL-function invocation is one implicit transaction, so all of
Phase A's locking + writes + the deferred `check_payment_order_consistency`
trigger commit or roll back atomically. `INSUFFICIENT_STOCK` discovered
after the wallet lock rolls the wallet debit back automatically — no
compensation logic (`PHASE_1_1_CORRECTIONS.md` §5).

## 5. Locking order

`wallet → promo → inventory`, inventory rows themselves `ORDER BY
product_id` ascending — D25, `DATABASE_SPEC.md` §14. Documented in
`create_order_phase_a`'s step-6 comment. Mechanism per lock:

- **Wallet**: `SELECT wallet_balance FROM profiles WHERE id = $customer
  FOR UPDATE` (only if `useWallet`). Balance check + debit + `wallet_
  ledger` insert all against the *locked* value, same transaction.
- **Promo**: `SELECT * FROM promos WHERE code = $ FOR UPDATE` (only if a
  code was supplied). Holding this row lock is what makes the plain
  `COUNT(*)` on `promo_redemptions` for the per-user check trustworthy
  (D26) — for *any* `per_user_limit`, not just 1.
- **Inventory**: `SELECT … FROM inventory WHERE (store_id, product_id) IN
  (…) ORDER BY product_id FOR UPDATE` — plain `FOR UPDATE` (not `SKIP
  LOCKED`): a second buyer of the last unit should *wait briefly and get
  an accurate answer*, not a false out-of-stock (D11). Ascending
  `product_id` prevents two overlapping-SKU orders deadlocking.

No network I/O occurs while any of these locks is held (D24). The prompt's
"do the same for any other multi-row lock sequence" applies to no other
Phase 4 function.

## 6. Inventory reservation

`create_order_phase_a` steps 5–8: collect + merge + sort the requested
products; lock every `inventory` row for the derived store in one
`ORDER BY product_id` statement; re-read `qty_on_hand` / `qty_reserved`;
`available = qty_on_hand - qty_reserved`; if **any** line is short →
raise `INSUFFICIENT_STOCK` and the whole transaction rolls back (no
partial order, no partial reservation, no partial wallet debit / promo
redemption); otherwise `UPDATE inventory SET qty_reserved = qty_reserved
+ qty` per line, then insert `order_items` with `reservation_expires_at`
defaulting to `now() + 15 min` on the order (D27). The
`reserved_not_above_on_hand` CHECK (0001) is the last-resort backstop.

Proven: pgTAP `11` (exact-stock reserves exactly `qty_on_hand`;
insufficient-stock raises and leaves `qty_reserved` unchanged);
integration `§24.7` (two genuinely concurrent orders for the last unit —
exactly one succeeds, `qty_reserved` ends at 1, never 2).

## 7. Wallet concurrency

`profiles` row locked first (D25). `useWallet: true` → `wallet_applied =
min(locked_balance, subtotal - discount + delivery_fee)` — partial wallet
+ gateway is supported. `INSUFFICIENT_BALANCE` only when `useWallet:
true` **and** the locked balance is `0` (D33 — see §12). Debit +
`wallet_ledger` (reason `checkout_redemption`) + `profiles.wallet_balance`
decrement, same transaction. `wallet_balance` has a
`CHECK (>= 0)` (0001) as backstop.

Proven: integration `TEST_STRATEGY §2.1#1` — two concurrent
wallet-funded checkouts, balance covers exactly one; exactly one gets
`payable = 0`, the other `INSUFFICIENT_BALANCE`, and
`SUM(wallet_ledger.delta) == profiles.wallet_balance` (and `>= 0`)
immediately after both resolve. pgTAP `11` covers the single-transaction
debit/ledger/`payable=0`→`confirmed` path and the reversal on expiry.

## 8. Promo concurrency

`promos` row locked (D26). Validity (`promo_redeemability`, one helper
used by both `validate_promo_preview` and Phase A): window,
`uses_count < max_uses`, `COUNT(promo_redemptions) < per_user_limit`.
Effect (`promo_order_discount`, D33): `flat` → `min(value, subtotal)`;
`percent` → `floor(subtotal * value / 100)` capped; `wallet_credit` →
`discount = 0` and instead a `wallet_ledger` credit of `value`
(`reason='promo_credit'`) + balance increment (spendable on a *future*
order — the "welcome credit"). On success: `uses_count`++ +
`promo_redemptions` insert, under the still-held lock.

Proven: integration `TEST_STRATEGY §2.1#2a/#2b/#2c` — concurrent
redemption of `max_uses=1` (2 customers → exactly 1), `per_user_limit=1`
(same customer, 2 concurrent → exactly 1), `per_user_limit=3` (same
customer, 5 concurrent → exactly 3); `promos.uses_count` always equals
the `promo_redemptions` row count. pgTAP `11` covers flat/percent math,
expiry, `max_uses`, per-user, and the wallet_credit payout.

## 9. Idempotency

Client-generated `idempotencyKey` (UUID, `expo-crypto`), one per checkout
**attempt**, reused for every retry of that attempt; a new key only on a
deliberate fresh checkout (`useCreateOrder.resetAttempt`). `UNIQUE` on
`orders.idempotency_key` (D23).

- **Same key, same request** → the existing order is returned unchanged
  (both the edge pre-check and `create_order_phase_a`'s step-1 check).
- **Same key, materially different request** → `ORDER_ALREADY_EXISTS`
  409. The server hashes the normalized request (customer + address +
  sorted merged items + promo + wallet flag) into
  `orders.idempotency_request_hash` (D33); a mismatch is rejected at both
  the edge pre-check and inside Phase A's `unique_violation` catch.
- **Concurrent** same-key requests → the `UNIQUE` constraint serializes
  the insert; the loser's Phase A returns `alreadyExisted`, the edge
  function re-fetches and resumes. Exactly one order, one `order_items`
  set, one `payments` row, one reservation, one wallet debit, one promo
  redemption.

Proven: integration `§24.8` (concurrent same key → 1 order, both resolve
to it, 1 payments row), `§24.9`/`§26 M` (different payload → 409),
`§24.30` (sequential retry → same single order). pgTAP `11` covers the
single-transaction replay. Guarantee #1 at the pgTAP layer (duplicate
`idempotency_key` UNIQUE) is `10_core_constraints_test.sql`.

## 10. Payment-record behavior

Exactly one `payments` row per order, always, created in Phase A (D29).
`payable > 0` → `status='pending'`, `gateway='razorpay'` (the mock stands
in for it this phase), `amount = payable`. `payable = 0` (wallet fully
covered) → `status='captured'`, `gateway=NULL`, and `orders` transitions
`created → confirmed` in the same transaction; the deferred
`check_payment_order_consistency` trigger validates the final
`(confirmed, captured)` pair. **No** real gateway payment order is
created — Phase B/C only ever calls the mock adapter. No DB transaction
is held during any gateway call.

## 11. Reservation expiry

`expire_stale_reservations()` (migration 0004) — `SELECT id FROM orders
WHERE status='created' AND reservation_expires_at < now() FOR UPDATE SKIP
LOCKED` (safe under overlapping/concurrent runs, D13 reasoning). Per
order, one transaction: release every `order_items` line's `qty_reserved`,
reverse any wallet debit as a `wallet_ledger` credit with **`reason=
'reservation_reversal'`** (distinct from `refund` — nothing was captured,
D27), `payments → failed`, `orders → payment_failed` (transition #2b,
actor `system`), `audit_logs` (`actor_id = null`,
`action='order.reservation_expired'`).

Scheduling: **pg_cron**, every 1 minute (guarded `create extension if not
exists pg_cron` in 0004; if an environment lacks it the migration still
applies with a NOTICE and the deploy wires a scheduled Edge Function —
`supabase/functions/expire_stale_reservations/` is that HTTP entry point,
and the integration tests call it directly).

Proven: integration `§24.22-24` — a partially-wallet-funded `created`
order forced past its expiry → sweep → `payment_failed` + `payments
failed` + the 2 reserved units released + a `reservation_reversal`
ledger row for the exact wallet amount + wallet ledger stays consistent.
pgTAP `11` covers the same at the function layer.

## 12. Error handling

Canonical `@craavee/api-contracts` `ERROR_CODES` catalogue, extended this
phase with `VALIDATION_FAILED`, `INVALID_PROMO`, `PROMO_LIMIT_REACHED`
(`API_CONTRACTS.md` §5 updated — the original table omitted a
validation-failure code and a promo split, both of which Phase 4 prompt
§22 requires). `_shared/errors.ts` is a Deno mirror + HTTP-status map;
`parseDbError` recovers the canonical code from a `'<CODE>: <detail>'`
plpgsql `RAISE` (same convention as the existing state-machine triggers).
Raw Postgres / gateway strings never reach the client. The app's
`lib/orders/errors.ts` maps each code to `{title, message,
needsCorrection, retryable}` — a `needsCorrection` code shows a cart/
checkout correction state, a `retryable` one shows a retry button.
Envelope: `{ok:true,data}` / `{ok:false,error:{code,message,details?}}`,
HTTP status per `API_CONTRACTS.md` §2.

## 13. Security tests (§26 A–M)

All in `apps/customer-runner/__tests__/order.integration.test.ts`, every
one asserting the manipulated path **fails**:

| | Attack | Result |
|---|---|---|
| A–F | `price` / `subtotal` / `deliveryFee` / `payable` / `walletBalance` / `discount` in the body | stripped by the schema; response totals are all server-computed (`§24.20-21`) |
| G | another customer's `addressId` | `INVALID_ADDRESS` (`§24.26`) |
| H | a product from a different store | `ITEM_UNAVAILABLE` (`§26 H`) |
| I | direct `INSERT` into `orders` via PostgREST | denied — no RLS insert policy, no grant (`§26 I`) |
| J | direct `UPDATE inventory` via PostgREST | denied / 0 rows; `qty_on_hand` unchanged (`§26 J`) |
| K | customer raising own `profiles.wallet_balance` via PostgREST | rejected by `reject_profiles_self_edit_beyond_name` (`§26 K`) |
| L | a non-customer role (seeded admin) calling `create_order` | `FORBIDDEN` 403 (`§26 L`) |
| M | replay same `idempotencyKey`, changed payload | `ORDER_ALREADY_EXISTS` 409 (`§24.9`) |
| — | a client-supplied `store_id` | ignored — the store is derived from the address's zone (`§24.27`) |
| — | no JWT on a well-formed request | `AUTH_REQUIRED` 401 |

`§26 L`'s "promo redemption without valid customer context" is covered by
the `FORBIDDEN` (non-customer) and `AUTH_REQUIRED` (no JWT) cases —
`validate_promo` and `create_order` both gate on the verified `customer`
role before any promo work.

## 14. Concurrency tests

Genuine `Promise.all`, never sequential `await`:

- `§24.7` / `TEST_STRATEGY §2#3` — overselling: 2 concurrent orders for
  the last unit → exactly 1 succeeds, `qty_reserved` = 1.
- `§24.8` / `TEST_STRATEGY §2#1` — 2 concurrent same-`idempotencyKey`
  requests → exactly 1 order, 1 payments row, both calls resolve to it.
- `TEST_STRATEGY §2.1#1` — 2 concurrent wallet checkouts, balance covers
  one → 1 succeeds, 1 `INSUFFICIENT_BALANCE`, ledger consistent, never
  negative.
- `TEST_STRATEGY §2.1#2a/#2b/#2c` — concurrent promo redemption at
  `max_uses=1` (2 customers), `per_user_limit=1` (2 concurrent, same
  customer), `per_user_limit=3` (5 concurrent, same customer) → limit
  never exceeded; `uses_count` == redemption count.
- `§2.1#3/#4/#5/#6` — gateway timeout leaves the order `created` +
  reservation intact; retry (past the 60s claim window) resumes at Phase
  B with exactly one `payments` row / one `gateway_order_ref`; a replay
  after gateway success returns the same `checkoutParams` with no second
  intent; 2 concurrent same-key calls in Phase B → one proceeds, the
  other gets `payment_setup_in_progress`.

## 15. Performance measurements

`scripts/perf-create-order.mjs`, warm local single-node stack:

| Scenario | p50 | p95 | p99 | ok |
|---|---|---|---|---|
| 50 sequential orders, each its own SKU | 24 ms | 30 ms | 35 ms | 100% |
| 25 concurrent orders, all hitting the same 3 SKUs | 324 ms | 330 ms | 331 ms | 100% |

The sequential path is well under `TEST_STRATEGY.md` §3's p95 < 1500 ms
target. The concurrent-on-shared-SKUs number is the **expected** FIFO
lock-and-wait cost of D11 (25 requests serializing on 3 `inventory` rows)
— every one still succeeds, no deadlock, no false out-of-stock; the
deterministic ascending-`product_id` lock order is what keeps it a clean
queue rather than a deadlock. Not optimized further (§27); no Redis.
These are a relative baseline, not a capacity number — the real load
layer is k6 (Phase 12).

## 16. Sentry instrumentation

`supabase/functions/_shared/sentry.ts` — `captureException(err, {fn,
userId, orderId, code, level, extra})`. No-op HTTP POST when `SENTRY_DSN`
is unset (local/CI); a structured `console.error` line is always emitted
for the Supabase log drain. Called for: an unexpected Phase A fault
(`PHASE_A_FAULT`), a non-`GatewayError` gateway fault (`GATEWAY_FAULT`),
the 3-retry persist failure (`PAYMENT_RECONCILIATION_REQUIRED`, `fatal`),
and any uncaught handler error. **Never logs** OTP, payment secrets,
service-role keys, wallet credentials, or gateway signatures — the
captured context is limited to non-sensitive ids + a short message.

## 17. Files changed

**Database**
- `supabase/migrations/0004_order_creation.sql` (new) — §0 trigger fixes
  (D35), §1 `orders.discount` + `idempotency_request_hash` + rewritten
  money-math CHECKs (D33), promo helpers, `validate_promo_preview`,
  `create_order_phase_a`, `claim_payment_intent`, `persist_gateway_ref`,
  `expire_stale_reservations`, grants (service-role only), pg_cron
  schedule.
- `supabase/config.toml` — `[functions.*]` entries, `[auth.sms.test_otp]`
  additions (`9990000004-06`, `09`, and the seeded staff phones).
- `supabase/seed.sql` — Phase 4 test-OTP `auth.users` rows.
- `supabase/tests/11_order_creation_test.sql` (new, 45 assertions);
  `00_*` (+1: the `staff_roles` policy assertion), `10_*` (`discount`
  added to the money-column sweep).

**Edge Functions** — `supabase/functions/` (new): `deno.json`,
`_shared/{http,errors,context,sentry,validation}.ts`,
`_shared/gateway/{types,mock,index}.ts`, `create_order/{handler,index}.ts`,
`validate_promo/{handler,index}.ts`,
`expire_stale_reservations/{handler,index}.ts`, `_dev/serve.ts`.

**Packages** — `packages/api-contracts/src/gateway.ts` (new, the D12
interface), `errors.ts` (+`VALIDATION_FAILED`/`INVALID_PROMO`/
`PROMO_LIMIT_REACHED`), `functions.ts` (`CreateOrderResponse.discount`),
`index.ts`. `packages/types/src/database.ts` regenerated.
`packages/validation/src/__tests__/requests.test.ts` (+2 cases).

**App** — `apps/customer-runner/`: `lib/cart/{logic,store}.ts` +
`__tests__/logic.test.ts`, `lib/orders/errors.ts` +
`__tests__/errors.test.ts`, `lib/format.ts`,
`hooks/{useCart,useAddresses,useValidatePromo,useCreateOrder,useOrder}.ts`,
`app/(customer)/{_layout,index}.tsx` (updated),
`app/(customer)/{cart,checkout}.tsx` + `address/new.tsx` +
`order/[id].tsx` (new), `components/catalog/ProductCard.tsx` (add-to-cart
affordance), `__tests__/order.integration.test.ts` (new, 43 tests),
`package.json` (+`expo-crypto`).

**Scripts / CI / docs** — `scripts/{serve-functions.sh,
perf-create-order.mjs}` (new), root `package.json`
(`functions:serve`/`functions:check`/`test:integration`),
`.github/workflows/database.yml` (Deno setup + functions typecheck +
Phase 4 suite), `README.md`, `DATABASE_SPEC.md` §7, `DECISION_LOG.md`
(D33–D35), `API_CONTRACTS.md` (§3/§5), `PHASE_PLAN.md`.

## 18. Commands run (verification)

```
npm run db:reset                                  # 0001–0004 + seed, clean
npm run db:test                                   # pgTAP 264/264 (12 files)
npm run functions:check                           # deno check, exit 0
cd apps/customer-runner && node --test __tests__/auth-catalog.integration.test.ts   # 11/11
cd apps/customer-runner && node --test __tests__/order.integration.test.ts          # 43/43 (spawns _dev/serve.ts)
npm run test                                      # unit: 26 + 15 + 3, all pass
npm run typecheck                                 # 7 workspaces, exit 0
npm run lint                                      # exit 0 (4 pre-existing packages/ui warnings, unchanged)
rm -rf apps/{store,console}/.next && npm run build # Store + Console compiled successfully
node scripts/perf-create-order.mjs 50 25          # §15
```

## 19. Exact acceptance status (Phase 4 §35)

- [x] customer cart works — `lib/cart/*`, `app/(customer)/cart.tsx`, unit-tested
- [x] structured address selection works — `app/(customer)/address/new.tsx`, `useAddresses` (zone → block/floor/room, no free text)
- [x] checkout works — `app/(customer)/checkout.tsx`
- [x] `create_order` Edge Function exists — `supabase/functions/create_order/`
- [x] server computes all authoritative amounts — `create_order_phase_a` from `products.sale_price` / `zones.delivery_fee` / locked `promos` / locked `profiles`
- [x] client price tampering fails — `§24.20-21` / `§26 A–F`
- [x] address ownership enforced — `§24.26` / `§26 G` (`INVALID_ADDRESS`)
- [x] store/serviceability enforced — `§24.18` (`SERVICE_UNAVAILABLE`), `§24.19` (`STORE_CLOSED`), `§24.27` (store derived, not client-supplied)
- [x] inventory reservation works — `§24.6`, pgTAP `11`
- [x] deterministic inventory locking works — `ORDER BY product_id` in `create_order_phase_a`; perf §15 shows a clean queue, no deadlock
- [x] wallet spending is atomic — pgTAP `11`, single Phase A transaction
- [x] concurrent wallet spend is safe — `TEST_STRATEGY §2.1#1`
- [x] promo redemption is atomic — Phase A transaction, under the `promos` lock
- [x] concurrent promo redemption is safe — `TEST_STRATEGY §2.1#2a/#2b/#2c`
- [x] idempotency works — `§24.30`, pgTAP `11`
- [x] concurrent same-key requests produce one logical order — `§24.8`
- [x] conflicting same-key payload is rejected — `§24.9` / `§26 M` (`ORDER_ALREADY_EXISTS` 409)
- [x] payment row created correctly — `§24.25`, `§8`, pgTAP `11` (one row, `pending` or `captured`)
- [x] no external network call occurs inside the DB transaction — D24; Phase B/C are TypeScript, no txn held; sweep has no gateway
- [x] reservation expiry is implemented safely — `expire_stale_reservations` + `FOR UPDATE SKIP LOCKED` + pg_cron
- [x] inventory release on expiry works — `§24.22-24`, pgTAP `11`
- [x] wallet reversal on expiry works — `§24.22-24` (`reservation_reversal`), pgTAP `11`
- [x] order/payment consistency passes — `09_payment_order_consistency_test.sql` (unchanged, still 3/3), `§24.25`
- [x] customer can view their new order — `app/(customer)/order/[id].tsx`, `useOrder`
- [x] unauthorized direct database mutations fail — `§26 I/J/K`
- [x] complete integration suite passes — 43/43
- [x] existing database suite remains green — 218 unchanged; total now 264 (218 + 45 new + 1 `staff_roles`-policy assertion)
- [x] TypeScript passes — `npm run typecheck`, 7 workspaces, exit 0
- [x] ESLint passes — exit 0 (same 4 pre-existing `packages/ui` warnings)
- [x] Store build passes — `next build`, compiled successfully (needs `rm -rf .next` first on the exFAT dev volume — §20)
- [x] Console build passes — same
- [x] customer-runner typecheck passes — `tsc --noEmit`, exit 0
- [x] no Phase 5+ functionality was implemented — no real Razorpay/Cashfree, no `payment_webhook`, no `refund`, no packing/runner/realtime/notifications/console operational screens
- [x] no secrets committed — only the well-known local anon/service keys ever used; `EDGE_FUNCTION_ONLY` secrets never bundled; `.env.local` gitignored

## 20. Known limitations

1. **Expo Metro bundling still hangs in this sandbox** (carried forward
   from Phase 2B / Phase 3 §12, unchanged). The customer-runner app has
   `tsc --noEmit` + ESLint validation only for Phase 4 — **no native
   bundle validation is claimed**. `expo export` was re-tested and hangs
   identically; the cause remains undiagnosed and is not a Phase 4
   regression. The recommended next step is unchanged: run `npx expo
   start` on a real interactive terminal outside this environment.

2. **`supabase functions serve` fails to boot the CLI edge-runtime
   container** on this machine — "worker boot error: failed to determine
   entrypoint", reproducible with a trivial one-line function and no
   `deno.json`; it is a CLI (2.113) / edge-runtime-image (v1.74.3)
   issue, not a function-code issue. Mitigation: `supabase/functions/
   _dev/serve.ts` runs the **same handler code** via `deno run`, routing
   `/functions/v1/<name>` exactly as the deployed edge runtime does. The
   handlers, the Postgres they talk to, and the JWT verification path are
   identical to production; only the process wrapper differs. `npm run
   functions:serve` and the CI job use this. `supabase functions deploy`
   is unaffected (it bundles per-function, not via the local container).

3. **Next.js build needs `rm -rf .next` first** on the exFAT dev volume
   ("Failed to open database / Loading persistence directory failed" —
   Next 16's persistent build cache DB, same class of exFAT
   incompatibility as the `pg_prove` and Metro issues). Both apps build
   cleanly once the stale cache is removed; CI (fresh checkout) is
   unaffected.

4. **`custom_access_token_hook` staff-role branch was silently broken
   since Phase 2** and is fixed in 0004 §0 (D35). Phase 3 only ever
   asserted the `customer` branch, which masked it. Staff auth for
   Store/Console is Phase 6/9 scope; this fix unblocks it.

5. **`promos` has no `min_order` column**, so the prompt's "validate
   minimum order if applicable" is a documented no-op. If a
   minimum-order promo becomes a real requirement it needs a schema
   column + a `DATABASE_SPEC.md` change first.

## 21. Recommended Phase 5 starting point

Per the stop condition, none of the following was started: real
Razorpay/Cashfree adapter, `payment_webhook`, `refund`, packing, runner
claim, delivery, realtime, notifications, admin operational integration.

Phase 5's entry point is **replacing the mock gateway adapter with a real
one behind the identical `PaymentGatewayAdapter` interface**
(`packages/api-contracts/src/gateway.ts`) — `create_order`'s Phase A/B/C
control flow does not change, only `_shared/gateway/index.ts`'s
`getGateway()` factory. Then `payment_webhook` (signature verification +
the `webhook_events` dedup + the D30 late-capture reconciliation branch,
for which the `created + pending` / terminal-state pairs are already in
`payment_order_consistency_rules`) and `refund` (the `refunds` table +
`idempotencyKey`, already in the schema). The `expire_stale_reservations`
↔ late-webhook interaction (§10 of `PHASE_1_1_CORRECTIONS.md`) is the
first thing to test once the webhook exists. Gateway KYC is the external
blocker flagged in `PHASE_PLAN.md` Phase 5 and `docs/audit/PHASE_0_
REPOSITORY_AUDIT.md` — if it is still pending, Phase 5 is blocked on that,
not on engineering.
