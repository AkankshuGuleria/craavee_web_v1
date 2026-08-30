# Phase 6 — Store Fulfilment Implementation Report

Turns confirmed orders into packed orders through the real Store/Packer
surface. Migration `0006`, two Edge Functions, the live packer queue, and
the fulfilment test suite.

Baseline at start: `main` = `fbb9f31`, Phases 0–5 integrated.

---

## 1. What was built

| Layer | Delivered |
| --- | --- |
| Schema | `0006_store_fulfilment.sql` — `order_items.stock_out_at`/`stock_out_by`, the packer-queue index, `staff_scope()`, `assert_fulfilment_actor()`, `process_mark_packed()`, `process_stock_out()` |
| Edge Functions | `mark_packed`, `mark_stock_out` |
| Store app | server-side staff gate, phone-OTP sign-in, not-authorized state, live queue, order detail, packing controls |
| Tests | pgTAP `13` (57 assertions), `fulfilment.integration.test.ts` (17 tests) |

## 2. The guarantee

> Only an authorized packer or admin can cause a valid confirmed order to
> become packed, and the inventory and refund side effects happen exactly
> once.

Held by three independent layers:

1. **RLS.** Every Store query runs as the signed-in user through the anon
   key. `orders_select` (migration `0003`) already scopes a packer to
   `auth_store_id()` and to `confirmed`/`packed`. The queue writes **no**
   `store_id` filter deliberately — if the page forgot one, RLS still
   returns nothing from another store.
2. **The Edge Function**, which refuses a non-staff caller before
   touching the database.
3. **The database function**, which resolves the actor's role and store
   from `staff_roles` *itself*, from a profile id alone. Neither a
   browser nor a buggy Edge Function can assert a role or a store.

The state-machine trigger remains the last-resort backstop: it validates
`confirmed → packed`, checks the `(orders.status, payments.status)` pair,
and stamps `packed_at` server-side.

## 3. Reservation consumption

`mark_packed` consumes rather than releases: `qty_reserved -= n` **and**
`qty_on_hand -= n`. The units leave the shelf, they are not merely
un-reserved — a release would leave phantom stock behind.

Lines are processed in ascending `product_id`, the same inventory lock
sequence `create_order_phase_a` uses (D25), so a packing transaction and
an order-creation transaction cannot deadlock against each other. No
network I/O inside the transaction.

## 4. Stock-out semantics

A fulfilment event, not a status change. The order stays `confirmed` and
continues toward `packed` with its remaining lines. No `stock_out` order
status exists and none was added.

**Money.** The removed value is derived server-side from the stored
`order_items.unit_price`; the request carries a *count*, never an amount.
There is no `refundAmount` field and adding one would be a defect.

```
orders.subtotal       -= X
orders.payable        -= min(X, payable)
orders.wallet_applied -= X - min(X, payable)
wallet credited       += X
```

Taking the reduction off `payable` first and `wallet_applied` second is
what keeps `payable_matches_math`, `payable >= 0` and
`wallet_not_above_total` all true. Historical `unit_price` and ordered
`qty` are never rewritten.

**Why it does not call `process_refund`.** That function's full-refund
branch cancels the order and releases every reservation (`0005` step 7).
An order can have its entire *gateway* share refunded while other lines
are still fulfillable — the rest having been wallet-funded — and
cancelling it would contradict "the order continues toward packed". The
refund is therefore issued against the same architecture (the `refunds`
table and its UNIQUE `idempotency_key`, `payments.refunded_amount`
through `enforce_payment_transition`, `wallet_ledger` reason `'refund'`)
without that branch.

**`delist`.** Defaults to true for a total miss. When false, the only
inventory effect is the reservation release — deliberately *not* a shelf
recount, because `availableQty` is how many units this one order could be
filled with, not how many exist in the store. Writing it into
`inventory.qty_on_hand` would destroy stock reserved by other open
orders.

## 5. Idempotency

| Operation | Guard | Repeat behaviour |
| --- | --- | --- |
| `mark_packed` | order status + row lock | 200 with `alreadyPacked: true` |
| `mark_stock_out` | `order_items.stock_out_at` + row lock | 200 with `alreadyStockedOut: true`, `refundAmount: 0` |

Both return success rather than an error on replay, so a double tap in a
busy store is harmless. Concurrent duplicates serialize on the row locks;
integration tests fire three genuinely parallel requests at each and
assert exactly one performed the effect.

## 6. What the packer can see

Lines, quantities, and what is outstanding. **Not** the customer's
identity, address, wallet ledger, payment record, or any gateway payload.
`addresses` is customer-or-admin in `0003` and this phase does not widen
it — the packer is assembling a bag, not delivering it. Delivery detail
belongs to Phase 7's runner surface.

## 7. Verification

| Check | Result |
| --- | --- |
| `supabase db reset` | `0001` → `0006` in order + seed |
| pgTAP | **371/371**, 14 files (314 prior + 57 new) |
| Integration | **100/100** (83 prior + 17 new) |
| `functions:check` | 7 functions + dev server |
| `functions:test` | **8/8** gateway safety |
| Unit | **44/44** |
| typecheck / lint | clean / 0 errors, 2 pre-existing warnings |
| Store + Console builds | pass |

### Performance (§26)

500 confirmed orders, 3 lines each:

| Operation | Latency |
| --- | --- |
| Queue query (limit 50) | **0.272 ms** — Index Scan on `orders_store_status_placed_idx` |
| Order detail | **0.322 ms** |
| `mark_packed` | **0.555 ms** avg over 10 runs |
| `mark_stock_out` | **1.960 ms** avg over 10 runs |

One index added, justified by the queue's access pattern and confirmed in
use by the plan. No Redis.

## 8. Queue freshness

Revalidation, not Realtime. A staff queue with a handful of concurrent
viewers does not justify a subscription, and the full Realtime
architecture is Phase 8's — building a partial one here would only have
to be unpicked. No customer-scale subscription was created.

## 9. Carried forward, not resolved

- **Razorpay** is still unverified against a live sandbox. Unchanged by
  this phase; runbook in `PHASE_5_IMPLEMENTATION_REPORT.md` §14.
- **The ACL/default-privilege finding** (`CI_CHECKPOINT_REPORT.md` §8.1)
  stands, and the `supabase/setup-cli` pin at `2.113.0` remains
  load-bearing. Note that `0006` follows the *good* pattern: both new
  functions are explicitly `REVOKE`d from `public, anon, authenticated`
  and granted only to `service_role`, asserted by pgTAP.
- **Error codes.** `ORDER_NOT_FOUND` and `ALREADY_FULFILLED` are not in
  the canonical `ERROR_CODES` set, so this phase reuses the existing
  vocabulary rather than widening a shared contract: a missing order is
  `VALIDATION_FAILED` (matching `process_refund`), and a repeat is a
  success with an `already*` flag rather than an error.

## 10. Not implemented

Runner claim, runner UI, pickup, delivery, delivery codes, customer push
notifications, the full Realtime implementation, admin dashboard
expansion, analytics, Redis, routing optimization. Phase 7 owns runner
operations.
