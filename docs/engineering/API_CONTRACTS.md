# API Contracts

Two kinds of API surface, per `DECISION_LOG.md` D9: direct PostgREST reads/
simple writes (RLS-gated, contracts are just the table shape in
`DATABASE_SPEC.md` + the policy in `RBAC_MATRIX.md` — not repeated here),
and Edge Functions for anything contended, multi-table, or externally
triggered. This document specifies the Edge Function contracts (§2), the
validation layer they share with the clients calling them (§3), the
canonical error catalogue (§4), and the idempotency model (§5).

All Edge Function request/response shapes below are also the
`packages/api-contracts` TypeScript types Phase 2+ generates from — this
document is the source, the types are derived, not the other way round.

## 1. Mutation categories (revised Phase 1.1 — D31)

The dossier's "four contended writes" described its own deliberately
minimal MVP scope — by the time Phase 1 specified every function this
spec set actually needs, that literal count was no longer accurate and
the two documents contradicted each other. Superseded here by **four
mutation categories**, preserving the *reason* the dossier's framing
mattered (a small number of reviewable, correctness-critical write paths,
not dozens of ad hoc mutating routes) without an outdated literal count.
Every Edge Function in §3 below is classified into exactly one category,
except `validate_promo`, called out separately as the one non-mutating
advisory function in this API surface.

| Category | Functions | Shared characteristic |
|---|---|---|
| **1. Order & Payment Lifecycle** | `create_order`, `payment_webhook`, `refund`, `expire_stale_reservations` | Multi-table transactions with money/inventory/wallet effects; the four functions the dossier's original "four contended writes" language was actually describing, now explicitly named as a category rather than implied to be the only four functions in the system |
| **2. Fulfilment Claim & Handoff** | `claim_job`, `release_job`, `mark_picked_up`, `verify_delivery_code`, `mark_delivery_failed` | Contended row-locking transitions on an already-existing order, actor is `runner` (or admin override) |
| **3. Store-Side Reconciliation** | `mark_packed`, `mark_stock_out` | Multi-table transactions touching `orders`+`order_items`+`inventory` together, actor is `packer` (or admin) |
| **4. Administrative / Privileged** | `admin_cancel_order`, `admin_reassign`, `assign_staff_role`, `settle_runner_earnings` | Service-role-authorized operations not expressible as a safe RLS-gated direct write, actor is always `admin` |
| *(advisory, not a mutation category)* | `validate_promo` | Read-only simulation — the authoritative promo check happens inside `create_order` Phase A; this function exists purely so the checkout UI can show a discount before the customer commits |

`create_order`'s own internal Phase A/B/C split (§3, `DECISION_LOG.md`
D24) does not introduce additional public functions — a client calls
`create_order` once per attempt (including retries/resumes), and the
function itself sequences the three phases internally.

## 2. Envelope conventions

- Request: `POST` with JSON body, `Authorization: Bearer <jwt>` header
  (except `payment_webhook`, which authenticates via gateway signature —
  see its entry).
- Response (success): `{ ok: true, data: <T> }`.
- Response (failure): `{ ok: false, error: { code: ErrorCode, message:
  string, details?: unknown } }` — `code` is always one of §4's catalogue,
  never an ad hoc string (Phase 1 prompt §7.20).
- HTTP status: `200` for success, `400` for validation errors, `401`
  unauthenticated, `403` authenticated-but-forbidden, `404` not found/not
  visible (RLS-equivalent — a customer requesting another customer's
  order gets `404`, not `403`, to avoid confirming the order exists),
  `409` conflict (e.g. `JOB_ALREADY_CLAIMED`), `422` business-invariant
  violation (e.g. `INSUFFICIENT_STOCK`), `429` rate-limited, `500` genuine
  server fault.

## 3. Edge Function contracts

### `create_order`

**Rewritten in full, Phase 1.1 (`DECISION_LOG.md` D24) — the original
version of this contract held a Postgres transaction open across the
gateway network call. Full narrative: `PHASE_1_1_CORRECTIONS.md` §4.**

- **Auth:** required, role `customer`.
- **Request:** `{ idempotencyKey: uuid, addressId: uuid, items: [{
  productId: uuid, qty: int }], promoCode?: string, useWallet?: boolean
  }` — same shape as before; the request contract to the client did not
  change, only what happens behind it.
