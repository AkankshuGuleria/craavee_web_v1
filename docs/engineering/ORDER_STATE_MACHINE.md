# Order State Machine

Baseline per dossier §8/§13: `created → confirmed → packed → assigned →
picked_up → delivered`, plus `payment_failed`, `cancelled`,
`delivery_failed`. This document is the canonical transition table — the
`BEFORE UPDATE` trigger in Phase 2 is a direct translation of §2 below, not
a reinterpretation of it.

**Revised Phase 1.1:** the payment transaction redesign (`DECISION_LOG.md`
D24, full detail `PHASE_1_1_CORRECTIONS.md` §4) changed *how* a payment
succeeds or fails but not the fulfilment states themselves — no new
`order_status` value was added. What changed is that `created→payment_
failed` now has a second trigger (reservation expiry, not just an
explicit gateway failure — row 2 in §2 below) and that `orders.status`
and `payments.status` now have a documented, enforced relationship — see
the new §2.1.

**Explicit separation, per Phase 1 prompt §7.6:** claiming/assigning a job
(`packed → assigned`, a runner has tapped "claim" but not yet physically
touched the bag) is a distinct transition from physically picking it up
(`assigned → picked_up`, the runner has the bag and is en route). No
transition skips `assigned` to go straight to `picked_up`.

## 1. States

| State | Meaning | Terminal? |
|---|---|---|
| `created` | Order row exists, payment not yet confirmed | No |
| `confirmed` | Payment captured, order is real, not yet in the pack queue's "being worked" state | No |
| `packed` | Packer has assembled the bag; claimable by runners | No |
| `assigned` | A runner has claimed the job; bag not yet physically taken | No |
| `picked_up` | Runner has the bag, en route | No |
| `delivered` | Delivery code verified, order complete | **Yes** |
| `payment_failed` | Payment did not capture | **Yes** |
| `cancelled` | Order cancelled (customer self-serve pre-pack, or admin/support action post-pack) | **Yes** |
| `delivery_failed` | Runner could not complete delivery (customer unreachable, wrong info, etc.) | No — admin-actionable, see §2 |

## 2. Transition table

