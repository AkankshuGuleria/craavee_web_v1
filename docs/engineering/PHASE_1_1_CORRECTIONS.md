# Phase 1.1 — Specification Consistency & Correctness Review

Phase 1 produced a specification with three real correctness gaps (payment
flow held a DB transaction across network I/O; wallet and promo
concurrency were hand-waved) and one internal-consistency gap (Edge
Function counting language, runner FK ambiguity). This document records
what was found, what was decided, and exactly what changed in each
canonical document. It is a correction record, not a new parallel spec —
`ENGINEERING_SPECIFICATION.md` and its companions remain the source of
truth; where this document and another disagree after this pass, the
other document (as amended) wins, since this document's edits have
already been applied there.

No code, migration, Edge Function, or Expo scaffold was created in this
phase. `git status` confirms only `docs/` and `.agent-os/` changed.

---

## 1. Issues discovered

1. **`create_order` held a Postgres transaction open across the
   Razorpay/Cashfree network call.** This is a real production hazard —
   a slow or hung gateway call would hold row locks (on `inventory`,
   potentially `profiles` for wallet) for the duration of an
   uncontrolled external HTTP call, directly threatening the six
   correctness guarantees under load, not just being inefficient.
2. **Wallet concurrency was asserted away.** The original `DECISION_LOG.md`
   D10 (renumbered from the original document's wallet entry) stated
   "only one Edge Function invocation touches a given customer's wallet
   at a time in practice" — false in general; two devices signed into
   the same account, or a wallet-funded order racing a promo/referral
   credit landing at the same moment, are ordinary, not exotic,
   scenarios.
3. **Promo concurrency was flagged as an accepted trade-off, not solved.**
   The original `DATABASE_SPEC.md` §11 explicitly noted `per_user_limit >
   1` wasn't concurrency-safe. Left as a "someday" item.
4. **Edge Function counting language was internally contradictory.** The
   spec set inherited "four contended writes" from the dossier (which was
   describing the dossier's own, deliberately minimal MVP scope) while
   Phase 1 had already specified 13 named functions. Never reconciled.
5. **`orders.runner_id` pointed at `profiles`, bypassing the `runners`
   table entirely**, meaning the schema could not, on its own, prevent an
   order from being "assigned" to a profile that had never been onboarded
   as an active runner (no `runners` row at all) — the `staff_roles`
   check would catch this at claim-time in application logic, but the
   foreign key itself provided no such guarantee.
6. **No invariants were specified for the `payments` table** beyond the
   two uniqueness constraints already present — nothing prevented, at the
   schema/trigger level, a captured amount mismatch, a refund exceeding
   the captured amount, or a payment being confirmed against an order
   that had already been cancelled.
7. **No reservation lifetime existed.** Once payment setup is correctly
   moved outside the order-creation transaction (issue 1), an order can
   sit in `created` indefinitely with stock reserved and (per the wallet
   fix, issue 2) wallet debited, with no defined expiry.
8. **No wallet ledger reason distinguished "payment never happened, give
   the money back" from "payment happened, then we refunded it"** — both
   would have used `reason='refund'`, collapsing two different audit
   stories into one.

## 2. Decisions made

Nine new entries added to `DECISION_LOG.md`, D24–D32, each in the
existing DECISION/RATIONALE/ALTERNATIVES REJECTED format and explicitly
marked as Phase 1.1 corrections. Summarized in §§4–9 below; full text is
in `DECISION_LOG.md` and not repeated here.

One recurring architectural pattern was identified and named, because it
now appears three times independently and deserves to be recognized as a
single reusable idiom rather than three coincidentally similar designs:
**cached aggregate + authoritative append-only detail table**, first used
for `profiles.wallet_balance` + `wallet_ledger` (original D10), now also
used for `promos.uses_count` + `promo_redemptions` (D26) and
`payments.refunded_amount` + `refunds` (D29). Naming it here so future
phases recognize the pattern rather than re-deriving it.

## 3. Changes applied (index — detail in §§4–9 and the per-document diffs at the end)

| Document | What changed |
|---|---|
| `DECISION_LOG.md` | +9 entries, D24–D32 |
| `DATABASE_SPEC.md` | `orders.runner_id` FK retargeted to `runners.id`; `orders.reservation_expires_at` added; `payments` table redesigned (1:1 with orders, `refunded_amount`, new columns for claim-based intent creation); new `refunds` table; `promos.uses_count` added, `promo_redemptions` unique-constraint approach replaced with lock-based design; new `wallet_ledger_reason` value `reservation_reversal`; new `enforce_payment_transition` trigger and payment/order consistency backstop trigger specified |
| `RBAC_MATRIX.md` | Runner-scoped RLS policies rewritten against `runners.id` via subquery instead of direct `profiles.id`/`auth.uid()` comparison; `payments`/`refunds` policies updated for the new schema |
| `ORDER_STATE_MACHINE.md` | Transition table updated: `created→payment_failed` now has two triggers (webhook failure, reservation expiry); payment/order consistency table added; payment-state-vs-fulfilment-state separation made explicit |
| `API_CONTRACTS.md` | `create_order` contract fully rewritten (three internal phases, resumable, claim-based gateway intent creation); `refund` updated for the `refunds` table + idempotency key; new `expire_stale_reservations` function; Edge Function list reclassified into four mutation categories + one advisory function; error catalogue extended |
| `SECURITY_MODEL.md` | Audit log write/read policy and webhook payload redaction policy specified (§10, §11 below) |
| `TEST_STRATEGY.md` | 9 new concurrency/consistency test cases added |
| `PHASE_PLAN.md` | Phase 5 scope expanded to reflect the phased payment flow and reservation-expiry sweep; no phase reordering was necessary |
| `ENGINEERING_SPECIFICATION.md` | §6 (payments), §7 (wallet/promo), §21 (final validation) updated to reference the corrected design |

---

## 4. Payment transaction redesign

### 4.1 The three phases

**Phase A — single Postgres transaction, no network I/O:**
1. Authenticate caller, resolve `customer_id`.
2. Idempotency check: `SELECT ... FROM orders WHERE idempotency_key =
   $1`. If found, **skip straight to §4.3 (resume logic)** — Phase A
   never re-runs for an existing order.
3. Validate `addressId` ownership, resolve `zone`, check
   `zones.is_serviceable`.
4. Validate `stores.is_open` and queue depth (`SERVICE_UNAVAILABLE`/
   `STORE_CLOSED` otherwise).
5. **Lock acquisition, in this fixed order (D25 — deadlock prevention):**
   (a) `SELECT wallet_balance FROM profiles WHERE id = customer_id FOR
   UPDATE` — only if `useWallet` is requested; (b) `SELECT * FROM promos
   WHERE code = promoCode FOR UPDATE` — only if `promoCode` is present;
   (c) `SELECT * FROM inventory WHERE (store_id, product_id) IN (...)
   ORDER BY product_id FOR UPDATE` — always, sorted ascending by
   `product_id` so two orders requesting overlapping SKUs never lock them
   in opposite orders. This fixed sequence (wallet → promo → inventory,
   inventory itself always ascending by `product_id`) is followed by
   **every** Edge Function that could take more than one of these locks,
   not just `create_order` — see D25.
6. Compute authoritative prices server-side from the now-locked
   `products`/`inventory` rows — client-supplied prices are never read.
7. Availability check against locked `inventory` rows →
   `INSUFFICIENT_STOCK` if any line fails; increment `qty_reserved`.
8. Promo validation against the locked `promos` row (D26 — full detail
   §6) → apply discount / `INVALID_PROMO`-class rejection.
9. Wallet validation against the locked `profiles` row (D25 — full
   detail §5) → `INSUFFICIENT_BALANCE` if `useWallet` amount exceeds
   `wallet_balance`; debit `wallet_balance`, insert `wallet_ledger` row
   (`reason='checkout_redemption'`).
10. Insert `orders` row: `status='created'`,
    `reservation_expires_at = now() + interval '15 minutes'` (D27).
11. Insert `order_items` rows.
12. Insert **exactly one** `payments` row (D29 — always created, never
    conditionally): if `payable = 0` (wallet fully covered the order),
    `payments.status='captured'`, `gateway=null`,
    `gateway_order_ref=null`, and **`orders.status` is set to
    `'confirmed'` in this same transaction** — a wallet-only order never
    passes through an external gateway step at all, so there is nothing
    for Phase B/C to do and the function returns here. If `payable > 0`,
    `payments.status='pending'`, `gateway` set to whichever adapter is
    configured (D12), `gateway_order_ref=null`,
    `gateway_intent_requested_at=null`.
13. Insert `audit_logs` row.
14. **Commit.** Lock released here — before any network call.

If `payable = 0`, the function returns the confirmed order now. Nothing
below applies.

**Phase B — external gateway call, no Postgres transaction held:**
15. Short transaction (claim, not the main one): `SELECT * FROM payments
    WHERE order_id = $1 FOR UPDATE`; if `gateway_order_ref IS NOT NULL`,
    **another call already succeeded — skip to Phase C's return, don't
    call the gateway again**; if `gateway_intent_requested_at` is set and
    less than 60 seconds old, **another request is currently in flight —
    return `{status: 'payment_setup_in_progress'}` without calling the
    gateway** (the client should poll or retry shortly, not spin up a
    second gateway intent); otherwise set
    `gateway_intent_requested_at = now()` and commit immediately — this
    releases the lock before the network call, while still recording
    that this invocation has claimed the right to attempt it.
16. Call `createPaymentIntent(orderId, payable)` via the gateway adapter
    (D12). No database transaction is open during this call.

**Phase C — short Postgres transaction, persists the result:**
17. On gateway success: `UPDATE payments SET gateway_order_ref = $ref
    WHERE order_id = $1`, commit. Return `{orderId, status: 'created',
    paymentIntent: {gateway, gatewayOrderRef, checkoutParams}}` to the
    client.
18. On gateway failure/timeout: leave `gateway_order_ref` null (the claim
    marker `gateway_intent_requested_at` remains — it will simply go
    stale after 60s and a retry, §4.3, is allowed to reclaim it). Return
    a `PAYMENT_SETUP_FAILED` error to the client — **the order and its
    reservation are not touched**; the client (or the customer tapping
    "retry payment") calls `create_order` again with the **same**
    `idempotencyKey`, which resumes at step 15, not step 1.

### 4.2 Compensation table

| Failure | What happens | Recovery |
|---|---|---|
| Gateway request timeout (step 16) | Phase A already committed; no Phase C write happens; claim marker present but will go stale after 60s | Client retries `create_order` with the same `idempotencyKey` → resumes at step 15; after 60s a *different* retry (or the same one, later) is free to re-claim and re-attempt |
| Gateway request failure (explicit error, step 16) | Same as timeout — no partial state beyond the claim marker | Same retry path |
| Gateway succeeds but client never receives the HTTP response | Step 17 still runs and commits regardless of whether the client is still connected — the write is server-side and unconditional on step 16's success, not on the client receiving anything | Client's next action (retry `create_order` with the same key, or simply open the order/payment status screen) resumes at step 15, sees `gateway_order_ref` already set, returns the existing `checkoutParams` without a second gateway call |
| Database update after gateway success fails (step 17's `UPDATE` itself fails — a genuine DB-layer fault, not a gateway fault) | The function retries the `UPDATE` up to 3 times with short backoff (this is a single-row, single-column write — failure here means a real infrastructure problem, not a business-logic conflict); if all 3 attempts fail, the function returns `PAYMENT_RECONCILIATION_REQUIRED` to the client **and** writes a `Sentry` P0 alert containing the `orderId` and the gateway's own `gatewayOrderRef` (captured in memory from step 16's response even though it failed to persist) so a human can attach it manually. This is the one genuinely rare edge case in this design that ends in a human-reconciliation path rather than a fully automatic one — named explicitly, not hidden behind "handle with retry" |
| Duplicate client retry (any phase) | Idempotency-key lookup (step 2) always finds the existing order; §4.3 defines the exact resume behavior per stage | Never creates a second order, never reserves stock twice, never re-debits wallet |
| Duplicate webhook | `webhook_events(gateway, gateway_event_id)` UNIQUE — unchanged from the original design, still correct under the new phasing | True no-op replay |
| Abandoned payment (customer closes the checkout tab) | `reservation_expires_at` passes with `orders.status` still `'created'` | `expire_stale_reservations` (§4.4/§7) transitions the order to `payment_failed`, releases inventory, reverses wallet debit |
| Reservation expiry | See above | See above — and see §10 for what happens if a webhook for this exact order arrives *after* the sweep has already run |

### 4.3 Idempotency resume matrix (answers the six scenarios in the Phase 1.1 prompt exactly)

| Replay arrives... | `orders` row state | Resume behavior |
|---|---|---|
| **A. Before payment intent exists** | `status='created'`, `payments.gateway_order_ref IS NULL`, `gateway_intent_requested_at IS NULL` | Resume at Phase B step 15 — attempt to claim and create the gateway intent |
| **B. While payment intent creation is in progress** | `status='created'`, `gateway_intent_requested_at` set, < 60s old, `gateway_order_ref IS NULL` | Do **not** call the gateway again — return `{status: 'payment_setup_in_progress'}`, instructing the client to poll/retry shortly |
| **C. After gateway order reference exists** | `status='created'`, `gateway_order_ref IS NOT NULL` | Return the existing order and the **same** `checkoutParams` (reconstructed from the stored `gateway_order_ref` + the gateway adapter's checkout-param builder, which is a pure function of `gatewayOrderRef` + `payable` — no new gateway call) |
| **D. After payment succeeds** | `status='confirmed'`, `payments.status='captured'` | Return the confirmed order, no side effects — a pure idempotent read via the same endpoint |
| **E. After payment fails** | `status='payment_failed'` (terminal) | **Do not resume.** Return the existing (failed) order as-is. A genuinely new attempt requires a **new** `idempotencyKey` — i.e., a new order — because `payment_failed` is terminal (`ORDER_STATE_MACHINE.md` §3, unchanged) and resuming payment setup "in place" on a row the state machine has already closed out would reopen a closed transition, which is exactly the class of bug guarantee #6 exists to prevent |
| **F. After the reservation expires** | `status='payment_failed'` (set by the sweep, §4.4) | Same as E — the sweep's transition is the same terminal state as an explicit gateway failure, so the same "no resume, new key required" rule applies uniformly |

No replay in any of these six states ever: creates a second `orders` row
(idempotency key lookup always finds the original first), reserves stock
twice (Phase A never re-runs once the order exists), spends wallet twice
(same reason), creates a duplicate `payments` row (D29 — exactly one
`payments` row per order, enforced by `UNIQUE(order_id)`), or creates a
duplicate gateway order (the claim marker in step 15 plus the
`gateway_order_ref IS NOT NULL` short-circuit in scenario C together
prevent this).

### 4.4 Reservation lifetime (full detail, referenced above)

- `orders.reservation_expires_at`: set once, at Phase A step 10, to
  `now() + interval '15 minutes'`. Not extended or reset by anything —
  a customer who spends 20 minutes on the gateway's checkout page loses
  the reservation and must place a new order; this is a deliberate,
  simple rule (a moving/extendable expiry is a meaningfully more complex
  mechanism for a benefit — accommodating unusually slow checkouts — that
  doesn't obviously justify the complexity at this stage; revisit only if
  real usage shows 15 minutes is routinely too tight, which is a product/
  tuning observation, not an architecture gap, consistent with how other
  numeric thresholds in this spec set are treated).
- **Cleanup mechanism:** `expire_stale_reservations`, a Postgres function
  invoked on a schedule (Supabase scheduled Edge Function or `pg_cron`,
  either is acceptable — an implementation choice for Phase 2, not fixed
  here) every **1 minute**. It selects candidate orders with `SELECT id
  FROM orders WHERE status = 'created' AND reservation_expires_at < now()
  FOR UPDATE SKIP LOCKED` (this function may itself overlap with a slow
  previous run or, later, run on multiple workers — `SKIP LOCKED` makes
  concurrent/overlapping sweep runs safe by construction, the same
  reasoning as D13's runner-claim locking, not a new locking idea).
- **Per expired order:** release inventory (`qty_reserved -= qty` for
  every `order_items` row), reverse any wallet debit (`wallet_ledger`
  credit, `reason='reservation_reversal'` — the new enum value from
  issue 8/§2 above, deliberately distinct from `'refund'`), transition
  `orders.status → 'payment_failed'` (through the normal state-machine
  trigger, actor recorded as `'system:expire_stale_reservations'`),
  set `payments.status → 'failed'` in the same transaction (§10's
  consistency rule), write `audit_logs`.
- **Late webhook after expiry:** see §10 — the payment/order consistency
  section defines this as the same "captured-for-a-terminal-order"
  reconciliation path used for a late webhook after a pre-payment
  cancellation, not a separate mechanism.
- This section specifies the model only — the scheduled function itself
  is a Phase 2/5 implementation artifact (`PHASE_PLAN.md` update, §9
  below), not built in Phase 1.1.

---

## 5. Wallet concurrency solution

**Exact row locked:** `profiles` (the row identified by `customer_id`),
via `SELECT wallet_balance FROM profiles WHERE id = $1 FOR UPDATE`.

**When:** Phase A step 5(a) of `create_order` (§4.1) — first in the fixed
lock-acquisition order (D25), before the promo lock and before the
inventory locks, so that a transaction which only needs the wallet lock
never waits behind one that also needs inventory locks in a way that
could deadlock against a transaction acquiring them in the reverse order.
The same rule (wallet row locked first, if needed at all) applies to any
other Edge Function that debits/credits a wallet inside a larger
transaction — currently: `create_order` (debit) and `refund` (credit,
locks the same way for symmetry even though a credit-only operation is
less deadlock-prone, for consistency of the rule rather than because a
credit strictly needs it).

**Balance check:** after acquiring the lock, `wallet_balance >=
requested_amount` — evaluated against the *locked* value, not a value
read before the lock (a read-then-lock pattern would reintroduce the
exact race this fixes).

**Debit:** `UPDATE profiles SET wallet_balance = wallet_balance -
requested_amount WHERE id = $1` (still holding the lock from the same
transaction — no separate re-lock needed, Postgres row locks are held for
transaction duration).

**Ledger write:** `INSERT INTO wallet_ledger (customer_id, delta, reason,
order_id) VALUES ($1, -requested_amount, 'checkout_redemption',
$order_id)` — same transaction.

**Rollback:** if any later step in the same Phase A transaction fails
(inventory unavailable, promo invalid), the **entire transaction rolls
back**, including the wallet debit — this is ordinary Postgres
transaction atomicity, not a special-cased compensation mechanism,
which is exactly why the wallet lock/debit/ledger-write happen *inside*
Phase A rather than as a separate step: everything that can be undone by
a plain `ROLLBACK` should be, rather than requiring hand-written
compensation logic.

**Payment failure compensation** (Phase A already committed — wallet
already debited — and the *external* gateway step then fails/times out/
expires): this is not a rollback (the transaction already committed) but
a **reversal**, via the exact mechanism in §4.4 — `expire_stale_
reservations` (or, for an explicit gateway failure reported by the
webhook, the `payment_webhook` handler directly) credits the wallet back
with `reason='reservation_reversal'`, in the same transaction as the
order's `→ payment_failed` transition.

**Cancellation/refund behavior:** unchanged in shape from the original
spec (pre-pack cancellation refunds fully to wallet; post-pack
cancellation is a support action, same refund destination) but now
precisely: if the order never reached `confirmed` (payment never
captured), the wallet reversal uses `reason='reservation_reversal'`; if
the order did reach `confirmed` (payment captured, possibly including a
wallet-applied portion) before being cancelled, the reversal uses
`reason='refund'` and goes through the `refunds` table (§7/D29), which
covers **both** the gateway-captured portion and the wallet-applied
portion of the original order total — a customer who paid partly by
wallet and partly by gateway gets 100% of both portions back to wallet on
a full cancellation, as one `refunds` row with `amount = payments.amount`
(not two separate mechanisms for the two original payment sources).

**Test added:** `TEST_STRATEGY.md` §2.1 (new) — two concurrent
`create_order` calls, same customer, same wallet balance, each requesting
enough wallet spend that only one can succeed; assert exactly one
succeeds, the other gets `INSUFFICIENT_BALANCE`, and `wallet_balance`
never goes negative at any point (checked via a `wallet_ledger`-sum
reconciliation immediately after both calls resolve, not just the final
`profiles.wallet_balance` value, so a bug that briefly under/overcounts
mid-transaction would still be caught).

---

## 6. Promo redemption concurrency solution

**Chosen mechanism: row-lock the `promos` row, serializing all redemption
attempts for that specific code** (not a global lock across all promos —
different promo codes redeem independently, only contention on the
*same* code serializes). This single lock, taken once, correctly solves
both sub-problems:

**`max_uses` (global cap):** `promos.uses_count integer not null default
0` (new column — the "cached aggregate" half of the pattern named in §2).
After `SELECT * FROM promos WHERE code = $1 FOR UPDATE`, check
`uses_count < max_uses` (or `max_uses IS NULL` for unlimited).

**`per_user_limit` (1 or > 1):** because the `promos` row is locked for
the duration of this check, **no other transaction can be concurrently
redeeming this same code** — which means a plain, non-locking `SELECT
count(*) FROM promo_redemptions WHERE promo_id = $1 AND customer_id =
$2` is now safe to trust (the naive version of this check, without the
promo-row lock, is unsafe for exactly the reason a bare `SELECT count(*)`
can't be trusted under concurrency — locking the parent row is what makes
the child-table count query trustworthy). Compare against
`per_user_limit`.

**On success:** `UPDATE promos SET uses_count = uses_count + 1 WHERE id =
$1`; `INSERT INTO promo_redemptions (promo_id, customer_id, order_id)`
(the append-only "ledger" half of the pattern). Both writes happen inside
`create_order`'s Phase A transaction (§4.1 step 8) — the promo lock is
acquired alongside the wallet and inventory locks in the fixed order from
D25, so promo redemption participates in the same atomicity/rollback
guarantees as everything else in Phase A.

**Why not a `UNIQUE(promo_id, customer_id)` constraint instead:**
considered and rejected as the *primary* mechanism (though it remains
implicitly true for `per_user_limit=1` as a side effect of the count
check, it isn't relied upon) — a bare uniqueness constraint only
expresses "at most one," which cannot represent `per_user_limit > 1` at
all, and the Phase 1 spec had already flagged that gap as unresolved. The
row-lock approach handles both cases with one mechanism instead of two,
which is also why it's the better answer than introducing a *second*,
different technique just for the `> 1` case.

**Test added:** `TEST_STRATEGY.md` §2.2 (new) — N concurrent
`create_order` calls (varying `N` across three sub-cases: `max_uses=1`
with 2 different customers concurrently, `per_user_limit=1` with the same
customer submitting 2 concurrent requests, `per_user_limit=3` with the
same customer submitting 5 concurrent requests) — assert redemption count
never exceeds the configured limit in any sub-case, and `uses_count`
always equals the actual `promo_redemptions` row count for that promo
(the same cache/ledger consistency check pattern as the wallet test).

---

## 7. Runner relationship decision

**Adopted the prompt's preferred model:** `orders.runner_id` now
references `runners.id` (not `profiles.id`). `runners.profile_id`
continues to reference `profiles.id`, unchanged.

**Consequence for RLS (`RBAC_MATRIX.md`, updated):** a runner's own-row
checks that used to read `orders.runner_id = auth.uid()` directly now
read `orders.runner_id IN (SELECT id FROM runners WHERE profile_id =
auth.uid())` — one extra join/subquery per policy, accepted as the cost
of a materially better guarantee: it is now **structurally impossible**
for `orders.runner_id` to reference a profile that was never onboarded as
a runner at all (no `runners` row = no valid FK target, full stop, not
merely "the application layer wouldn't do that").

**Consequence for `claim_job` and every other runner-facing function:**
each now resolves the caller's `runners.id` from their `profile_id`
(`auth.uid()`) as its first step, then operates in terms of that
`runners.id`, not the raw `auth.uid()` value.

**Consequence for the partial unique index (D13, unchanged mechanism,
updated target):** `UNIQUE(runner_id) WHERE status IN ('assigned',
'picked_up')` on `orders` now enforces "one live job per **runner row**,"
which is what "one live job per runner" always actually meant — this is
a clarification of intent, not a behavior change.

---

## 8. Payment table invariants

| Invariant | Mechanism |
|---|---|
| One logical payment per order | `payments.order_id UNIQUE` — 1:1 relationship, enforced by database constraint, not application convention (D29) |
| Gateway order reference uniqueness | `UNIQUE(gateway, gateway_order_ref)` — scoped per-gateway in case two gateways' reference formats could theoretically collide as bare strings |
| Gateway payment reference uniqueness | `UNIQUE(gateway, gateway_payment_ref)` — same reasoning, refines the original bare `UNIQUE(gateway_payment_ref)` |
| Captured amount equals expected amount | **Edge Function check**, not a database constraint — `payment_webhook` compares the webhook payload's reported amount against `payments.amount` (set once, at creation, from server-computed `orders.payable`) *before* writing `status='captured'`; a mismatch is rejected and raises a `Sentry` P0 alert rather than being silently accepted. Chosen as an Edge Function check specifically because the comparison is against an *externally supplied* value the database has no independent way to verify — a CHECK constraint can only validate relationships between columns already inside the database |
| Payment cannot be confirmed for a cancelled order without an explicit reconciliation path | The path is: `payment_webhook`, on finding the associated `orders.status` is already a terminal state incompatible with `'confirmed'` (`cancelled`, `payment_failed`), does **not** attempt the `created → confirmed` transition at all — instead it writes `payments.status = 'captured'` (the money was, as a fact, actually captured) and **immediately, same transaction, initiates the internal refund path** (§10) crediting the customer's wallet for the captured amount, writes an `audit_logs` entry tagged for review, and raises a `Sentry` alert. This is the "explicit reconciliation path" the Phase 1.1 prompt asked for, not a vague "handle it somehow" |
| Refund cannot exceed captured amount | `payments.refunded_amount integer not null default 0 check (refunded_amount <= amount)` — the cached half of the cached-aggregate + ledger pattern (§2), checked by a database CHECK constraint, not merely application logic |
| Duplicate refunds are impossible | New `refunds` table (`id`, `payment_id`, `amount`, `reason`, `idempotency_key UNIQUE`, `gateway_refund_ref`, `actor_id`, `created_at`) — the ledger half of the pattern. `refund` (`API_CONTRACTS.md`, updated) now takes an `idempotencyKey`, matching `create_order`'s pattern, so an admin's accidental double-click replays rather than double-refunds |
| Payment state transitions are validated | New trigger `enforce_payment_transition` (`BEFORE UPDATE ON payments`), structured identically to `enforce_order_transition` (`ORDER_STATE_MACHINE.md` §4) — a hard-coded valid-pairs table: `pending→captured`, `pending→failed`, `captured→refunded`, `captured→partially_refunded`, `partially_refunded→refunded`, `partially_refunded→partially_refunded` (topping up, `refunded_amount` strictly increasing only). No `failed→*` transition exists — a failed payment is terminal, matching the order-side rule that a new payment attempt means a new order (§4.3, scenario E) |

---

## 9. Payment/order consistency model

**Payment state** (`payments.status`) answers "has money moved, and how
much." **Fulfilment state** (`orders.status`) answers "where is this
order in the physical/logistics lifecycle." They are deliberately
separate columns in separate tables, kept consistent by a **validating
trigger** (checks, does not itself decide) plus **Edge Functions that
write both together** (decides, then writes) — the same division of
responsibility already used for `orders.status` alone in the original
`ORDER_STATE_MACHINE.md` §4 ("Edge Functions perform business-logic
checks before attempting the UPDATE; the trigger is the last-resort
backstop"), now extended to cover the cross-table pair.

### Valid combinations

| `orders.status` | `payments.status` | Valid? | Notes |
|---|---|---|---|
| `created` | `pending` | ✓ | Normal awaiting-payment state. Gateway-intent sub-progress (`gateway_order_ref`/`gateway_intent_requested_at`) lives entirely in `payments` columns, not reflected in `orders.status` — see §4.1's note that order state stays clean regardless of how far Phase B/C has progressed |
| `created` | `captured` / `failed` | ✗ | Never a resting state — the same transaction that sets `payments.status` to either value also transitions `orders.status` (to `confirmed` or `payment_failed` respectively); the trigger rejects any write that would leave this pair mismatched even transiently within a committed transaction |
| `created` | `refunded` / `partially_refunded` | ✗ | Nothing captured yet to refund |
| `confirmed` | `captured` | ✓ | Normal — payment fully captured, no stock-out yet |
| `confirmed` | `partially_refunded` | ✓ | A stock-out (`mark_stock_out`) discovered and refunded **before** the packer taps "packed" — legitimate, since `mark_stock_out` can be called any time between `confirmed` and the `mark_packed` call |
| `confirmed` | `pending` / `failed` / `refunded` | ✗ | `confirmed` requires a prior successful capture, by construction of the only transition that produces it |
| `packed` / `assigned` / `picked_up` / `delivered` | `captured` | ✓ | Normal fulfilment progression, no stock-out |
| `packed` / `assigned` / `picked_up` / `delivered` | `partially_refunded` | ✓ | A stock-out occurred at some point in the order's life; fulfilment continues for the remaining items |
| `packed` / `assigned` / `picked_up` / `delivered` | `pending` / `failed` / `refunded` | ✗ | Fulfilment cannot proceed past `confirmed` without capture (`pending`/`failed`); `refunded` implies the order should have moved to `cancelled` instead (see below) |
| `payment_failed` | `failed` | ✓ | The ordinary case |
| `payment_failed` | `captured` | **✓, transiently only** | The late-capture reconciliation case (§8's "explicit reconciliation path," also §4.4's "late webhook after expiry") — valid as an intermediate state within the same transaction that immediately initiates a refund; **must not be left as a resting state** — the same transaction that observes this combination is required to also write the `refunds` row and move `payments.status` to `refunded` before committing, so what's actually persisted after commit is `payment_failed` + `refunded`, never `payment_failed` + `captured` sitting still |
| `payment_failed` | `refunded` | ✓ | The settled state after the reconciliation path above completes |
| `payment_failed` | `pending` / `partially_refunded` | ✗ | Contradictory — `payment_failed` implies the payment attempt is fully resolved one way or the other |
| `cancelled` | `failed` | ✓ | Pre-payment cancellation (`created→cancelled`) — the cancel operation sets `payments.status='failed'` in the same transaction, interpreting an abandoned pre-capture payment attempt as failed rather than leaving it `pending` forever, closing the pair deterministically |
| `cancelled` | `refunded` | ✓ | Post-capture cancellation — full refund issued (both any wallet-applied and any gateway-captured portion, via one `refunds` row, §5) |
| `cancelled` | `partially_refunded` | **✓, transiently only** | Same rule as the `payment_failed`+`captured` case — a cancellation on an order that already had a stock-out partial refund must, in the same transaction, top up the refund to full and land on `cancelled`+`refunded`, not rest at `partially_refunded` |
| `cancelled` | `pending` / `captured` | ✗ | A cancelled order's payment must always be resolved to `failed` or `refunded` by the cancelling transaction itself — never left pending or still-captured |
| `delivery_failed` | `captured` / `partially_refunded` | ✓ | Still holding money while an admin decides to reassign or cancel |
| `delivery_failed` | `pending` / `failed` / `refunded` | ✗ | `delivery_failed` only occurs after `picked_up`, which requires prior capture; `refunded` implies the order should have already moved to `cancelled` (transition #14 in `ORDER_STATE_MACHINE.md`) |

**Enforcement:** the `enforce_payment_transition` trigger (§8) validates
`payments.status` transitions in isolation; a second, new trigger-level
check — folded into the existing `enforce_order_transition` trigger
rather than a separate object, since it fires on the same `orders`
`BEFORE UPDATE` event and has access to both `NEW` (the order) and a
lookup of its `payments` row — rejects any `orders.status` write that
would produce a combination not in the table above, raising a new error
code `PAYMENT_ORDER_STATE_MISMATCH` (`API_CONTRACTS.md`, updated). This
is a backstop assertion; the *primary* mechanism is still that every
Edge Function which changes `orders.status` for a payment-relevant
transition writes the matching `payments.status` in the same statement
batch/transaction, per the table's "Notes" column.

**Post-delivery full refund** (a hypothetical goodwill refund after
`delivered`) is explicitly **not modeled** — no transition or
combination above supports `delivered` + `refunded`. Flagged as a
genuine open question in §11, not silently permitted or silently
forbidden by omission.

---

## 10. New tests required

Added to `TEST_STRATEGY.md` §2 (correctness guarantees) and a new §2.1/
§2.2 subsection for the concurrency cases this phase specifically
targets:

1. Two simultaneous wallet-spending `create_order` calls, same customer
   — exactly one succeeds, balance never negative (§5).
2. Two/five simultaneous promo redemptions against `max_uses=1`,
   `per_user_limit=1`, and `per_user_limit=3` respectively — limit never
   exceeded in any case (§6).
3. Gateway timeout immediately after Phase A commits — order remains
   `created`, reservation intact, retry with the same `idempotencyKey`
   successfully resumes at Phase B.
4. Retry after a gateway timeout — asserts exactly one `payments` row
   and exactly one eventual `gateway_order_ref`, never two gateway
   intents created for the same order.
5. Gateway succeeds but the simulated client "disconnects" before
   reading the response — a subsequent call with the same
   `idempotencyKey` returns the same `checkoutParams` without a second
   gateway call (mocked gateway adapter asserts `createPaymentIntent`
   was invoked exactly once).
6. Duplicate payment-setup attempts within the 60-second claim window —
   the second concurrent call receives `payment_setup_in_progress` and
   the gateway adapter is asserted to have been called exactly once.
7. Late webhook after reservation expiry — order already `payment_failed`
   (via the sweep) when a `captured` webhook arrives for it; assert the
   order does **not** revert to `confirmed`, and a `refunds` row is
   created crediting the wallet for the captured amount within the same
   webhook-handling transaction.
8. Duplicate refund request — same `idempotencyKey` on `refund`, assert
   exactly one `refunds` row and `payments.refunded_amount` incremented
   exactly once.
9. Invalid order/payment state combinations — parameterized pgTAP test
   over every ✗ row in §9's table, asserting `PAYMENT_ORDER_STATE_
   MISMATCH` is raised for each.

All nine operate at the database/Edge-Function layer, per the existing
`TEST_STRATEGY.md` discipline (§1/§2 of that document, unchanged) — none
of them are UI tests.

---

## 11. Remaining genuine open decisions

Carried forward/added, not resolved here:

- **Post-delivery goodwill refund** (§9) — no mechanism specified; if the
  founder wants this as a support capability, it needs its own state-
  combination entry and transition, deliberately deferred rather than
  guessed at.
- **Reservation expiry duration (15 minutes)** — an engineering default,
  not a measured or product-specified value; explicitly flagged as
  tunable in §4.4, same treatment as other numeric thresholds already
  deferred in the original `DECISION_LOG.md`.
- **Scheduling mechanism for `expire_stale_reservations`** (`pg_cron` vs.
  a Supabase scheduled Edge Function) — left as an implementation choice
  for whoever builds Phase 2/5, since both are mechanically equivalent
  for this document's purposes and the choice doesn't affect the
  specification above.
- Everything already listed as deferred in the original `DECISION_LOG.md`
  and `ENGINEERING_SPECIFICATION.md` §21-L remains deferred, unchanged by
  this phase (runner earnings formula, referral credit economics, OTP
  rate-limit tuning, auto-pause threshold value).

None of the above blocks Phase 2 from starting.