- **Response:** `{ orderId: uuid, status: 'created'|'confirmed'|
  'payment_setup_in_progress', subtotal: int, discount: int,
  deliveryFee: int, walletApplied: int, payable: int, paymentIntent?: {
  gateway: string, gatewayOrderRef: string, checkoutParams: object } }`.
  (`discount` added Phase 4, D33 — `orders.discount`; `subtotal` is the
  gross goods total, `payable = subtotal - discount + deliveryFee -
  walletApplied`.) `status:
  'payment_setup_in_progress'` is new (Phase 1.1) — returned when a
  concurrent invocation for the same order has already claimed the right
  to call the gateway and hasn't finished yet (§ Idempotency below);
  `paymentIntent` is absent in that case, and the client should retry
  shortly. `status: 'confirmed'` with no `paymentIntent` means the order
  was fully wallet-covered and skipped the gateway entirely.
- **Validation (Zod, §4):** `items` non-empty, `qty` 1–20 per line (a
  sane per-SKU cap, not a dossier requirement — flagged as an engineering
  default, revisit if a real use case needs more), `addressId` belongs to
  the caller.
- **Wallet semantics (Phase 4, D33):** `useWallet: true` applies as much
  wallet as the order needs, up to the (locked) balance — partial wallet
  + gateway is supported. `INSUFFICIENT_BALANCE` is returned only when
  `useWallet: true` and the locked `wallet_balance` is `0`.
- **Idempotency payload guard (Phase 4, D33):** the server hashes the
  normalized request (`orders.idempotency_request_hash`). A replay of the
  same `idempotencyKey` with a materially different request (address,
  items, promo, or wallet choice) returns `ORDER_ALREADY_EXISTS` (409) —
  it never silently returns an order the caller did not ask for.
- **Authorization:** caller must own `addressId`; the resolved `zone`
  must be `is_serviceable`; the resolved `store` must be `is_open` and
  under `max_queue_depth` (else `STORE_CLOSED`/`SERVICE_UNAVAILABLE`).
- **Execution — three phases, at most two short Postgres transactions, no transaction held across network I/O:**
  1. **Idempotency check first, always:** `SELECT ... FROM orders WHERE
     idempotency_key = $1`. If found, skip directly to whichever of
     Phase B/C (below) the existing row's state calls for — Phase A never
     re-runs for an existing order. See the resume matrix under
     Idempotency, below.
  2. **Phase A (single transaction).** Validate address/zone/store state;
     acquire locks **in fixed order — wallet, then promo, then inventory
     (ascending `product_id`)** per `DECISION_LOG.md` D25 (full mechanism:
     §"Wallet concurrency" and §"Promo concurrency" below); compute
     authoritative prices server-side (**the client's `items` never
     carries a price, only `productId`+`qty`**); check/reserve inventory;
     validate/apply promo; validate/apply wallet; insert `orders` (with
     `reservation_expires_at = now() + 15m`, D27) + `order_items`; insert
     **exactly one** `payments` row (D29) — `status='captured'`,
     `orders.status='confirmed'` in this same transaction if `payable=0`
     (wallet fully covered it — nothing further to do, return now);
     otherwise `payments.status='pending'`; insert `audit_logs`; commit.
  3. **Phase B (no transaction held).** Short claim transaction: lock the
     `payments` row, check `gateway_order_ref`/`gateway_intent_requested_
     at` (see Idempotency below for the exact resume logic), set
     `gateway_intent_requested_at = now()`, commit — **releasing the lock
     before the network call**. Call `createPaymentIntent` via the
     gateway adapter (D12) with no Postgres transaction open.
  4. **Phase C (short transaction).** On gateway success:
     `UPDATE payments SET gateway_order_ref = $ref`, commit, return
     `paymentIntent` to the client. On gateway failure/timeout: no write
     beyond the stale claim marker; return `PAYMENT_SETUP_FAILED`, the
     order and reservation are untouched, client retries with the same
     `idempotencyKey`. On a persistent DB-write failure at this exact
     step (rare — see the full compensation table): retry the `UPDATE`
     up to 3 times, then return `PAYMENT_RECONCILIATION_REQUIRED` and
     raise a Sentry P0 alert with the gateway's own reference captured in
     the alert payload for manual reconciliation.
