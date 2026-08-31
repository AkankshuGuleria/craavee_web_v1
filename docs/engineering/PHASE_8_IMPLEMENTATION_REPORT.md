# Phase 8 — Delivery Failure, Realtime and Notifications

Closes the hole Phase 7 reported, then puts a live layer on top of the
loop that now has no dead ends.

Base: `feat/runner-delivery` = `29ebda3` (Phase 7, PR #12, still open).
Branch: `feat/realtime-notifications`.

**Order of work was deliberate.** Part A (`mark_delivery_failed`) came
first, exactly as Phase 7 §20.1 asked. Realtime and push are comfort;
a runner stranded with an undeliverable order is a broken business.

---

## 1. Delivery failure — the exit that did not exist

`picked_up` leaves only to `delivered` or `delivery_failed`
(ORDER_STATE_MACHINE.md #11/#12), and `release_job` cannot help because
`picked_up -> packed` is not a legal edge. Before this phase a runner who
had collected an order and could not hand it over had **no** action.

`process_mark_delivery_failed(order_id, actor_id, reason)` in migration
`0008_delivery_failure.sql` performs row #12 and nothing beyond it:

| Row #12 says | What the function does |
|---|---|
| Actor: runner (own job) or admin | `FORBIDDEN` unless assignee or admin |
| Trigger: unreachable / wrong address / safety | free-text `reason`, required |
| Timestamp written: — | none |
| Inventory effect: none | none |
| Wallet/payment: "none yet" | **no refund, no wallet movement** |
| Audit: `order.delivery_failed`, reason logged | `audit_logs` row with the reason in metadata |

Two things it does that the row does not spell out, and why:

* **The delivery code is destroyed.** `order_delivery_codes` row deleted
  and `orders.delivery_code_hash` nulled. The attempt is over; a code
  that survived it would be a live credential for an order nobody is
  carrying. A reassignment mints a fresh one (0007's `claim_job` path).
* **The runner stays on the order.** #12 does not clear `runner_id`, so
  the order remains attributable to whoever attempted it. It is not
  returned to the queue — `delivery_failed` is not claimable, and
  `claim_job` only ever selects `packed`. The runner is nevertheless
  *free*: `idx_orders_one_live_job_per_runner` covers only
  `('assigned','picked_up')`, so they can take their next job
  immediately.

Recovery is `admin_reassign` (#13, already shipped in Phase 7) or cancel
+ refund (#14). No new status was added, and the state machine was not
touched.

## 2. What was NOT done, on purpose

* **No automatic refund.** Row #12 says "none yet (see #13/#14 for
  resolution)". A failed attempt is not a financial event: refunding
  here would refund orders that succeed on the second attempt. The admin
  decides.
* **No new order status.** #12 already exists.
* **No customer Realtime channel.** D20 stands (see §5).
* **No Redis, no new infrastructure.** The outbox is a table.

## 3. Realtime — what it is and what it is not

`0009_realtime.sql` adds `orders` and `inventory` to the
`supabase_realtime` publication with `replica identity full`, guarded so
a re-run does not raise. That is the entire database surface.

Authorization is **not** a new mechanism. Realtime evaluates the same
RLS policies as the table, per subscriber. `orders_select` (0003) is what
stops a store-A packer reading store-B rows, even if they guess the
channel name and drop the client-side filter. The `store_id=eq.<id>`
filter clients send is bandwidth, not security.

Every consumer refetches; none renders the payload:

| Surface | Consumer | On event | On (re)subscribe |
|---|---|---|---|
| Store | `RealtimeRefresh` | `router.refresh()`, 250 ms coalesce | `router.refresh()` |
| Console | `RealtimeRefresh` | same | same |
| Runner app | `useRunnerRealtime` | invalidate `runner.queue` / `runner.active` | invalidate |

That indirection is the design. Duplicate events are free (a refresh is
idempotent — the local stack was observed emitting two events for one
UPDATE), and a missed event costs correctness nothing.

**A missed event is not hypothetical.** Measured against the local stack:
Realtime authorizes a change lazily, so an order that has already moved
on to a status the subscriber cannot read stops delivering its *earlier*
events too. A packer whose socket is briefly behind can therefore never
see the `packed` event for an order a runner claimed quickly. The event
stream is not a log. Both staff surfaces are built for that and the
integration suite asserts it.

## 4. Two Realtime defects found by validating instead of assuming

Both were caught by driving the real surfaces, not by reading the code.

**4.1 The socket joined before it was authorized.** Realtime binds a
postgres_changes subscription to whatever token the socket holds at JOIN
time and never re-authorizes it. Both web surfaces subscribed in a mount
effect, racing the Supabase client's read of the session from cookies.
The channel registered as `anon`, reported `SUBSCRIBED`, and then
received nothing — permanently and silently. Observed directly:
`realtime.subscription.claims_role` was `anon` for a signed-in admin and
the Console board did not move when an order was packed. Fixed by
reading the session and calling `realtime.setAuth()` before opening the
channel; the same is now done explicitly in the runner hook, which was
not exposed but should not depend on luck upstream.

**4.2 Two screens, one channel topic.** Both runner screens are mounted
in the router stack, and both used the topic `store:<id>:orders`.
supabase-js returns the *same* channel object for a repeated topic, so
the second screen's binding threw `cannot add postgres_changes callbacks
... after subscribe()` and that screen had no live updates. Caught on the
iOS simulator as a red LogBox error. Fixed with a per-instance topic
suffix; the topic was never the security boundary.

## 5. D20 — customers poll, and that is enforced in the client

D20 says the customer app polls (8 s, backing off to 30 s, stopped when
backgrounded) rather than holding a socket — the mitigation for socket
fan-out at 800 concurrent customers.

What the database actually enforces is *ownership, not silence*:
`orders_select` grants `customer_id = auth.uid()`, so a customer who
opened a socket would receive their own order and nothing else. Measured,
not assumed. D20 is therefore a client-architecture guarantee, and the
suite enforces it as one: it asserts the customer is scoped to rows they
own, and separately scans the shipped source to prove that every
`.channel(` lives under the runner surface, while `useOrder` polls and
never subscribes.

## 6. Notifications

`0010_notifications.sql`:

* `push_tokens` — one row per device. RLS: a signed-in user may select
  and delete **their own** rows. There is deliberately no insert policy;
  registration goes through `register_push_token`, which takes the owner
  from the verified JWT, so a forged `profileId` in the body is ignored.
* `notification_outbox` — `constraint notification_outbox_once unique
  (order_id, event)`. Enqueued by an `AFTER UPDATE` trigger on `orders`,
  so a notification originates from an authoritative state change and can
  never be fired by a client call. A repeated transition
  (`packed → assigned → packed → assigned`) is a no-op, not a second
  push.
* `claim_notification_batch` uses `FOR UPDATE SKIP LOCKED`, so two
  dispatcher runs cannot send the same row twice.

`dispatch_notifications` is internal-only — an unauthenticated call gets
401. Payloads carry a title, a body and the order id: no delivery code,
no amounts, no phone numbers, no tokens. The suite asserts that by
scanning every queued payload for the order's actual code, for long digit
runs, and for `eyJ` / `Bearer` / `razorpay` / `wallet`.

A failed or undelivered notification never blocks or corrupts order
state — asserted directly: every order in the suite reaches its correct
status while its outbox rows sit unsent.

## 7. Database changes

| Migration | Contents |
|---|---|
| `0008_delivery_failure.sql` | `process_mark_delivery_failed` |
| `0009_realtime.sql` | publication membership + `replica identity full` for `orders`, `inventory` |
| `0010_notifications.sql` | `push_tokens`, `notification_outbox`, enqueue trigger, `process_register_push_token`, `claim_notification_batch`, `mark_notification_sent`, `delete_push_token` |

New Edge Functions: `mark_delivery_failed`, `register_push_token`,
`dispatch_notifications`.

## 8. Tests

| Suite | Before Phase 8 | After | Delta |
|---|---|---|---|
| pgTAP | 446 assertions, 15 files | **486, 16 files** | `15_delivery_failure_test.sql`, 40 assertions |
| Integration | 137 | **162** | `phase8.integration.test.ts`, 25 tests |
| Gateway (Deno) | 8 | 8 | — |
| Unit | 44 | 44 | — |

All green on a freshly reset database. No existing test was weakened.

Three fixes the new suite forced, all of them real:

* **`parkLiveJobs()`.** Both runner suites' teardown reset a live job with
  `picked_up -> packed`, which `enforce_order_transition()` rejects. The
  update failed *silently*, so a stale assignment survived every run and
  made the next run's claims fail with `RUNNER_ALREADY_ASSIGNED` —
  failures that looked like product defects and were not. Both suites now
  exit through a legal edge (`assigned → packed`, `picked_up →
  delivery_failed`) and park on the way in as well, so a run that dies
  part-way cannot poison the next one.
* **`listen({ warm: true })`.** Realtime reports `SUBSCRIBED` before it is
  actually replaying WAL for the subscription, so a test that acted
  immediately lost its own first events. Listeners now prove they are
  delivering — by poking a fixture row until an event comes back — and
  resubscribe if a channel never comes alive. Fixed sleeps are gone.
* **Integration suites run serially** (`--test-concurrency=1`). They
  share one database, one seed inventory and one set of runners; running
  them in parallel was never sound.

## 9. iOS validation — VERIFIED

`Craavee_iPhone17`, iOS 26.5, dev client on Metro, real database and real
Edge Functions.

* Signed in as runner `+919000001201`, queue rendered.
* Claim → `Your delivery, Block P6 · Room 1` → **Picked up** → **Can't
  deliver this** → reason "Customer not answering" → back to the queue.
  `audit_logs` shows `order.delivery_failed` with that reason.
* Realtime: `realtime.subscription` registered `claims_role=runner` with
  the store filter. With a job claimed on device, releasing it from psql
  moved the screen from "Your delivery" to "No live job" with no
  interaction.
* Push: the OS permission prompt appeared and was granted. **No token was
  minted and none was registered** — expected, and reported as such: the
  app has no EAS `projectId` and a simulator has no APNs. The hook
  reports `unsupported`/`unconfigured` and the order flow is unaffected.

## 10. Android validation — VERIFIED

`Craavee_Pixel7_API36`, API 36, via `adb reverse`.

* Signed in as the same runner; queue rendered; no LogBox errors after
  the §4.2 fix.
* Claim → Picked up → Can't deliver this → reason "gate locked". Audit:
  `order.delivery_failed`, reason `gate locked`.
* Realtime: two runner subscriptions (one per mounted screen, distinct
  topics). Claiming on device then releasing from psql moved the screen
  to "No live job".
* Push: Android 13 `POST_NOTIFICATIONS` prompt appeared and was granted;
  no token minted, same reason as iOS.

## 11. Web validation — VERIFIED

Both apps against the local stack, signed in with real staff JWTs.

* **Store, as packer** — subscription `claims_role=packer` with
  `store_id` filter; packing an order from psql moved the queue 32 → 31
  within ~2 s, no reload.
* **Store, as admin** — `claims_role=admin`, no filter; queue 46 → 45.
* **Console, as admin** — Placed 24 → 23 and Packed 86 → 87 within ~2 s;
  the packed order left the Placed column.

Before the §4.1 fix the Console did not move at all. That is the whole
value of doing this in a browser rather than reasoning about the code.

## 12. Known limitations

1. **No push has ever been delivered to a handset.** Token minting needs
   an EAS `projectId` and a physical device; APNs/FCM credentials do not
   exist yet. Everything up to and including the outbox row and the
   dispatcher's behaviour is covered; delivery is not, and is not
   claimed. The dispatcher is also not scheduled — nothing invokes it on
   a timer yet.
2. **Phone OTP send is untestable locally.** `/auth/v1/otp` returns
   `phone_provider_disabled`; no SMS provider is configured and none was
   invented. On-device sign-in used the verify screen directly with the
   configured local test OTP. Real SMS remains unverified.
3. **Edge Functions have no local container.** The CLI edge runtime does
   not boot on this machine (Phase 4 §20), so on-device validation routed
   `/functions/v1/*` to `scripts/serve-functions.sh` through a throwaway
   proxy. The handler code, the database and the JWT path are identical
   to production; only the transport was stitched.
4. **One Realtime flake, once.** Immediately after `supabase db reset`
   restarted the containers, a listener never became live inside 20 s.
   Not reproduced in five subsequent full runs. `listen()` now
   resubscribes rather than waiting longer, but the cause is not proven
   and it is recorded as unproven.
5. **Razorpay still has no live sandbox run.** Unchanged from Phase 5.

## 13. Phase 9 starting point

The loop now has no dead ends and a live layer over it. What Phase 9
inherits:

* A dispatcher that is correct but unscheduled, and push credentials that
  do not exist. That is the shortest path to notifications that a user
  can actually receive.
* `delivery_failed` orders accumulate until an admin acts on them. There
  is no admin view of them yet — the Console board has no column for
  `delivery_failed`, so today they are visible only in the database.
* Realtime's lazy authorization (§3) is a property worth writing down in
  ENGINEERING_SPECIFICATION.md before someone builds a feature that
  assumes the event stream is complete.
