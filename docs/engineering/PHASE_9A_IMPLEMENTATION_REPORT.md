# Phase 9A — Admin Operations Console

The operational control plane: observe what is happening, and act on it
safely. Phase 9 was split after it started; **9B (inventory, catalog,
users, refund administration, full audit, extended metrics) is not in
this branch.**

Base: `main` = `b1e18be`. Branch: `feat/admin-operations-9a`.

---

## 1. Scope

| In (9A) | Out (9B) |
|---|---|
| Overview / live operations | Inventory administration |
| Order list, filters, search, pagination | Catalog administration |
| Order detail + permitted actions | Users / staff administration |
| **Failed-delivery queue** | Full refund administration UI |
| Runner operations | Full audit administration |
| Reassignment | Extended metrics / analytics |
| Kill switch UI over the existing enforcement | |
| Operational audit visibility | |
| Realtime + reconnect | |

Catalog, Inventory, Users and Promos remain Phase 2B route stubs and now
name 9B on the page. `/refunds` and `/audit` have no page at all, so they
are absent from the nav rather than a sidebar item that 404s.

## 2. Architecture

Unchanged from Phase 8, and deliberately so. The browser holds an anon
key and a staff JWT; **every read goes through RLS and every mutation
goes through an Edge Function.** There is no service key in the Console,
no `/api` route that proxies privileged writes, and no client-side
authorization anywhere — a UI check is a courtesy, the database is the
boundary.

The one architectural decision worth stating: **the UI does not decide
what is legal.** `OrderActions` reads `order_transition_rules` for that
order's current status and `actor='admin'` — the same table
`enforce_order_transition` enforces. A `packed` order therefore offers no
admin action and says why, because there is no `packed → cancelled` row.
Adding a rule to that table lights the button up; nothing in the frontend
needs to know.

## 3. Routes

| Route | What it is |
|---|---|
| `/overview` | Exceptions first, then in-flight counts, then 24h rates |
| `/orders` | Server-filtered, searchable, paginated order list |
| `/orders/[orderId]` | Operational detail + permitted actions + history |
| `/delivery-failures` | The failed-delivery queue |
| `/runners` | Roster, live jobs, throughput, in-place reassignment |
| `/settings` | Service controls — pause, resume, queue threshold |

`/` redirects to `/overview`.

## 4. Operational workflows

**Overview** answers one question: is anything wrong right now, and where
do I click. Exceptions come first; if nothing is wrong the section
collapses to a single sentence instead of a grid of zeroes. Counts use
`head: true` count queries rather than rows pulled into the browser and
`length`-ed, so the page does not degrade as the business grows. A packed
order nobody has claimed for 15 minutes is surfaced as an exception —
that is the failure an operator should see before the customer does.

**Order list** filters, searches and paginates server-side: the query is
built from the URL, `range()` fetches one page and `count: "exact"` gives
the total without shipping rows. Filters live in the URL, so "everything
that failed today" is a bookmarkable, shareable link. Changing a filter
resets the page — staying on page 4 of a narrower result shows an empty
table for no reason.

Search is by order reference only. An admin *may* read customer names
(RBAC §2), but the lookup an operator actually performs from a support
call is the reference, and a name search would join `profiles` on every
row for a slower query nobody asked for.

## 5. Failed-delivery handling

The priority feature, and the one the Phase 8 checkpoint flagged:
`delivery_failed` orders accumulated with no admin surface at all.

Each row shows the order, why it failed (from the audit metadata the
runner wrote), where it was going, which runner, how long ago, and the
money at risk. Two actions, both of which already existed in the backend:

* **Re-attempt** → `admin_reassign` (#13). The order returns to
  `assigned` with a **fresh delivery code** — the old one was destroyed
  when the delivery failed, and the dialog says so.
* **Cancel + refund** → `admin_cancel_order` (#14), which delegates to
  `process_refund`. The dialog states the exact consequence before the
  click: the order becomes cancelled, the server-computed remaining
  captured amount goes back to the wallet, and stock is *not* returned
  because it left the shelf at packing.

A failed delivery cannot be released to the open claim queue — only
`assigned` has that edge (#8). The dialog offers a named runner and
explains why.

## 6. Runner management

Who is on shift, what they are carrying and for how long, weekly
throughput, unsettled earnings, and a "move job" action. Throughput comes
from the `runner_earnings` rows `verify_delivery_code` already writes
(#11) — reused, not new tracking.

**No admin availability toggle.** `runners_update` (0003) is scoped to
`profile_id = auth.uid()`: a runner owns their own `is_online` and an
admin has read access only. There is no backend capability, so there is a
line of explanatory text where a button would otherwise fail.

## 7. Reassignment

Eligible runners are "at this store, not this runner, no live job".
All three are re-checked inside `process_admin_reassign`, with
`idx_orders_one_live_job_per_runner` behind it for the runner who claims
something in the gap between render and click. Greying out a busy runner
is a courtesy, not the mechanism — proven by the race tests in §11.

## 8. Kill switch

**The enforcement already existed and is not new.** `create_order`
(migration 0004, step 4) reads `stores.is_open` inside the same
transaction that writes the order and raises `STORE_CLOSED`. A checkout
racing a pause is decided by Postgres, not by a disabled button.

What was missing was the audit: RBAC routes store config through plain
admin RLS, but `audit_logs` is service-role-INSERT only, so a browser
writing `stores` directly could never record who shut the business and
why. `process_set_service_pause` is the smallest thing that closes that —
same write, same authority, one transaction, plus the audit row.

Closing without a reason is refused server-side. Resuming clears the
reason rather than leaving a stale one. Verified in the browser: pausing
from the Console wrote `is_open=false` with the reason, produced an
audited `service.paused` row attributed to the admin, and a real
`create_order` call was then refused `422 STORE_CLOSED` with the
operator's reason surfaced.

## 9. Realtime

Phase 8's architecture, reused unchanged and deliberately not extended.
Every 9A page mounts the same `RealtimeRefresh`, which never renders a
payload — it calls `router.refresh()` and the server component re-queries
through RLS. **PostgreSQL remains the authority; Realtime is a hint that
something changed.** Duplicate events are free because a refresh is
idempotent, a missed event costs nothing because the next navigation
refetches, and the component refetches on `SUBSCRIBED` so a reconnect
recovers by asking the database rather than replaying events it cannot
have.

No new sockets: one channel per mounted staff screen, as before.

## 10. Audit

Every admin action writes an `audit_logs` row through the service role —
`order.cancelled`, `order.reassigned`, `refund.issued`,
`service.paused` / `service.resumed`, `staff_role.assigned` /
`staff_role.revoked`, `runner_earnings.settled` — each with the actor
resolved from the JWT, never the body.

Operational visibility is on the order detail page ("what happened to
this order") rather than a dedicated audit console, which is 9B. A test
scans every audit row for secret shapes; see §12.

## 11. Security and concurrency

Tested at the wire, not the UI. Every admin function was called
unauthenticated and as a customer, a runner and a packer — 401/403 in
every case. A request carrying a forged `role`, `actorId`, `storeId`,
`userId` and `amount` in the body is still treated as the customer whose
JWT it is.

Races use real `Promise.all`:

| Race | Invariant asserted |
|---|---|
| Runner claims while admin reassigns | Exactly one owner; neither runner ends with 2 live jobs |
| Two admins reassign at once | One runner holds it, status still `assigned` |
| Two cancellations of one order | Exactly one `refunds` row; never refunded above captured |
| Checkout in flight against a pause | Either a complete valid order or a clean `STORE_CLOSED` — never a partial |
| Three simultaneous pause requests | All succeed, state converges |

Cross-store reassignment and reassignment to a busy runner are both
refused with canonical codes.

## 12. Refund regression

Phase 9A's first commit fixes a **real correctness bug in merged code**,
found while wiring the failed-delivery queue, which routes "cancel this
delivery" straight through `process_refund`.

`process_refund`'s full-refund branch released the inventory reservation
for `confirmed`, `assigned` and `delivery_failed`, on a premise its own
comment stated: *"never consumed yet — packing is a later phase."* True
when 0005 was written; false since 0006 landed `mark_packed`, which
consumes the reservation. `assigned` and `delivery_failed` are reachable
only *through* `packed`, so the release subtracted a quantity the order
no longer held — out of a **different live order's** reservation.
`greatest(...,0)` hid the damage from the CHECK constraint instead of
preventing it.

Measured on a clean database:

```
product P: on_hand 10, reserved 0
order A (3) placed          -> on_hand 10, reserved 3
mark_packed A               -> on_hand  7, reserved 0   (consumed)
A -> assigned -> picked_up -> delivery_failed
order B (2) placed          -> on_hand  7, reserved 2   (B live)
full refund of A            -> on_hand  7, reserved 0   <-- B's gone
```

B was still `confirmed` and still owed 2 units, while the shelf claimed
all 7 were free. An oversell, produced by an admin doing the ordinary
thing on a failed delivery.

Migration 0011 releases the reservation only from `confirmed`, which is
what ORDER_STATE_MACHINE #9 and #14 already say.

**The regression test is proven to catch it.** Reverting `process_refund`
to its pre-0011 definition against the same database makes
`16_admin_operations_test.sql` assertion 6 fail with `have: 0, want: 2`;
restoring the fix makes it pass. A regression test that has never been
seen to fail is a guess. The scenario is covered twice — in pgTAP and end
to end through the real Edge Functions — and both pin the other half too:
a refund from `confirmed` must **still** release, so the guard cannot be
"fixed" by removing the release altogether.

## 13. Tests

| Suite | Before 9A | After | Delta |
|---|---|---|---|
| pgTAP | 500, 16 files | **538, 17 files** | `16_admin_operations_test.sql`, 38 |
| Integration | 164 | **189** | `phase9a.integration.test.ts`, 25 |
| Gateway (Deno) | 8 | 8 | — |
| Unit | 44 | 44 | — |

All green from a clean `supabase db reset`. Typecheck clean; lint 0
errors (2 pre-existing warnings in `packages/ui`); Store and Console both
build.

One assertion was corrected while writing the suite: the audit-leak scan
originally rejected the string `razorpay`, which failed only when the
payment suite ran first and left a `{"gateway": "razorpay"}` row. That is
the gateway's *name* on an unknown-order webhook — legitimate operational
context, not a secret. It now scans for secret *shapes* (`rzp_test_`,
`rzp_live_`, `eyJ`, `Bearer `, private-key headers).

## 14. Performance

Every list is server-paginated or server-counted; nothing fetches a whole
table into the browser. The order list uses `range()` + `count: "exact"`
(25/page) against the existing `idx_orders_store_status_placed`. Overview
uses `head: true` counts. The 24-hour rate window is capped at 500 rows.

No Redis. No new indexes were needed.

## 15. Browser validation

Console at `localhost:3001`, signed in as a real admin, against the live
database.

* **Overview** — 30 failed deliveries surfaced as the top exception with
  the value at risk; in-flight and 24h sections populated from real rows.
* **Failed-delivery queue** — cancel + refund on `#e854fbee`: the dialog
  stated the consequence, the row disappeared, the count went 30 → 29,
  and the database showed `cancelled` / `refunded` / ₹60.00 with
  `order.cancelled` and `refund.issued` audit rows attributed to the
  admin and carrying the typed reason.
* **Re-attempt** — `#db45d890` reassigned to a named runner: status
  `assigned`, new runner, **fresh** `delivery_code_hash`.
* **Runners** — the reassignment appeared immediately on the roster.
* **Order list / detail** — status filter, pagination and detail all
  render real data; no delivery code, gateway ref or wallet balance
  anywhere on the page.
* **Kill switch** — pause and resume from the browser, both audited, with
  a real `create_order` refused `422 STORE_CLOSED` in between.

## 16. Repository hardening

**Secret history scan — clean.** `gitleaks` and `trufflehog` are not
installed and this phase does not install tooling, so all 109 commits of
history were dumped and scanned for secret *shapes*: Razorpay
live/test keys, Stripe keys, AWS key ids and secrets, GitHub PATs, Slack
tokens, Google API keys, Twilio SIDs, private-key blocks, real Sentry
DSNs, Expo tokens, `sb_secret_`, and literal password assignments.
**Zero hits on every pattern.** The only JWTs in history decode to
`{"iss":"supabase-demo","role":"anon"}` and `…"service_role"…` — the
public local-development keys that ship with the Supabase CLI and are
identical on every machine. No `.env` file has ever been committed, only
`.env.example` templates; `.gitignore` covers `.env`, `.env*.local`,
`*.pem`, `*.p8`. History was not rewritten, and did not need to be.

**Licence posture.** Every `package.json` is `"private": true` with no
`license` field, and there is no root `LICENSE` — i.e. proprietary, all
rights reserved. No licence was added, per instruction. One thing for the
owner: `apps/customer-runner/LICENSE` is Expo's MIT licence
(`Copyright (c) 2015-present 650 Industries`), left by
`create-expo-app`. It is third-party attribution for template code, but
sitting at the app root it can read as if the app itself is MIT. Deleting
a third-party licence notice is the owner's call, not mine — flagged, not
touched.

**Dev ports.** Store and Console both ran `next dev` with no port, so
whichever started second silently took 3001 through Next's
auto-increment. Now pinned — store 3000, console 3001, for `dev` and
`start` — with `dev:store`, `dev:console` and `dev:web` at the root.
Verified running simultaneously.

**Shared design tokens** (§28) were evaluated and **deferred**. The
Console's surfaces use the existing `clay-card` / OpsShell system; a
platform-neutral token refactor touches the customer app, the store app
and `packages/ui` at once, cannot be proven free of visual regression
inside an operational PR, and belongs to the dedicated UX phase.

## 17. Known limitations

1. **Real push to a handset — unverified.** No EAS `projectId`, no
   APNs/FCM credentials, no physical device. Unchanged.
2. **Real SMS OTP — unverified.** `phone_provider_disabled` locally; no
   provider configured and none invented. Unchanged.
3. **Razorpay live sandbox — unverified.** Adapter implemented, unit
   tests and mock fault injection pass; no live sandbox transaction has
   been performed. Unchanged since Phase 5.
4. **Sentry ingestion — unverified.** The shim is wired into all the new
   functions with safe context (`fn`, `userId`, `orderId`, `code`), but
   `SENTRY_DSN` is unset, so only the structured console line has been
   observed. Unchanged since Phase 4.
5. **No admin control of runner availability**, by design — there is no
   backend capability (§6).
6. **`assign_staff_role` and `settle_runner_earnings` have no UI.** Both
   functions are built and tested; the Users and Runners administration
   surfaces that drive them are 9B.
7. **The order list searches by reference, not customer name** (§4).
8. **Median fulfilment reads 0m on seed data**, because seeded orders are
   placed and delivered at effectively the same timestamp. Correct
   arithmetic, unhelpful fixture.

## 18. Phase 9B starting point

Already built and tested at the backend, waiting only for a surface:
`assign_staff_role` (Users) and `settle_runner_earnings` (Runners
administration). Inventory and catalog administration are plain admin RLS
writes — `inventory_update_admin`, `products_*` — with
`reserved_not_above_on_hand` as the database backstop; no new Edge
Function should be needed. A dedicated audit console and refund
administration have their data available today via `audit_logs` and
`refunds`.

The one thing 9B should not inherit uncritically: §12 exists because a
comment in migration 0005 was true when written and quietly stopped being
true two phases later. Assertions about "what has happened by now" age;
the state machine does not.