- **Idempotency — full resume matrix (`PHASE_1_1_CORRECTIONS.md` §4.3):**

  | Replay finds... | Resume behavior |
  |---|---|
  | `status='created'`, no gateway intent claimed | Resume at Phase B — attempt to claim and create the gateway intent |
  | `status='created'`, claim < 60s old, no `gateway_order_ref` | Do **not** call the gateway again — return `status: 'payment_setup_in_progress'` |
  | `status='created'`, `gateway_order_ref` set | Return the existing order + the same `checkoutParams` (derived from the stored ref, no new gateway call) |
  | `status='confirmed'` | Return the confirmed order, no side effects |
  | `status='payment_failed'` (terminal) | Return the failed order as-is — **no resume**; a genuine retry requires a **new** `idempotencyKey` (a new order), since resuming a row the state machine already closed would reopen a closed transition |

  No replay in any state ever creates a second order, reserves stock
  twice, spends wallet twice, or creates a duplicate `payments` row
  (`UNIQUE(order_id)`, D29) or duplicate gateway intent (the claim marker
  + `gateway_order_ref IS NOT NULL` short-circuit together prevent it).
- **Wallet concurrency (D25):** `SELECT wallet_balance FROM profiles
  WHERE id = $customer_id FOR UPDATE`, acquired first in Phase A's fixed
  lock order, before the balance check. Debit and `wallet_ledger` insert
  happen in the same transaction, so a later failure in the same Phase A
  transaction (e.g. `INSUFFICIENT_STOCK` discovered after the wallet
  lock) rolls the debit back automatically via ordinary transaction
  atomicity — no separate compensation logic needed for same-transaction
  failures. A failure *after* Phase A commits (gateway timeout, reservation
  expiry) is reversed via `wallet_ledger` credit,
  `reason='reservation_reversal'`, by `expire_stale_reservations` or the
  relevant failure-handling branch of `payment_webhook`.
- **Promo concurrency (D26):** `SELECT * FROM promos WHERE code = $1 FOR
  UPDATE`, second in the fixed lock order. This single lock correctly
  serializes both the global `max_uses` check (via `promos.uses_count`)
  and the per-customer `per_user_limit` check (via a now-safe-to-trust
  `COUNT(*)` against `promo_redemptions`, safe specifically because the
  lock excludes every other concurrent redeemer of that code) — see
  `DATABASE_SPEC.md` §11.
- **Errors:** `AUTH_REQUIRED`, `INVALID_ADDRESS`, `SERVICE_UNAVAILABLE`,
  `STORE_CLOSED`, `ITEM_UNAVAILABLE`, `INSUFFICIENT_STOCK`,
  `INSUFFICIENT_BALANCE` (wallet requested beyond balance),
  `PAYMENT_SETUP_FAILED` (new — Phase B/C failure, safe to retry),
  `PAYMENT_RECONCILIATION_REQUIRED` (new — rare Phase C DB-write failure
  after gateway success, needs human reconciliation), `ORDER_ALREADY_
  EXISTS` (should not surface as an error in practice — idempotent replay
  returns 200, this code exists for the theoretical race where the
  unique constraint fires between the pre-check and insert, handled by
  catching the constraint violation and re-fetching).

### `claim_job`
- **Auth:** required, role `runner`.
- **Request:** `{ orderId: uuid }`.
- **Response:** `{ orderId: uuid, status: 'assigned', address: {
  block, floor, room, landmark, zoneName }, itemSummary: string }`.
- **First step (Phase 1.1, D28):** resolve the caller's `runners.id` from
  `SELECT id FROM runners WHERE profile_id = auth.uid()` — `orders.
  runner_id` references `runners.id`, not `profiles.id`/`auth.uid()`
  directly, so every subsequent step operates in terms of this resolved
  value.
- **Transaction boundary:** `SELECT ... FOR UPDATE SKIP LOCKED` on the
  target order (D13); if the row is locked or already non-`packed`,
  immediately return `JOB_ALREADY_CLAIMED` (409) — no waiting. On
  success: verify caller's `runners.id` has no other `assigned`/
  `picked_up` order first (belt-and-suspenders check *before* the write
  attempt, in addition to the partial unique index catching it if this
  check somehow races) → `RUNNER_ALREADY_ASSIGNED` if so. Then
  `UPDATE orders SET status = 'assigned', runner_id = <resolved
  runners.id>`, trigger stamps `assigned_at`, `audit_logs` insert.