| # | From | To | Actor | Trigger / condition | Timestamp written | Inventory effect | Wallet/payment effect | Notification | Audit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `created` | `confirmed` | System (`payment_webhook`, or synchronously inside `create_order` Phase A for a fully wallet-covered order — `PHASE_1_1_CORRECTIONS.md` §4.1 step 12) | Gateway webhook confirms capture, signature verified — or `payable=0` at order creation | `confirmed_at` | none (already reserved at `create_order`) | `payments.status = 'captured'` (same transaction) | "Order confirmed" push | `order.confirmed` |
| 2a | `created` | `payment_failed` | System (`payment_webhook`) | Gateway webhook reports failure | — | **release reservation** | `payments.status = 'failed'` (same transaction, via `enforce_payment_transition`) | "Payment failed, try again" push | `order.payment_failed` |
| 2b | `created` | `payment_failed` | System (`expire_stale_reservations`, scheduled — **new Phase 1.1**, D27) | `reservation_expires_at < now()` and no capture occurred | — | **release reservation** | `payments.status = 'failed'`; wallet debit (if any) reversed via `wallet_ledger` credit, `reason='reservation_reversal'` (**not** `'refund'` — D27) | "Payment window expired, try again" push | `order.payment_failed`, actor = `system:expire_stale_reservations` |
| 3 | `created` | `cancelled` | Customer (`cancel_order` EF) | Customer cancels before payment confirms (abandons checkout) | `cancelled_at`, `cancel_reason='customer_abandoned'` | release reservation | `payments.status = 'failed'` (same transaction — Phase 1.1: a pre-payment cancel always resolves `payments.status` deterministically, never leaves it `pending`); wallet debit (if any) reversed, `reason='reservation_reversal'` | none | `order.cancelled` |
| 4 | `confirmed` | `packed` | Packer (`mark_packed` EF) | Packer taps "Packed" with all items available | `packed_at` | **consume reservation**: `qty_reserved -= qty`, `qty_on_hand -= qty` for every fully-fulfilled line | none (payment already `captured`; may be `partially_refunded` already if `mark_stock_out` ran first — §2.1) | "Order packed, on its way to pickup" push | `order.packed` |
| 5 | `confirmed` | `cancelled` | Customer (`cancel_order` EF) | Customer cancels, order not yet packed — dossier §8: free cancellation window | `cancelled_at`, `cancel_reason='customer_cancelled'` | release reservation | **full refund to wallet**, via the `refunds` table (D29) — `payments.status → 'refunded'` (same transaction) | "Order cancelled, refunded to wallet" push | `order.cancelled` |
| 6 | `confirmed` | `cancelled` | Admin (`admin_cancel_order` EF) | Operational cancellation before packing (e.g. store closing early) | same as #5 | release reservation | full refund via `refunds` table, `payments.status → 'refunded'` | push | `order.cancelled`, actor = admin |
| 7 | `packed` | `assigned` | Runner (`claim_job` EF) | Runner taps "claim" on a claimable order at their store; caller's `runners.id` resolved from `profile_id` first (D28) | `assigned_at` | none | none | "Runner assigned" push; delivery code becomes readable to customer (D14) | `order.assigned` |
| 8 | `assigned` | `packed` | Runner (`release_job` EF) or System (timeout) | Runner releases (phone dying, changed mind) or a scheduled check releases a stale `assigned` order after N minutes with no `picked_up` | `assigned_at` cleared (set null), `runner_id` cleared | none | none | "Looking for a new runner" push (only if the delay is customer-visible) | `order.released` |
| 9 | `assigned` | `cancelled` | Admin (`admin_cancel_order` EF) | Support-action cancellation post-pack — dossier §8: "after packing, cancellation is a support action" | `cancelled_at`, `cancel_reason` required (free text, admin-entered) | release + **discard already-packed stock is an operational, not database, decision** — the reservation was already consumed at `mark_packed` (#4), so this transition does NOT restore `qty_on_hand` automatically; a physical restock is a separate `admin` inventory correction if the bag is actually put back on the shelf | full refund via `refunds` table (tops up to full if a stock-out partial refund already happened — §2.1), `payments.status → 'refunded'` | push | `order.cancelled`, actor = admin, reason logged |
| 10 | `assigned` | `picked_up` | Runner (`mark_picked_up` EF) | Runner confirms physical pickup at the store | `picked_up_at` | none | none | none (customer already knows a runner is assigned; pickup itself isn't a distinct customer-facing milestone worth a push, though it does update the poll response) | `order.picked_up` |
| 11 | `picked_up` | `delivered` | Runner (`verify_delivery_code` EF) | 4-digit code matches (D14) | `delivered_at` | none | **runner earnings row created** (`runner_earnings` insert, unsettled) | "Delivered! Enjoy" push | `order.delivered` |
| 12 | `picked_up` | `delivery_failed` | Runner (`mark_delivery_failed` EF) or Admin | Customer unreachable, wrong address discovered, safety issue, etc. — reason required | — | none | none yet (see #13/#14 for resolution) | "We couldn't deliver your order, support will reach out" push | `order.delivery_failed`, reason logged |
| 13 | `delivery_failed` | `assigned` | Admin (`admin_reassign` EF) | Admin decides the order should be re-attempted, releases back to the claim queue (or reassigns directly to a specific runner) | `assigned_at` updated, `runner_id` set (resolved to a `runners.id`, D28) | none | none | "Your order is on its way again" push | `order.reassigned` |
| 14 | `delivery_failed` | `cancelled` | Admin (`admin_cancel_order` EF) | Admin decides delivery genuinely cannot complete | `cancelled_at`, `cancel_reason` | none (stock already consumed at pack time, per #9's note) | full refund via `refunds` table, `payments.status → 'refunded'` | push | `order.cancelled` |

**Not a row in this table, because `orders.status` does not change:**
a webhook confirming capture for an order that has already reached a
terminal state (`payment_failed` or `cancelled`) does not re-enter this
table at all — `orders.status` stays exactly where it is. Only
`payments.status` moves (transiently to `'captured'`, then, same
transaction, to `'refunded'` via an internal reconciliation refund). Full
mechanism: §2.1 below and `PHASE_1_1_CORRECTIONS.md` §8/§9 (D30).

## 2.1 Payment state vs. fulfilment state (new, Phase 1.1 — D30)

**`payments.status` answers "has money moved, and how much."**
**`orders.status` answers "where is this order in the physical/logistics
lifecycle."** They are separate columns in separate tables, on purpose —
collapsing them into one combined enum would make the state space grow
combinatorially and make each dimension harder to reason about on its
own (`DECISION_LOG.md` D30's rejected-alternatives note). They are kept
consistent by two complementary mechanisms, not one:

1. **Primary: Edge Functions write both together.** Every transition in
   §2 above that has a payment-side effect (the "Wallet/payment effect"
   column) writes `orders.status` and `payments.status` in the same
   transaction — there is no transition in this spec where one is
   updated without the other being considered.
2. **Backstop: a validating trigger.** `enforce_order_transition` (§4) is
   extended to check that the resulting `(orders.status, payments.status)`
   pair is one of the valid combinations below, raising
   `PAYMENT_ORDER_STATE_MISMATCH` if not — catching a bug in an Edge
   Function that updates one but not the other, the same "trigger as
   last-resort backstop, not primary mechanism" pattern §4 already uses
   for `orders.status` transitions alone.

**Valid `(orders.status, payments.status)` combinations** (condensed —
full table with every explicitly-rejected combination and its reasoning:
`PHASE_1_1_CORRECTIONS.md` §9):

| `orders.status` | Valid `payments.status` value(s) |
|---|---|
| `created` | `pending` only |
| `confirmed` | `captured`, or `partially_refunded` (a stock-out refund landed before packing) |
| `packed` / `assigned` / `picked_up` / `delivered` | `captured`, or `partially_refunded` |
| `payment_failed` | `failed`, or `refunded` (settled state after a late-capture reconciliation, §2's "not a row" note) |
| `cancelled` | `failed` (pre-payment cancel) or `refunded` (post-payment cancel) — never `pending`, `captured`, or left resting at `partially_refunded` |
| `delivery_failed` | `captured`, or `partially_refunded` |

Every combination not listed for a given `orders.status` is rejected by
the trigger. Notably: `created`+`captured`, `created`+`failed`,
`confirmed`+`pending`, and `cancelled`+`captured` are all impossible as
*resting* states — each is, at most, a transient value inside a single
transaction that always resolves to a listed combination before commit.

### Stock-out is not a state transition

A packer discovering a missing item during packing (Phase 1 prompt §7.13,
§7.2 "stock-out handling") does **not** move the order to a new
`order_status`. It's a `mark_stock_out(order_id, order_item_id)` Edge
Function that: delists the product (`products.is_listed = false`, or
zeroes `inventory.qty_on_hand` if it's a temporary shortage vs. a
permanent delist — an operational judgment call the packer/admin makes,
both mechanically identical to the schema), sets that `order_items`
row's `fulfilled_qty` to whatever was actually available (0 for a
complete miss), reduces `orders.payable` by the unfulfilled line's value,
writes a `wallet_ledger` refund for the difference, and lets the order
continue toward `packed` with the remaining items. The runner only ever
sees the final, already-reconciled state — never a "this order had a
problem" flag, per the Phase 1 prompt's explicit instruction ("runner
only sees the final fulfilment state").

## 3. Explicitly invalid transitions (a non-exhaustive but representative sample the trigger must reject)

| Attempted | Why rejected |
|---|---|
| `created → delivered` | Skips payment confirmation and the entire fulfilment chain |
| `created → picked_up` | Same |
| `packed → picked_up` | Skips the claim step — dossier's explicit "assigning ≠ picking up" separation |
| `delivered → *` (any) | `delivered` is terminal; no further mutation of a completed order's status |
| `cancelled → *` (any) | Terminal |
| `payment_failed → confirmed` | A failed payment doesn't retroactively become captured; the customer must place a new order (a new `idempotency_key`, a new row) — reusing a `payment_failed` row would conflict with the idempotency model in D23 |
| `assigned → delivered` | Skips `picked_up` |
| Any transition initiated by a `customer`-role actor other than #3/#5 (cancel) | Customers have no other write path to `orders.status` at all — enforced by RLS (no direct `UPDATE` policy, `RBAC_MATRIX.md` §5) *and* redundantly by the trigger checking the actor's role against the attempted transition, so even a service-role bug in one Edge Function can't silently grant a customer packer/runner/admin powers |
| Any transition where `store_id` of the actor's `staff_roles` row doesn't match `orders.store_id` | Cross-store action — rejected regardless of role |
| Any transition resulting in a `(orders.status, payments.status)` pair not listed in §2.1's table (**new, Phase 1.1**) | E.g. an attempt to move `orders.status → 'confirmed'` while `payments.status` is still `'pending'` — rejected with `PAYMENT_ORDER_STATE_MISMATCH`, not `INVALID_ORDER_TRANSITION` (a distinct error code, since the `(from,to)` pair for `orders.status` alone might otherwise be legal — it's the *combination* with payment state that's wrong) |
| Runner-actor transitions where `orders.runner_id` does not resolve to the caller's own `runners.id` (**new, Phase 1.1**, D28) | Even a technically-legal `(from,to,role)` triple is rejected if the specific `runners.id` doesn't match — prevents one runner from acting on another runner's assigned order even if somehow authenticated with the correct role |

## 4. Database enforcement mechanism

A single `BEFORE UPDATE ON orders FOR EACH ROW` trigger,
`enforce_order_transition()`, is the sole place transition legality is
decided. It:

1. Returns early (allows the update) if `OLD.status = NEW.status` (a
   non-status-changing update, e.g. `runner_id` being set in the same
   statement as `status = 'assigned'`, is validated as a single combined
   check, not two).
2. Looks up `(OLD.status, NEW.status)` in a `VALUES`-list matching table
   1:1 with §2 above — anything not in that list raises an exception
   (`INVALID_ORDER_TRANSITION`, see `API_CONTRACTS.md` §Error catalogue).
3. Checks the calling role (via `auth.jwt()`) against the "Actor" column
   for that specific transition — even a technically-valid `(from, to)`
   pair is rejected if attempted by the wrong role.
4. Stamps the relevant timestamp column automatically (server-side,
   never client-supplied) — the trigger sets `NEW.packed_at = now()` etc.
   itself; Edge Functions never write these columns directly, both so
   the timestamp is trustworthy and so there's exactly one place that
   knows "which column goes with which transition."

This is deliberately a single trigger function, not one trigger per
concern, so that dossier guarantee #6 ("no illegal order transitions")
has exactly one code path to audit and test, matching `TEST_STRATEGY.md`'s
correctness-guarantee test plan.

Edge Functions still perform their own business-logic checks (inventory
availability, wallet balance, delivery code match) *before* attempting
the `UPDATE` — the trigger is the last-resort backstop that makes the
guarantee true even if an Edge Function has a bug, not the only check.

**Extended Phase 1.1 (D30):** the same trigger also performs step 3a —
after confirming the `(from,to)` pair and actor role are legal, it looks
up the order's `payments.status` and confirms the resulting pair is in
§2.1's valid-combinations table, raising `PAYMENT_ORDER_STATE_MISMATCH`
if not. This is one additional check inside the same trigger function,
not a second trigger object — kept together deliberately, since both
checks exist for the same reason (a single, auditable place where
"is this write allowed" is decided) and a transition that's individually
legal but produces an invalid payment pairing is just as much a guarantee
#6 violation as a structurally invalid `(from,to)` pair would be.
