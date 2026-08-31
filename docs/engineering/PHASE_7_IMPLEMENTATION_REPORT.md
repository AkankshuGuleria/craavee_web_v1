# Phase 7 — Runner + Last-Mile Delivery

Completes the operational loop: `packed → assigned → picked_up →
delivered`, plus release and admin reassignment.

Base: `main` = `fbce1de`. Branch: `feat/runner-delivery`.

**Craavee now delivers.** The full runner flow — sign in, see the queue,
claim, pick up, verify a delivery code, mark delivered — was exercised
end to end on `Craavee_iPhone17`, `Craavee_Pixel7_API36` and web, against
the real database and the real Edge Functions.

---

## 1. Runner architecture

The runner is an operational actor, and the client is untrusted. Every
runner request carries **an order id and nothing else**: no `runnerId`,
no `role`, no `storeId`. There is no such field to spoof, because the
schemas do not define one.

Identity resolution, in order:

```
JWT  ->  auth.uid()  ->  staff_roles(role, store_id)  ->  runners.id
```

`orders.runner_id` references `runners.id`, never `profiles.id` (D28), so
`assert_runner_actor()` resolves that mapping itself, inside the
transaction, against a locked order row. An Edge Function checks the role
too, but only to return a cheap 403 without touching the database — the
check that holds is the one in the database function.

Three layers, in decreasing order of trust:

| Layer | What it decides | Trusted? |
| --- | --- | --- |
| Runner app | what to render | no |
| Edge Function | shape, auth envelope, canonical errors | partially |
| `process_*` + trigger + constraints | everything that matters | **yes** |

## 2. Claim flow

`claim_job` implements D13's mechanism exactly.

1. Read the order's store **without locking**, so an unauthorized caller
   is rejected before any lock is taken.
2. `assert_runner_actor` — role, store scope, and the resolved
   `runners.id`.
3. The runner must be online (`runners.is_online`). RBAC_MATRIX.md §5
   gives a runner update rights on their own online flag precisely so it
   can be an authorization input rather than a UI decoration.
4. Reject if this runner already holds an `assigned`/`picked_up` order →
   `RUNNER_ALREADY_ASSIGNED`.
5. `SELECT ... FOR UPDATE SKIP LOCKED` on the order **where status =
   'packed'**. No row returned means either another claim holds the lock
   right now or the order moved on — both are the same thing to the
   caller: `JOB_ALREADY_CLAIMED`, immediately, no waiting. Concurrent
   claims are interchangeable; a runner who loses should try the next job
   instantly, not block.
6. Mint the delivery code, transition to `assigned`, audit.

Three independent defences against a double assignment: the skip-locked
race, the explicit no-live-job check, and
`idx_orders_one_live_job_per_runner` — the partial unique index from
0001, which holds even if both application checks have a bug. Proven
directly in pgTAP: a raw `UPDATE` attempting to give a runner a second
live job raises `23505`.

Deliberately **not idempotent** (API_CONTRACTS.md §6): claiming is a
contest, not a retryable write.

## 3. Pickup flow

`mark_picked_up`: `assigned → picked_up`, assigned runner or admin.

Having the `runner` role is not enough — the caller's resolved
`runners.id` must equal `orders.runner_id`. A repeat call returns
`{alreadyPickedUp: true}` rather than an error: a phone in a pocket taps
twice, and that should not be a failure.

## 4. Delivery verification

`verify_delivery_code`: `picked_up → delivered`, assigned runner only.

Order of operations, exactly as API_CONTRACTS.md specifies:

1. authorize (before anything, so an unauthorized caller can neither burn
   another order's attempt budget nor learn its state)
2. count `rate_limit_events` for this order in the last 15 minutes; ≥5 →
   `RATE_LIMITED` **regardless of whether the code is correct**
3. write the attempt row **before** comparing
4. compare `extensions.crypt(guess, delivery_code_hash)`
5. on match: `delivered`, `runner_earnings` insert, delete the plaintext
   code, audit — one transaction

On mismatch: no state change, `DELIVERY_CODE_INVALID`, attempt still
logged.

### The bug the tests caught

The first implementation wrote the attempt row and then **raised** for a
wrong code. A `raise` aborts the transaction, which rolls the attempt row
back with it — so a wrong guess cost an attacker nothing and the
5-attempt ceiling never engaged. On a 4-digit code that ceiling *is* the
protection; 10,000 guesses is trivially scriptable without it.

`RATE_LIMITED` and `DELIVERY_CODE_INVALID` are now **returned** rather
than raised, so the attempt log commits, and the Edge Function maps the
returned value onto the same canonical error. The API contract is
unchanged. State-machine and authorization failures still raise, because
those must not commit anything.

Verified on device: three attempts (two wrong, one correct) all appear in
`rate_limit_events`.

## 5. Release behaviour

`release_job`: `assigned → packed`, own job or admin.
`enforce_order_transition` clears `runner_id` and `assigned_at` itself
(0002 §181-184), so the function does not write them. The delivery code
is destroyed and the hash nulled, so a released runner cannot complete a
delivery they gave up.

**Scope boundary, reported rather than papered over:** this is
`assigned → packed` only. `picked_up` has no legal path back to `packed`
— once the runner physically holds the bag, ORDER_STATE_MACHINE.md's only
exits are `delivered` and `delivery_failed`. A runner who has picked up
and *cannot* deliver therefore has no resolution path, because
`mark_delivery_failed` is outside Phase 7's scope (§2). See §20.

## 6. Reassignment behaviour

`admin_reassign`, admin only, three shapes:

| Shape | Transition | Notes |
| --- | --- | --- |
| runner named, order `assigned` | `assigned → assigned` | a runner swap; **not** a status change |
| runner named, order `delivery_failed` | `delivery_failed → assigned` | row #13 |
| runner omitted | `assigned → packed` | back to the general queue |

The swap deserves attention: because `orders.status` does not change,
`enforce_order_transition` returns early (0002 §125) and validates
**nothing**. Every check that matters therefore lives in
`process_admin_reassign` — admin role, target runner exists, target is at
this order's store, target has no live job — with the partial unique
index as the backstop if a concurrent claim slips between check and
write. `assigned_at` is re-stamped by hand for the same reason.

A fresh delivery code is minted on every reassignment, so the replaced
runner cannot complete a delivery they no longer own. Proven in the
integration suite: the pre-reassignment code returns
`DELIVERY_CODE_INVALID` afterwards.

## 7. State-machine mapping

No new `order_status` and **no new transition rule** — all five
transitions already existed in `order_transition_rules` (0002 §102-110).

| # | From | To | Function |
| --- | --- | --- | --- |
| 7 | `packed` | `assigned` | `claim_job` |
| 8 | `assigned` | `packed` | `release_job`, `admin_reassign` (no runner) |
| 10 | `assigned` | `picked_up` | `mark_picked_up` |
| 11 | `picked_up` | `delivered` | `verify_delivery_code` |
| 13 | `delivery_failed` | `assigned` | `admin_reassign` |

Illegal transitions are rejected by the trigger, not by the app:
`packed → picked_up`, `assigned → delivered`, and anything out of
`delivered` all fail — verified in both suites.

## 8. Concurrency guarantees

Every race below uses `Promise.all` against separate JWTs, so the
requests are genuinely in flight together. A sequential loop would prove
nothing about `SKIP LOCKED`.

| Brief | Guarantee | Result |
| --- | --- | --- |
| §19.A | two runners claim one order | exactly one wins; the loser gets a canonical already-claimed error |
| §19.B | one runner claims two orders | exactly one succeeds; the DB shows exactly one live job |
| §19.C | claim races admin reassign | final status always legal; no runner ever holds two live jobs |
| §19.D | duplicate `mark_picked_up` | both safe; exactly one reports a replay |
| §19.E | duplicate verification | safe |
| §19.F | concurrent verifications | exactly one terminal transition, exactly one earnings row |

`runner_earnings.order_id` is UNIQUE, so double-crediting a delivery is
structurally impossible, not merely unlikely.

## 9. RLS and security

Unchanged and already correct for the queue: `orders_select` (0003)
restricts a runner to `status = 'packed'` at their own store plus their
own assignment, so a tampered client cannot widen the queue.

One policy added — `addresses_select_runner_active`. RBAC_MATRIX.md §5
gives a runner their **active** order's address via the orders join;
0003's `addresses_select` was customer-or-admin, so a runner could not
see where to deliver. Scoped to their own `runners.id` and
`assigned`/`picked_up` only, and deliberately **not** to the claim queue:
showing every unclaimed customer's door to every runner at the store
would be a real privacy expansion for no operational gain. The queue
shows an item count; the address arrives with the claim.

Proven negatively over the wire: a runner cannot `UPDATE orders`
(no policy), cannot insert their own `runner_earnings`, and cannot read
`order_delivery_codes` at all.

## 10. Delivery-code security

D14 requires two things that cannot both hold against a hash-only column:
the customer must be able to **read** the plaintext after `assigned`
(RBAC_MATRIX.md §5: customer = "R (own order, once, after assigned)"),
and the code must never be stored in plaintext.

**Resolution (D39, agreed with the owner before implementation):** the
bcrypt hash stays on `orders.delivery_code_hash` and remains the only
thing verification reads. The plaintext lives in a new
`order_delivery_codes` table with a **customer-only** RLS policy.

Why a separate table and not a column on `orders`: 0003 grants
`select on orders to authenticated` table-wide, and `orders_select`
already lets a runner read every `packed` row at their store. A plaintext
column on `orders` would therefore be readable by the runner — precisely
what D14 forbids. A separate table with no runner policy makes that
guarantee **structural** rather than a column-grant detail a later
`select *` could quietly undo.

| Property | How |
| --- | --- |
| Runner never reads the code | no policy on `order_delivery_codes` for them |
| Never logged | absent from `audit_logs`; asserted in both suites |
| Never in Sentry | context carries `orderId`/`userId`, never the code |
| Never echoed | Zod `flatten()` names the field, not the value |
| Minted at assignment | not before — an unclaimed order has no code to leak |
| Re-minted on reassignment | the replaced runner's code stops working |
| Destroyed | on delivered and on release |
| Brute force | 5 attempts per order per 15 minutes |

Admin is excluded from the plaintext too, matching RBAC_MATRIX.md §5.

## 11. Rate limiting

Existing `rate_limit_events` table, no Redis. `subject = order_id`,
`action = 'delivery_code_attempt'`, 5 per 15 minutes, per the contract.

Scoped per order deliberately: burning attempts on one order never locks
a runner out of another, and an attacker cannot exhaust a victim's budget
from a different order.

Claim and release are not rate-limited: both are already gated by the
one-live-job invariant and the state machine, so a retry loop cannot do
anything a single call could not. Adding a limiter there would be
ceremony, not safety.

## 12. Idempotency

Per API_CONTRACTS.md §6, no new idempotency-key machinery was invented
where the state machine and existing constraints already suffice.

| Operation | Behaviour |
| --- | --- |
| `claim_job` | **not idempotent by design** — a contest; retry by re-reading the order |
| `mark_picked_up` | replay returns `alreadyPickedUp: true` |
| `release_job` | replay returns `alreadyReleased: true` |
| `verify_delivery_code` | replay returns `alreadyDelivered: true`; `runner_earnings.order_id` UNIQUE prevents a second credit |
| `admin_reassign` | reassigning to the current holder returns `unchanged: true` |

## 13. Database changes

One migration, `0007_runner_delivery.sql`. No merged migration modified.

- `order_delivery_codes` table + customer-only RLS policy
- `addresses_select_runner_active` policy
- `assert_runner_actor()`
- `process_claim_job`, `process_mark_picked_up`, `process_release_job`,
  `process_verify_delivery_code`, `process_admin_reassign`

Every function is `revoke execute ... from public, anon, authenticated`
and `grant ... to service_role`.

**No new index.** The queue reads "packed orders at my store, oldest
first", which `idx_orders_store_status_placed(store_id, status,
placed_at)` from 0001 already serves as a prefix — see §18.

`pgcrypto` lives in the `extensions` schema on Supabase while these
functions run with `search_path = public`, so `crypt`/`gen_salt` are
schema-qualified rather than widening the path.

## 14. Tests

| Suite | Before | After |
| --- | --- | --- |
| unit | 44 | **44** |
| pgTAP | 371 | **460** (+89, new file `14_runner_delivery_test.sql`) |
| gateway | 8 | **8** |
| integration | 103 | **137** (+34, new file `runner.integration.test.ts`) |

Integration stable across three consecutive full runs. All 30 rows of the
§25 matrix are covered; the race-sensitive ones use real parallelism.

Two seed gaps this work exposed and fixed: the seeded runners had
`runners` rows but **no `staff_roles` rows**, so `custom_access_token_hook`
emitted `customer` for them and every runner function would have refused
them; and there was no runner in the fixture store to prove cross-store
rejection.

## 15. iOS validation — VERIFIED

`Craavee_iPhone17`, iOS 26.5.

| Step | Result |
| --- | --- |
| Runner sign-in (local test OTP) | pass |
| Routed to `/(runner)`, not `/(customer)` | pass |
| Queue lists claimable jobs | pass |
| Claim | pass — address, landmark and item count returned |
| Active job shows one action for the status | pass |
| Picked up | pass |
| **Wrong** code | rejected with "Wrong code: that code doesn't match" |
| Correct code | **Delivered** |
| One-live-job UX | queue replaced by "You have a live job" |

Database after the run: `delivered` with `delivered_at`, an unsettled
`runner_earnings` row, the plaintext code deleted, the full
`assigned/picked_up/delivered` audit trail, and **3** `rate_limit_events`
rows — proving wrong guesses commit their attempt.

## 16. Android validation — VERIFIED

`Craavee_Pixel7_API36`, Android 16. Same flow, same result: sign-in,
queue, claim (address rendered), pickup, correct code, **Delivered**, and
a second earnings row in the database.

Run strictly after iOS was shut down — never both at once (16 GB).

## 17. Web validation — VERIFIED

Same flow completed in the browser: sign-in, queue, claim, pickup, code,
**Delivered**. The customer surface is unaffected.

### One environment caveat, stated plainly

The Supabase CLI's edge-runtime container does not boot on this machine
(recorded since Phase 4), so `54321/functions/v1` returns **503** and the
app cannot reach Edge Functions through the normal URL. Native validation
therefore ran behind a small local proxy that serves `/functions/v1/*`
from `_dev/serve.ts` and everything else from Supabase, with
`EXPO_PUBLIC_SUPABASE_URL` pointed at it in `.env.local` for the duration.

**The handlers, the database, the RLS and the auth path were all the real
ones** — only the process wrapper differed, exactly as the integration
suites already do. Nothing was committed, and `.env.local` was restored.

## 18. Performance

| Operation | Plan / cost |
| --- | --- |
| Runner queue | `idx_orders_store_status_placed(store_id, status, placed_at)` — the query's exact prefix; no new index needed |
| `claim_job` | one indexed PK lookup + `FOR UPDATE SKIP LOCKED`; no scan, no wait |
| One-live-job check | `idx_orders_one_live_job_per_runner`, a partial index over live rows only |
| `mark_picked_up` / `release_job` | single PK lookup + one update |
| `verify_delivery_code` | one `rate_limit_events` count on `(subject, action, created_at)`, then one bcrypt compare |
| `admin_reassign` | PK lookup + one busy-runner check over the partial index |

Whole integration suite (34 tests, real HTTP, real database): ~5 s. No
index was added speculatively.

## 19. Observability

Sentry captures unexpected failures with `fn`, `userId`, `orderId` and a
per-function code (`CLAIM_FAULT`, `PICKUP_FAULT`, `DELIVERY_FAULT`,
`RELEASE_FAULT`, `REASSIGN_FAULT`). A recognised canonical error is
returned to the client and **not** sent to Sentry — only genuine faults
are.

Never captured: the delivery code, JWTs, gateway credentials. Audit rows
(`order.assigned`, `order.picked_up`, `order.delivered`,
`order.released`, `order.reassigned`) carry runner/store ids and never
the code.

## 20. Known limitations

1. **A runner who has picked up and cannot deliver has no path.**
   `picked_up` exits only to `delivered` or `delivery_failed`, and
   `mark_delivery_failed` is outside Phase 7's scope (§2). `release_job`
   cannot help — `picked_up → packed` is not a legal transition. This is
   a real operational hole and it is reported, not worked around by
   inventing a transition. `mark_delivery_failed` should be the first
   item of whatever phase picks this up.
2. **`delivery_failed → assigned` is implemented but only reachable in
   tests**, via a service-role fixture, for the same reason.
3. **Runner earnings use `orders.delivery_fee` as a placeholder.**
   ENGINEERING_SPECIFICATION.md explicitly defers the formula as "a
   pricing decision, not an architecture one".
4. **Real SMS OTP remains unverified** — the local stack has no provider.
   Runner sign-in used the existing test-OTP path. Unchanged from Phase 7
   and not a Phase 7 regression.
5. **No admin UI** for reassignment. The backend capability is complete
   and tested; §14 explicitly deferred the interface.
6. **A stale `assigned` order is not auto-released.** Row #8's
   system-timeout path needs a scheduled job, which is not in scope.
7. **A web-only NativeWind dark-mode error overlay** persists from the
   previous phase (`Cannot manually set color scheme`). Pre-existing.
8. **The edge-runtime limitation in §17** affects local development
   generally, not Phase 7.

## 21. Phase 8 starting point

Nothing in this phase implements Realtime, push notifications, live
customer status subscriptions, an admin live board, or analytics.

The seams Phase 8 will want are already in place: every transition writes
an `audit_logs` row, `orders` carries the timestamps, and
ORDER_STATE_MACHINE.md's "Notification" column already names the push for
each transition. The customer's delivery code is readable through RLS the
moment a runner claims, so a "Runner assigned" push has something real to
point at.

The first thing Phase 8 should fix is **not** Realtime: it is
`mark_delivery_failed` (§20.1). Without it the delivery loop has no
failure exit.