- **Idempotency:** not independently idempotent (claiming is inherently
  a one-shot contest) — a client retry after a timeout should first
  `GET` the order to check if its own prior attempt actually succeeded,
  not blindly re-`POST`.
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN` (wrong store), `JOB_ALREADY_
  CLAIMED`, `RUNNER_ALREADY_ASSIGNED`, `INVALID_ORDER_TRANSITION`.

### `release_job`
- **Auth:** required, role `runner` (own job) or `admin`.
- **Request:** `{ orderId: uuid, reason?: string }`.
- **Response:** `{ orderId: uuid, status: 'packed' }`.
- **Transaction boundary:** transition #8 in `ORDER_STATE_MACHINE.md` —
  clears `runner_id`, returns order to the claimable queue.
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN`, `INVALID_ORDER_TRANSITION`.

### `mark_picked_up`
- **Auth:** required, role `runner`, must be the assigned runner.
- **Request:** `{ orderId: uuid }`.
- **Response:** `{ orderId: uuid, status: 'picked_up' }`.
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN`, `INVALID_ORDER_TRANSITION`.

### `verify_delivery_code`
- **Auth:** required, role `runner`, must be the assigned runner.
- **Request:** `{ orderId: uuid, code: string /* 4 digits */ }`.
- **Response (success):** `{ orderId: uuid, status: 'delivered' }`.
- **Rate limiting:** checks `rate_limit_events` for ≥5 `'delivery_code_
  attempt'` rows for this `orderId` in the last 15 minutes before even
  comparing the hash; if exceeded, `RATE_LIMITED` (429) regardless of
  whether the submitted code is correct. Every attempt (right or wrong)
  writes a `rate_limit_events` row first, then compares.
- **Transaction boundary:** hash comparison (`crypt(code,
  delivery_code_hash) = delivery_code_hash`), on match: transition to
  `delivered`, insert `runner_earnings` row, `audit_logs` insert — all
  one transaction. On mismatch: no state change, `DELIVERY_CODE_INVALID`
  (400), attempt still logged to `rate_limit_events`.
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN`, `DELIVERY_CODE_INVALID`,
  `RATE_LIMITED`, `INVALID_ORDER_TRANSITION`.

### `mark_delivery_failed`
- **Auth:** required, role `runner` (own job) or `admin`.
- **Request:** `{ orderId: uuid, reason: string /* required, free text
  for now — see PHASE_PLAN.md if a closed reason-code set becomes
  worthwhile later */ }`.
- **Response:** `{ orderId: uuid, status: 'delivery_failed' }`.
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN`, `INVALID_ORDER_TRANSITION`.

### `mark_packed`
- **Auth:** required, role `packer`, own store.
- **Request:** `{ orderId: uuid }`.
- **Response:** `{ orderId: uuid, status: 'packed' }`.
- **Transaction boundary:** for every `order_items` row with
  `fulfilled_qty` still at its default (i.e. not already adjusted by a
  prior `mark_stock_out` call on this order), set `fulfilled_qty = qty`;
  consume the corresponding `inventory` reservation
  (`qty_reserved -= qty`, `qty_on_hand -= qty`); transition order.
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN`, `INVALID_ORDER_TRANSITION`.

### `mark_stock_out`
- **Auth:** required, role `packer` (own store) or `admin`.
- **Request:** `{ orderId: uuid, orderItemId: uuid, availableQty: int
  /* 0 for a total miss, >0 for a partial */ }`.
- **Response:** `{ orderItemId: uuid, fulfilledQty: int, refundAmount:
  int, newPayable: int }`.
- **Transaction boundary:** set `order_items.fulfilled_qty =
  availableQty`; release the unfulfilled portion's reservation
  (`qty_reserved -= (qty - availableQty)`); delist or zero the product's
  effective availability if this is flagged as a full stock-out (`products.
  is_listed = false` for that store, or `inventory.qty_on_hand = qty_on_
  hand at time of discovery` — whichever the packer/admin indicates via
  an optional `delist: boolean` field, default `true` for a full miss);
  reduce `orders.subtotal`/`payable` by the unfulfilled value; write a
  `wallet_ledger` refund (reason `'refund'`) for that amount; `audit_
  logs` insert. Order does **not** change `status` — it continues toward
  `packed` normally (see `ORDER_STATE_MACHINE.md` "Stock-out is not a
  state transition").
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN`, `ITEM_UNAVAILABLE` (if
  `availableQty` exceeds the original `qty`, which would be a client
  bug, not a real state).

### `payment_webhook`

**Implemented Phase 5** (`supabase/functions/payment_webhook/` +
`process_payment_webhook`, migration 0005; gateway = Razorpay, D37). The
handler: reads the raw body → `verifyWebhookSignature` (HMAC-SHA256,
constant-time) → `403` with no detail on failure → `parseWebhookEvent`
(an `UNSUPPORTED_EVENT:` sentinel is acked `200` and ignored) → redacts
the payload (D32) → one `process_payment_webhook` RPC. The `(gateway,
gateway_event_id)` UNIQUE row is the idempotency mechanism; the event id
is the `x-razorpay-event-id` header when present, else a deterministic
body-derived id. A late `captured` event for an already-terminal order is
reconciled per **D36** (records + auto-refunds to wallet **without**
moving `payments.status` out of terminal `failed` — `enforce_payment_
transition` keeps `failed` terminal). Sentry alerts: amount/currency
mismatch, late-capture reconciliation, unknown gateway order ref.

- **Auth:** **not** a Craavee JWT — this endpoint is called by the
  payment gateway, not an authenticated app user. Authentication is
  **signature verification** (`verifyWebhookSignature`, D12) against the
  raw request body using the gateway's shared secret (`EDGE_FUNCTION_
  ONLY` env var, never exposed to any client — see `SECURITY_MODEL.md`).
  A request with a missing/invalid signature is rejected before any
  parsing — no partial trust.
- **Request:** raw gateway payload (shape varies by gateway, normalized
  internally via `parseWebhookEvent`, D12).
- **Response:** `{ ok: true }` always on success (gateways expect a fast
  `2xx`; anything else triggers their own retry storm — dossier §14
  failure mode #5).
- **Transaction boundary:** (1) check `webhook_events(gateway,
  gateway_event_id)` UNIQUE — if already present, return `{ ok: true }`
  immediately without touching `payments`/`orders` at all (true no-op
  replay, dossier §9 "webhook handlers are idempotent"). (2) Insert the
  `webhook_events` row, payload redacted at write time (D32). (3) Look up
  `payments` by `gateway_order_ref`; verify the payload's reported amount
  matches `payments.amount` (defense against a gateway payload claiming a
  different amount than what `create_order` set — should be structurally
  impossible given D12's server-computed-amount model, but checked anyway
  since this is the one endpoint an attacker can hit without any Craavee
  auth at all; a mismatch is rejected and raises a Sentry P0 alert rather
  than being accepted). (4) **Branch on the associated order's current
  `orders.status` (new, Phase 1.1, D30):**
  - If `orders.status = 'created'` (the ordinary case): on capture,
    `payments.status = 'captured'`, `payments.gateway_payment_ref` set
    (UNIQUE — dossier guarantee #2), order transition `created →
    confirmed` (both writes, same transaction — §2.1 of `ORDER_STATE_
    MACHINE.md`). On failure, order transition `created → payment_failed`
    (transition #2a), inventory/wallet release.
  - If `orders.status` is already terminal (`payment_failed` or
    `cancelled` — a late capture arriving after an explicit failure, a
    reservation-expiry sweep, or a pre-payment cancellation) **and the
    webhook reports capture:** this is the reconciliation path
    (`ORDER_STATE_MACHINE.md` §2's "not a row in this table" note,
    `PHASE_1_1_CORRECTIONS.md` §8/§9). `orders.status` is **not**
    changed. `payments.status` is set to `'captured'` and, same
    transaction, immediately followed by an internal `refunds` insert
    (`reason='late_capture_reconciliation'`, `actor_id=null`) crediting
    the customer's wallet for the captured amount, landing on
    `payments.status='refunded'`. `audit_logs` entry flagged for review;
    Sentry alert raised (this is rare and worth a human's attention even
    though it's handled automatically and correctly).
  (5) `audit_logs` insert (`actor_id = null`, system-initiated) for the
  ordinary-case branch too, not just the reconciliation branch.
- **Idempotency:** the `webhook_events` UNIQUE check *is* the
  idempotency mechanism — described above, this is dossier guarantee #2
  in full.
- **Errors:** `PAYMENT_FAILED` is not actually returned to the gateway
  (the webhook always acks `{ok:true}` on a *successfully processed*
  event, whether that event represents a captured or failed payment —
  "processed correctly" and "payment succeeded" are different things).
  A malformed/unsigned request gets `403` with no body detail (don't
  hand an attacker a hint about why their forged payload failed).

### `refund`

**Implemented Phase 5** (`supabase/functions/refund/` + `process_refund`,
migration 0005). **Wallet destination only** this phase (D38 — dossier
§18 default; gateway-instrument refunds are a later-phase support tool
needing an adapter interface addition §3 forbids now). One transaction,
no network I/O. A **full** refund of a still-live order (`confirmed` /
`assigned` / `delivery_failed`) also releases the reservation and moves
the order to `cancelled` (D38 — `confirmed + refunded` is not a valid
resting pair, `ORDER_STATE_MACHINE.md` §2.1); a full refund of a
`packed` / `picked_up` / `delivered` order is rejected pending the
post-pack cancellation flow. `gatewayRefunded` is always `0` this phase.

- **Auth:** required, role `admin`.
- **Request:** `{ orderId: uuid, idempotencyKey: uuid, amount?: int /*
  omit for full refund of the remaining captured amount */, reason:
  string }`. `idempotencyKey` is new, Phase 1.1 (D29) — matches `refunds.
  idempotency_key UNIQUE`, so an admin's accidental double-click replays
  the original result instead of issuing a second refund; the same key
  with a **different amount** is a deterministic `ORDER_ALREADY_EXISTS`
  conflict.
- **Response:** `{ refundId: uuid /* refunds.id */, amount: int,
  walletCredited: int, gatewayRefunded: int }`.
- **Transaction boundary:** refund policy — **wallet first, gateway
  only if wallet can't absorb it** is *not* the model; per dossier §18
  ("Refunds to wallet rather than source, when the customer agrees, keep
  money inside the system") the default is wallet credit, but a genuine
  gateway refund path exists for cases requiring money back to the
  original instrument (a policy/support decision per refund, not an
  automatic rule engine — the `amount`/destination choice is the admin's
  call, this function executes it). Checks `amount <= payments.amount -
  payments.refunded_amount` (`refunded_not_above_amount` CHECK is the
  database-level backstop, D29). Writes, all one transaction: `refunds`
  insert (`idempotency_key`, `amount`, `reason`, `actor_id`),
  `payments.refunded_amount += amount`, `payments.status` transition via
  `enforce_payment_transition` (`captured→refunded`,
  `captured→partially_refunded`, or `partially_refunded→refunded`
  depending on whether this tops up to the full `amount`), `wallet_
  ledger` credit (if wallet destination) or gateway refund API call (if
  instrument destination), `audit_logs` insert with `reason`.
- **Idempotency:** `idempotencyKey` UNIQUE on `refunds` (Phase 1.1, D29)
  — a replay with the same key returns the original `refunds` row
  unchanged rather than double-refunding, the same pattern as `create_
  order`'s `idempotencyKey` (D23), now applied here too since "admin
  double-clicks a button" is exactly the same class of retry risk as "a
  customer's client retries a timed-out request."
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN`, `PAYMENT_FAILED` (nothing
  captured to refund), `REFUND_EXCEEDS_CAPTURED` (new — `amount` would
  push `refunded_amount` above `payments.amount`).

### `expire_stale_reservations`

**New, Phase 1.1 (`DECISION_LOG.md` D27).** Not client-callable — invoked
on a schedule (Supabase scheduled Edge Function or `pg_cron`; either is
an acceptable Phase 2/5 implementation choice, not fixed by this spec).

- **Auth:** none — this is a system/service-role job, not a user-facing
  endpoint; it has no `Authorization: Bearer` caller at all.
- **Trigger:** scheduled, every 1 minute.
- **Execution:** `SELECT id FROM orders WHERE status = 'created' AND
  reservation_expires_at < now() FOR UPDATE SKIP LOCKED` (safe under
  overlapping/concurrent runs, same reasoning as D13). For each candidate,
  one transaction: release the inventory reservation for every
  `order_items` row, reverse any wallet debit (`wallet_ledger` credit,
  `reason='reservation_reversal'`), transition `orders.status →
  'payment_failed'` (transition #2b, `ORDER_STATE_MACHINE.md`), set
  `payments.status → 'failed'` (same transaction, per the payment/order
  consistency rule, D30), `audit_logs` insert (`actor_id = null`,
  `action='order.reservation_expired'`).
- **Idempotency:** naturally safe — an order picked up by two overlapping
  sweep runs is protected by `FOR UPDATE SKIP LOCKED` (only one run
  actually processes it) and, redundantly, by `enforce_order_transition`
  rejecting a second `created → payment_failed` attempt on a row that's
  already `payment_failed`.
- **Interaction with a late webhook:** if `payment_webhook` receives a
  capture confirmation for an order this function already expired, see
  `payment_webhook`'s reconciliation-path branch, above — handled there,
  not here.

### `admin_cancel_order` / `admin_reassign`
- **Auth:** required, role `admin`.
- **Request (`admin_cancel_order`):** `{ orderId: uuid, reason: string }`.
- **Request (`admin_reassign`):** `{ orderId: uuid, runnerId?: uuid /*
  runners.id (D28), not a profile id — omit to release to the general
  claim queue instead of a specific runner */ }`.
- Both are thin wrappers around the transitions in `ORDER_STATE_MACHINE.
  md` #6/#9/#13/#14 — same validation/audit discipline as every other
  function, just admin-authorized instead of customer/runner-authorized.

### `validate_promo`
- **Auth:** required, role `customer`.
- **Request:** `{ code: string, orderSubtotal: int }` (called during
  checkout, before `create_order`, so the customer sees the discount
  applied in the UI before committing — the authoritative re-validation
  still happens inside `create_order` itself, this call is a UX
  convenience, not the enforcement point).
- **Response:** `{ valid: boolean, discountAmount?: int, reason?: string
  }`.
- **Errors:** none thrown — invalid states are expressed via `valid:
  false` + `reason`, since "promo doesn't apply" is a normal outcome, not
  an error condition.

### `assign_staff_role`
- **Auth:** required, role `admin`.
- **Request:** `{ profileId: uuid, role: 'packer'|'runner'|'admin',
  storeId?: uuid /* required unless role='admin' */ }`.
- **Response:** `{ profileId: uuid, role: string, storeId: string|null
  }`.
- **Authorization:** the only door into `staff_roles` (RBAC_MATRIX.md
  §5) — checked inside the function against the caller's own `staff_
  roles` row (service role bypasses RLS, so this check is the function's
  own responsibility, not delegable to a policy).
- **Errors:** `AUTH_REQUIRED`, `FORBIDDEN`.

### `settle_runner_earnings`
- **Auth:** required, role `admin`.
- **Request:** `{ runnerId: uuid, upToOrderIds?: uuid[] /* omit to
  settle all currently-unsettled */ }`.
- **Response:** `{ settledCount: int, totalAmount: int }`.
- Sets `settled_at = now()` on the targeted `runner_earnings` rows.
  Dossier §9/§21: "settle runners within 48 hours — the first payout is
  what determines whether they come back," manual export-driven process
  at this scale, this function just marks rows settled after the manual
  transfer happens outside the system.

## 4. Validation layer

Zod schemas live in `packages/validation`, imported by both the calling
client (for instant UX feedback) and the Edge Function itself (the
function's own validation is authoritative — client-side validation is a
UX nicety, never trusted, per the whole spec's governing rule). Three
distinct concerns, kept separate rather than conflated into one big
"is this request okay" check:

1. **Input validation** (Zod schema match — is the JSON shape correct,
   are types right, are strings within length limits). Failure →
   `400` with a Zod-derived `details` field.
2. **Authorization** (does this caller have the role/ownership needed —
   RLS for direct reads/writes, explicit checks at the top of each Edge
   Function otherwise). Failure → `401`/`403`/`404` per §2.
3. **Business invariants** (is there enough stock, is the store open, is
   the wallet balance sufficient — checked inside the transaction, often
   only knowable at that point since they depend on concurrently-
   changing state). Failure → `422` or a specific `409`.

Every Edge Function's implementation checks these in this order — a
malformed request never reaches an authorization check with attacker-
controlled data, and an authorization failure never leaks whether a
business invariant would also have failed.

## 5. Error code catalogue

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | **Added Phase 4.** Request shape failed input validation (the §4 concern-1 code the original table omitted); `details` carries the Zod issue list |
| `INVALID_PROMO` | 422 | **Added Phase 4.** Promo code unknown, not yet active, or expired |
| `PROMO_LIMIT_REACHED` | 422 | **Added Phase 4.** Promo at `max_uses`, or the caller at `per_user_limit` |
| `AUTH_REQUIRED` | 401 | No/invalid JWT |
| `FORBIDDEN` | 403 | Authenticated, but not permitted for this action |
| `INVALID_ADDRESS` | 400 | Address doesn't exist / isn't the caller's |
| `STORE_CLOSED` | 422 | `stores.is_open = false` |
| `SERVICE_UNAVAILABLE` | 422 | Queue depth exceeded (auto-pause) or zone not serviceable |
| `ITEM_UNAVAILABLE` | 422 | Product not listed / not found |
| `INSUFFICIENT_STOCK` | 422 | Reservation would exceed available qty |
| `INSUFFICIENT_BALANCE` | 422 | Requested wallet spend exceeds `wallet_balance` |
| `PAYMENT_FAILED` | 422 | Gateway reported failure |
| `PAYMENT_SETUP_FAILED` | 422 | **New, Phase 1.1.** Phase B/C of `create_order` failed (gateway timeout/error, or a transient DB-write failure after 3 retries) — safe to retry with the same `idempotencyKey`; the order/reservation are untouched |
| `PAYMENT_RECONCILIATION_REQUIRED` | 500 | **New, Phase 1.1.** The rare case where the gateway succeeded but persisting `gateway_order_ref` failed after 3 retries — a Sentry P0 alert is also raised; not client-retryable, needs human reconciliation |
| `PAYMENT_ORDER_STATE_MISMATCH` | 409 | **New, Phase 1.1.** Rejected by the extended `enforce_order_transition` trigger — the attempted write would produce an `(orders.status, payments.status)` pair not in `ORDER_STATE_MACHINE.md` §2.1's valid-combinations table |
| `REFUND_EXCEEDS_CAPTURED` | 422 | **New, Phase 1.1.** `refund`'s requested `amount` would push `payments.refunded_amount` above `payments.amount` |
| `PAYMENT_PENDING` | 202-equivalent (not a real HTTP error; used in polling responses to mean "still waiting on the webhook") | Order `created`, no webhook yet |
| `ORDER_ALREADY_EXISTS` | 200 (idempotent replay) | See `create_order` notes |
| `INVALID_ORDER_TRANSITION` | 409 | Rejected by the state machine trigger |
| `JOB_ALREADY_CLAIMED` | 409 | Lost the claim race |
| `RUNNER_ALREADY_ASSIGNED` | 409 | Runner already has a live job |
| `DELIVERY_CODE_INVALID` | 400 | Hash mismatch |
| `RATE_LIMITED` | 429 | Too many attempts (delivery code, and any future rate-limited action) |

Every code above is what a client branches on; `message` is for logs/
debugging display only, never parsed by client logic (Phase 1 prompt
§7.20: "do not rely on arbitrary human-readable strings as API
contracts").

## 6. Idempotency summary

| Operation | Mechanism |
|---|---|
| `create_order` | Client-generated `idempotencyKey`, `UNIQUE` on `orders`, replay resumes at the correct phase per the resume matrix in §3's `create_order` entry (revised Phase 1.1, D23/D24) — never re-runs Phase A, never re-claims a fresh-enough gateway attempt, never re-creates a gateway intent once `gateway_order_ref` is set |
| `payment_webhook` | `webhook_events(gateway, gateway_event_id)` UNIQUE, replay is a true no-op (§3 above) |
| `refund` | Client-generated `idempotencyKey`, `UNIQUE` on `refunds` (Phase 1.1, D29) — replay returns the original `refunds` row, does not double-refund |
| `expire_stale_reservations` | `FOR UPDATE SKIP LOCKED` over candidates + the order-transition trigger rejecting a repeat `created→payment_failed` on an already-`payment_failed` row (Phase 1.1, D27) |
| `claim_job` | Not idempotent by design — a contest, not a retryable write (§3 above explains the client-side retry discipline instead) |
| Everything else (`mark_*`, `verify_delivery_code`, etc.) | Naturally idempotent-safe by virtue of the state machine — a repeat call after a state change already happened hits `INVALID_ORDER_TRANSITION` rather than double-applying an effect, which is an acceptable (if not silently-successful) outcome for these lower-stakes, staff-initiated actions |
