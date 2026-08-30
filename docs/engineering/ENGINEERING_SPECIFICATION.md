# Craavee — Engineering Specification (Phase 1)

Companion documents (canonical source for their concern — not duplicated
here): `DECISION_LOG.md`, `DATABASE_SPEC.md`, `RBAC_MATRIX.md`,
`ORDER_STATE_MACHINE.md`, `API_CONTRACTS.md`, `SECURITY_MODEL.md`,
`DEPLOYMENT_TOPOLOGY.md`, `TEST_STRATEGY.md`, `PHASE_PLAN.md`, and
`PHASE_1_1_CORRECTIONS.md` (the payment-flow, concurrency, and
consistency corrections applied after the initial Phase 1 draft — this
document's body already reflects those corrections throughout; that file
is the narrative record of *what changed and why*, not a second source of
truth). This document is the entry point and covers everything that
doesn't have a more specific canonical home: payments/wallet/runner/
fulfilment/admin narrative overviews, realtime, notifications,
observability, performance, service controls, migration strategy,
frontend reuse strategy, the hackathon launch architecture, definition of
done, and the final consistency validation.

Labels: **[DOSSIER]** required by the dossier. **[PROMPT]** resolved by
the Phase 1 instruction. **[DECISION]** made in `DECISION_LOG.md` (cited
by ID, e.g. D1). **[FACT]** existing-codebase fact from Phase 0.

---

## 0. What changed since Phase 0

Phase 0 (`docs/audit/`) found a domain-model ambiguity and flagged it as
the single blocker before any spec could be written. That ambiguity is
now resolved: **[PROMPT §1]** Craavee v2.0 is the product; the hackathon
is a launch campaign, never a parallel domain. See D1 for the decision
and D22 for exactly how the hackathon is represented. Every document in
this set is written against that resolution — nothing here treats the
hackathon as anything other than a `campaigns` row.

**What changed in Phase 1.1:** a specification consistency and
correctness review found three real correctness gaps in the first Phase
1 draft — the payment flow held a database transaction open across the
gateway network call (D24), wallet-spend concurrency was incorrectly
assumed away (D25), and promo-redemption concurrency was left an
explicitly unsolved weakness (D26) — plus two consistency gaps (Edge
Function terminology, D31; the runner foreign-key model, D28). All five
are corrected throughout this document and its companions; nothing below
describes the pre-correction design. Full record: `PHASE_1_1_
CORRECTIONS.md`, `DECISION_LOG.md` D24–D32.

## 1. Target architecture (overview — full detail in `DEPLOYMENT_TOPOLOGY.md`, `DATABASE_SPEC.md`)

Four deployable surfaces (D3) in one monorepo (D2): `apps/customer-runner`
(Expo, role-gated router), `apps/store`, `apps/console` (both Next.js),
plus `supabase/` (schema + Edge Functions as a first-class unit). One
authentication system (Supabase Auth, phone OTP), role entering the
system exclusively via a server-injected JWT claim (D8). Almost every
read is RLS-gated PostgREST; four classes of contended/multi-table
mutation go through Edge Functions (D9). No separate API service (D19),
no Redis until a load test demands it (D18) — both directly inherited
from dossier §10/§12/§14 and re-confirmed, not re-litigated, by this spec.

## 2. Target database model (overview — full DDL in `DATABASE_SPEC.md`)

Fourteen-plus tables covering identity (`profiles`, `staff_roles`),
campaigns/attribution (`campaigns`), geography (`stores`, `zones`,
`addresses`), catalog (`products`, `inventory`), commerce (`orders`,
`order_items`, `payments`, `webhook_events`, `wallet_ledger`), people
(`runners`, `runner_earnings`), and operations (`promos`,
`promo_redemptions`, `audit_logs`, `rate_limit_events`). UUID PKs (D5),
integer-paise money (D7), `store_id` on every store-scoped row (dossier
§5/§11, prompt §5) even though exactly one store exists at launch. No
`venue`/`table`/`seat`/`event_credit` concept anywhere (D1, D15).

## 3. Target RBAC model (overview — full matrix in `RBAC_MATRIX.md`)

Four roles: `customer` (default, majority case, not itself a stored
value), `packer`, `runner`, `admin` (D8, `staff_roles`). No `super_admin`
— considered and explicitly rejected as unjustified at current scale
(`RBAC_MATRIX.md` §1). Every capability in the Phase 1 prompt's §7.5
"minimum requirements" list is accounted for in `RBAC_MATRIX.md` §2's
matrix and §3's explicit "cannot" list, verified against the schema, not
asserted in the abstract.

## 4. Target order state machine (overview — full transition table in `ORDER_STATE_MACHINE.md`)

`created → confirmed → packed → assigned → picked_up → delivered`, plus
`payment_failed`, `cancelled`, `delivery_failed`. Claiming (`packed →
assigned`) and physically picking up (`assigned → picked_up`) are
distinct transitions, per the prompt's explicit instruction — no path
skips `assigned`. Every transition has a named actor, a database
mechanism, and a timestamp column; illegal transitions are rejected by a
single `BEFORE UPDATE` trigger, not scattered application-layer checks.

## 5. Critical correctness mechanisms (dossier §13's six guarantees)

| # | Guarantee | Mechanism | Spec reference |
|---|---|---|---|
| 1 | No duplicate orders | `UNIQUE(idempotency_key)`, client-generated key, idempotent replay | D23, `DATABASE_SPEC.md` §7 |
| 2 | No duplicate payment captures | `UNIQUE(gateway_payment_ref)` + `webhook_events` transport-level dedup | `DATABASE_SPEC.md` §8, `API_CONTRACTS.md` `payment_webhook` |
| 3 | No overselling | `qty_on_hand`/`qty_reserved` split + `SELECT ... FOR UPDATE` | D11, `DATABASE_SPEC.md` §6/§14 |
| 4 | No double assignment | `SELECT ... FOR UPDATE SKIP LOCKED` in `claim_job`, against `runners.id` (D28) | D13, `API_CONTRACTS.md` |
| 5 | One live job per runner | Partial `UNIQUE(runner_id) WHERE status IN ('assigned','picked_up')`, `runner_id → runners.id` not `profiles.id` (D28) | D13, D28, `DATABASE_SPEC.md` §7 |
| 6 | No illegal order transitions | Single `BEFORE UPDATE` trigger validating the transition table, extended (Phase 1.1) to also validate the payment/order state pairing | `ORDER_STATE_MACHINE.md` §4, §2.1 |

Every mechanism above is enforced at the database layer, not merely the
application layer — verified independently by pgTAP tests per
`TEST_STRATEGY.md` §2, which is deliberately structured to test the
database/API layer directly rather than only through the UI.

**Two additional correctness properties, not among the dossier's original
six but identified and closed in the Phase 1.1 review** (`PHASE_1_1_
CORRECTIONS.md`, `DECISION_LOG.md` D25/D26): **no wallet balance goes
negative under concurrent spend** (`profiles` row lock, first in the
fixed lock order) and **no promo redemption exceeds its configured
limits under concurrent redemption** (`promos` row lock, serializing both
`max_uses` and `per_user_limit` checks). Both are exactly as
database-enforced as the original six, and both have dedicated tests in
`TEST_STRATEGY.md` §2.1.

## 6. Payment architecture

**[DOSSIER §9]** Real money, from hour one — not event credits (D1, D22
confirm this is permanent, not a hackathon-era placeholder). **[DECISION
D12]** Gateway-agnostic internal contract (`createPaymentIntent`,
`verifyWebhookSignature`, `parseWebhookEvent`), one adapter implementing
it for whichever of Razorpay/Cashfree clears KYC first.

**Revised Phase 1.1 (D24) — three explicit phases, no Postgres
transaction held across gateway network I/O:** Phase A (one transaction —
validate, lock in fixed order (D25), price server-side, reserve
inventory, apply wallet/promo, create `orders`+`order_items`+exactly-one
`payments` row (D29), commit) → Phase B (gateway call, no transaction
held, protected from duplicate concurrent calls by a claim marker on
`payments.gateway_intent_requested_at`) → Phase C (short transaction
persisting the gateway's response). The gateway's webhook (never the
client's success callback) is the sole source of payment truth, verified
by signature before any processing (`API_CONTRACTS.md` `payment_
webhook`). Full redesign, compensation table for every failure mode
(timeout, gateway-success-but-client-disconnected, DB-write-failure-
after-gateway-success), and the idempotent-resume matrix:
`PHASE_1_1_CORRECTIONS.md` §4.

Refunds default to wallet credit per dossier §18, with a genuine
gateway-refund path available for cases needing money back to the
original instrument (`API_CONTRACTS.md` `refund`), tracked via a
dedicated `refunds` table + cached `payments.refunded_amount` (D29) so
duplicate refunds are impossible and a refund can never exceed what was
captured. **Payment state (`payments.status`) and fulfilment state
(`orders.status`) are deliberately separate, kept consistent by Edge
Functions writing both together plus a validating trigger backstop** —
full valid-combinations table: `ORDER_STATE_MACHINE.md` §2.1, D30. A
late-arriving webhook for an order that's already terminal (expired or
cancelled) is not silently dropped or wrongly resurrected — it triggers
an automatic wallet refund and an admin alert (`PHASE_1_1_CORRECTIONS.md`
§8/§9).

Reconciliation: `payments.raw_event`/`webhook_events.payload` retain the
webhook payload, **redacted at write time**, for 180 days (D32) for
dispute review; a nightly job compares `wallet_ledger` sums against
`profiles.wallet_balance` (D10) — payment-side reconciliation against the
gateway's own settlement report (dossier §9) is an operational process
using this data, not a new mechanism this spec needs to build beyond
making the data available, correct, and appropriately bounded/redacted.

## 7. Wallet / promo system

**[DECISION D10]** Cached `wallet_balance` + append-only `wallet_ledger`,
written together in every transaction, reconciled nightly. **Revised
Phase 1.1 (D25):** the wallet-affecting step of `create_order` locks the
customer's `profiles` row (`FOR UPDATE`) **first**, before checking or
debiting the balance — closing a real concurrency gap the original Phase
1 spec had incorrectly assumed away (`wallet_balance` can never go
negative under concurrent spend as a result; full mechanism and test:
`PHASE_1_1_CORRECTIONS.md` §5, `TEST_STRATEGY.md` §2.1 case 1). A wallet
debit that's later reversed because payment setup never completed
(gateway failure, timeout, or reservation expiry) uses a distinct ledger
reason, `reservation_reversal`, kept separate from `refund` (which means
a payment was actually captured and later returned) — D27.

**[DOSSIER §7, §18]** Promotional credit — including the hackathon's
welcome credit — is a `wallet_ledger` entry with `reason='promo_credit'`,
optionally attributed to a `campaigns` row via the triggering `promos.
campaign_id` (D22), never a distinct currency system. **Revised Phase
1.1 (D26):** promo redemption locks the target `promos` row before
checking either `max_uses` (via a new cached `promos.uses_count`) or
`per_user_limit` (via a now-safe-to-trust count of `promo_redemptions`)
— one lock correctly enforces both, for any `per_user_limit` value,
closing the concurrency gap the original spec had explicitly flagged as
an open weakness rather than solved. Referral credit (dossier §18) uses
the same ledger with `reason='referral_credit'` — exact amounts/limits
are a deferred product decision (`DECISION_LOG.md`, "explicitly
deferred" list), not an architecture gap; the schema supports it as
written. Spending wallet balance at checkout is `create_order`'s
`useWallet` flag (`API_CONTRACTS.md`), applied before the gateway is
invoked, per dossier §9's wallet description — a fully wallet-covered
order never touches the gateway at all, and (Phase 1.1) is `confirmed`
synchronously inside Phase A with no Phase B/C needed.

## 8. Runner assignment & delivery verification

**[DOSSIER §7.4, §13, PROMPT §7.11-7.12]** Full workflow: `runners.
is_online` toggle (own row, simple RLS write) → `claim_job` against the
`packed` queue at the runner's own store (`FOR UPDATE SKIP LOCKED`, D13)
→ `mark_picked_up` → `verify_delivery_code` (4-digit, hashed, rate-
limited, D14) → `delivered`, with `release_job`/`admin_reassign` covering
runner-phone-failure and going-offline-with-active-work per the Phase 1
prompt's explicit callouts. Full transition detail in `ORDER_STATE_
MACHINE.md`; full function contracts in `API_CONTRACTS.md`; RLS scoping
(a runner sees only claimable-at-their-store + their own assigned order,
never another customer's history) in `RBAC_MATRIX.md` §5.

**Revised Phase 1.1 (D28):** `orders.runner_id` references `runners.id`,
not `profiles.id` — every function above resolves the caller's `runners.
id` from `profile_id`/`auth.uid()` as its first step. This makes "an
order can only ever be assigned to an actual onboarded, active runner" a
foreign-key-level guarantee rather than an application-logic convention;
full reasoning `PHASE_1_1_CORRECTIONS.md` §7.

## 9. Store / packing workflow

**[PROMPT §7.13]** `confirmed → pack queue → mark_packed → packed →
runner queue`, with `mark_stock_out` as a same-transaction adjustment
(not a status transition — `ORDER_STATE_MACHINE.md` "Stock-out is not a
state transition") that delists/zeroes the affected inventory, reduces
the order total, and refunds the difference to wallet, all before the
order continues toward `packed`. The runner never sees a "this order had
a problem" flag — only the final, already-reconciled item list — matching
the prompt's explicit instruction. This is fully database-backed (not
UI-only) — see `API_CONTRACTS.md` `mark_stock_out`.

## 10. Admin / Console

**[PROMPT §7.14, dossier §6]** Full capability list (live order board,
catalog/pricing, inventory, customers, runners, promos, refunds,
reassignments, force-complete-where-safe, store hours/serviceability/
queue thresholds, audit logs, exports, metrics) is the `admin` row of
`RBAC_MATRIX.md` §2, with §4 of that document specifying exactly which of
these are direct RLS-gated writes (catalog/pricing edits — simple,
uncontended) versus Edge-Function-mediated (refunds, reassignments, role
grants — audited, transactional, state-machine-governed even when
admin-initiated, so an admin override still respects guarantee #6).
"Force-complete where safe" is deliberately **not** a separate mechanism
— it's `admin_reassign`/`admin_cancel_order` used at the admin's
discretion, still going through the same state machine as every other
transition, so there is no backdoor that writes `orders.status` without
triggering the same validation and audit trail as a customer/runner-
initiated change.

## 11. Service controls

**[PROMPT §7.15, dossier §6, §14]** `stores.is_open`, `pause_reason`,
`max_queue_depth` (`DATABASE_SPEC.md` §5) cover open/closed, manual
pause, and auto-pause (a scheduled check or a trigger-adjacent function
comparing live `packed`+`assigned`+`picked_up` order count against
`max_queue_depth`, setting `pause_reason='auto: queue depth'` when
exceeded — implementation detail for Phase 9, mechanism already fully
specified by the schema). `zones.is_serviceable` covers serviceable-area
control (D16). Per the prompt's explicit instruction: **existing orders
continue through fulfilment when new orders are paused** — a paused
store rejects new `create_order` calls (`STORE_CLOSED`/`SERVICE_
UNAVAILABLE`, `API_CONTRACTS.md`) but nothing about a pause touches
`orders` already in flight; there is no separate "emergency mode" beyond
this, since nothing in Phase 0/1 identified a scenario this doesn't
already cover.

## 12. Realtime

**[DECISION D21, DOSSIER §10, §12]** Staff-only (Store/Runner/Console),
one channel per `store_id`, Realtime-native RLS-equivalent authorization
so a store-A staff member cannot subscribe to store-B's channel even by
guessing the name. Customers never open a Realtime channel (D20) —
covered next.

## 13. Customer order tracking

**[DECISION D20, DOSSIER §10, §14]** Polling, not Realtime — 8-second
interval while foregrounded and the order is non-terminal, backing off to
30s after 2 minutes of no change, stopped entirely when backgrounded.
This is the specific mitigation for dossier §14's launch-day failure mode
#4 (socket fan-out at 800 concurrent customers).

## 14. Notifications

**[PROMPT §7.17, DOSSIER §12]** `expo-notifications`, event list: order
confirmed, packed, runner assigned, picked up, delivered, payment
failure, stock-out/refund — each fired from the corresponding Edge
Function transition (`ORDER_STATE_MACHINE.md` §2's "Notification"
column), not from client-side state inference. **Notifications are never
the system of record** (prompt's explicit instruction) — a failed push
delivery has zero effect on `orders`/`payments`/`wallet_ledger` state;
the customer's next poll (§13) or app open shows the correct state
regardless of whether the push arrived.

## 15. Observability & analytics

**[PROMPT §7.24, DOSSIER §12]** Sentry across all four apps + Edge
Functions, tracking (at minimum) app crashes, API errors, payment
failures, order-creation failures, webhook failures, invalid state
transitions, inventory contention (a caught `INSUFFICIENT_STOCK` under
genuine concurrency is expected behavior, not an error — but the *rate*
of it is a signal worth having in Sentry/PostHog as a metric, not an
error report), and delivery failures. PostHog event schema: install/
open, first order, checkout started, payment success/failure, order
status transitions, delivered, reorder, promo redeemed — every event
carrying `campaign_id`/acquisition attribution as a property (D22),
**never** as a separate event taxonomy for the hackathon specifically.
This is what makes dossier §5's "the retention cohort... week-two
behaviour is the only signal that matters" and §22's D7/D30 repeat-rate
metrics measurable at all — see `PHASE_PLAN.md` Phase 11.

## 16. Performance

**[PROMPT §7.25, DOSSIER §14]** Designed against an 800-concurrent-user,
90-second burst, explicitly **not** modeled as 800 identical requests —
the burst is auth (OTP) + catalog reads + a smaller order-placement
fraction + polling, each with different throughput characteristics
(`TEST_STRATEGY.md` §3 breaks these into separate k6 scenarios for
exactly this reason). Catalog caching: CDN-level cache on product images
(short TTL) per dossier §14 failure mode #3, stock/availability queried
separately and un-cached (data that changes fast shouldn't share a cache
tier with data that doesn't). Polling: D20. Pagination: catalog reads use
standard PostgREST range headers (`?limit=&offset=` or keyset pagination
on `sort_order`) — not built as custom logic, PostgREST provides this
natively. Connection pooling: Supavisor transaction mode, capped pool
size (dossier §12/§14: "the single most important production setting in
this stack" / failure mode #2). Realtime connection targets: ~15
(dossier §14, D21). Rate limiting: `rate_limit_events` table (D14/D18) for
delivery-code attempts; Supabase Auth's built-in limits for OTP, revisited
only if proven insufficient (`DECISION_LOG.md` deferred-decisions list).
Retry/backoff: client-side exponential backoff on transient network
failures (dossier §14 failure mode #7: "a failed request must never
silently lose an order or a payment" — satisfied structurally by
idempotency, D23, rather than by retry logic alone: a retried `create_
order` is safe *because* of the idempotency key, not merely because the
client is polite about retrying). Database indexes: `DATABASE_SPEC.md`
throughout. **Redis: still deferred (D18) — nothing in this performance
design introduces a need for it.**

## 17. Migration strategy from the current prototype

**[DECISION D17]** Clean schema introduction, no compatibility migration
— there is no production database and no real user data anywhere today
(Phase 0 finding), so there is nothing to migrate *data* for. What
*does* move forward: the visual design system and the Next.js/TypeScript
toolchain (§18 below) — a code-reuse question, distinct from the
schema-migration question this section answers, which is: no.

## 18. Existing frontend integration strategy

**[PROMPT §7.30, referencing `docs/audit/BACKEND_READINESS.md`'s
existing reuse assessment]**

**Reused, largely as-is:** the visual design system (`DESIGN.md`'s
tokens — colors, spacing, motion rules), the component library
(`src/components/ui/*`, `magicui/*`), the Next.js 16/TypeScript-strict/
Tailwind v4 toolchain. These move into `apps/store`/`apps/console`
(`DEPLOYMENT_TOPOLOGY.md` §2) largely unchanged — Phase 0's audit
explicitly found this to be genuine, reusable engineering craft aimed at
the wrong backend, not wrong itself.

**Replaced entirely, not incrementally migrated:** `Providers.tsx`'s
`localStorage`-only auth/cart/address contexts (real auth is a
categorically different mechanism, not an extension of fake auth), the
three mock API routes, `src/db/*`/`src/server/*`'s stub repositories/
services (zero logic exists to preserve), `src/types/index.ts`'s venue/
table/seat domain types (D1, D15 — the domain model itself changed, so
these types are wrong, not incomplete).

**How the connection happens incrementally without a UI rewrite:** each
existing screen (`/shop`, `/catalog`, `/live-ops`, `/packing`, `/queue`,
`/active`) is rebuilt against the new backend **one at a time, following
`PHASE_PLAN.md`'s phase order** (catalog in Phase 3, orders in Phase 4,
packer screens in Phase 6, runner screens in Phase 7, admin/console in
Phase 9) — reusing each screen's *visual layout and component choices*
while replacing its *data source* (mock array → RLS-gated Supabase query
or Edge Function call) and its *auth gate* (none → real role check). This
is "incrementally connected," per the prompt's exact phrasing, precisely
because each phase touches one surface's data layer without needing to
touch its already-good visual layer at all.

**Not reused, by explicit design choice, not oversight:** the customer/
runner surfaces are **not** ported from the existing Next.js pages into
the Expo app as code — `apps/customer-runner` is a from-scratch Expo
build (Phase 3 onward) informed by the existing UI's visual language
(same design tokens, translated to NativeWind) but not copy-pasted,
since React DOM and React Native components aren't interchangeable.
`docs/audit/BACKEND_READINESS.md` already identified the Expo app as 0%
started; this spec doesn't change that starting point, only the target
it's now building toward.

## 19. Hackathon launch architecture

**[PROMPT §1, §7.31 — the most load-bearing resolution in this whole
document]** The hackathon is exactly one `campaigns` row
(`type='launch_event'`). Attribution: `profiles.acquisition_campaign_id`,
set once at signup, read by analytics (§15). Promotion: a `promos` row
with `campaign_id` pointing at the hackathon campaign, distributing
welcome wallet credit through the ordinary `wallet_ledger`/promo-
redemption mechanism (§7, D22) — not a special code path. Operational
configuration that legitimately changes *during* the 30-hour window
(queue threshold, store hours, promotional credit amount, serviceable
zones — dossier §21's runbook) is exactly that: rows in `stores`/`zones`/
`promos` an admin edits live through the Console (§10/§11), the same
mechanism used every other day, not a hackathon-specific admin mode.

**After the hackathon:** per the prompt's explicit instruction, **no**
schema replacement, **no** auth replacement, **no** special event-order
mode, **no** migration away from event credits — because the core
product never used event credits, auth, or a schema that needed
hackathon-specific handling in the first place. The exact same
`create_order`/`claim_job`/`payment_webhook`/state machine that served
the hackathon's first order serves every order after it, unmodified.
This is the direct, verifiable consequence of D1/D22's design, not a
separate promise this document is making on top of the schema — there is
structurally nothing to revert, because nothing hackathon-specific was
ever built into the core.

## 20. Definition of done

Per the Phase 1 prompt §11, restated as the standard every `PHASE_PLAN.md`
acceptance criterion is held to: a feature is **not** done because a
screen exists, an API route exists, a query returns mock data, or
TypeScript compiles — every one of those was already true of the Phase 0
prototype and Phase 0 found none of it production-real. A feature **is**
done only when:
- the correct actor can perform it (verified by an actual authenticated
  session with that role, not assumed from the RLS policy text),
- unauthorized actors cannot (verified by an actual denied-access test,
  not assumed from the absence of a policy),
- the relevant database invariants hold under concurrency, not just in
  the uncontended happy path (`TEST_STRATEGY.md` §2's explicit concurrent-
  request tests for all six correctness guarantees),
- failure paths are handled (a rejected payment, a lost claim race, a
  stock-out mid-pack all have a defined, tested outcome — not just the
  success path),
- observability exists where the mechanism is correctness-critical
  (§15 — a payment or state-transition failure that doesn't reach Sentry
  is not really "handled"),
- the production path works, not just a local/mocked path — this is why
  every `PHASE_PLAN.md` gate references a real deployed environment or a
  physical device, not a passing local test suite alone.

## 21. Final validation pass

Checking this spec set against the Phase 1 prompt §13's fifteen items:

1. Dossier §24 freeze-checklist items — repository structure
   (`DEPLOYMENT_TOPOLOGY.md`), complete DDL (`DATABASE_SPEC.md`), every
   RLS policy (`RBAC_MATRIX.md`), role→capability matrix (`RBAC_MATRIX.md`
   §2), Edge Function signatures (`API_CONTRACTS.md`), API contracts
   (`API_CONTRACTS.md`), order transition table (`ORDER_STATE_MACHINE.md`),
   payment/refund state rules (§6 above, `API_CONTRACTS.md`), webhook
   idempotency (`API_CONTRACTS.md` `payment_webhook`), inventory
   reservation semantics (D11, `DATABASE_SPEC.md` §6), wallet/promo rules
   (§7 above), runner earnings formula (`DATABASE_SPEC.md` §10 — schema
   present; exact per-delivery amount is a pricing/product decision the
   Phase 1 prompt didn't ask this spec to set, flagged in §L below),
   Realtime channels/payloads (§12, D21), polling intervals/backoff (§13,
   D20), error code catalogue (`API_CONTRACTS.md` §4), loading/error
   states per screen (a UI-implementation-phase concern, not a Phase 1
   architecture concern — out of scope here by design, tracked for
   Phase 3+), analytics event schema (§15), k6 scenario definitions
   (`TEST_STRATEGY.md` §3), acceptance tests per phase
   (`PHASE_PLAN.md`), environment variables/secrets (`SECURITY_MODEL.md`
   §3), deployment topology (`DEPLOYMENT_TOPOLOGY.md`), definition of
   done (§20 above) — **all present**, one item (runner earnings formula
   exact amount) correctly flagged as a deferred product decision rather
   than force-resolved.
2. All six correctness guarantees have an explicit database mechanism —
   §5 above, table format, each with a spec cross-reference. **Verified.**
3. Real payments are represented — §6, D12, D1/D22 confirm this is
   permanent. **Verified.**
4. Event credits are NOT the core currency — D1, D10, D22 all
   independently confirm this; `wallet_ledger_reason` enum has no
   `'event_credit'` value anywhere. **Verified.**
5. The hackathon is represented as launch/acquisition, not core domain —
   §19, D22. **Verified**, and the "after the hackathon" consequence is
   traced explicitly, not just asserted.
6. Venue/table/seat concepts absent from the target architecture — D1,
   D15; grep-equivalent check: no such table, enum, or field appears
   anywhere in `DATABASE_SPEC.md`. **Verified.**
7. Customer/packer/runner/admin permissions explicit — `RBAC_MATRIX.md`
   §2/§3/§5 in full. **Verified.**
8. Every critical mutation has an explicit transaction boundary —
   `API_CONTRACTS.md` §2, every Edge Function entry has a "Transaction
   boundary" field. **Verified.**
9. RLS specified — `RBAC_MATRIX.md` §5, every table. **Verified.**
10. API contracts specified — `API_CONTRACTS.md` in full. **Verified.**
11. Testing gates specified — `TEST_STRATEGY.md`, `PHASE_PLAN.md`'s
    per-phase "Tests"/"Acceptance criteria" fields. **Verified.**
12. Deployment topology specified — `DEPLOYMENT_TOPOLOGY.md`. **Verified.**
13. Environment variables specified — `SECURITY_MODEL.md` §3, including
    the proposed `.env.example` (no real secrets, per instruction).
    **Verified.**
14. Migration strategy from the current prototype specified — §17/§18
    above, D17. **Verified.**
15. Suitable for a general production app, not merely a 30-hour hackathon
    tool — this is what §19 exists to prove explicitly: every mechanism
    in this spec set was designed for the steady-state product first,
    with the hackathon folded in as a campaign, never the reverse.
    **Verified** by construction, not just asserted — no document in this
    set contains hackathon-specific schema, RLS, or state-machine logic
    to check for.

No contradiction was found between documents during this pass requiring
resolution — each canonical document was written against the same
`DECISION_LOG.md` entries and cross-references rather than restating
them, which is what kept them consistent rather than something requiring
a separate reconciliation step. Cross-references were checked;
`RBAC_MATRIX.md` §4's Edge-Function-vs-PostgREST list matches
`API_CONTRACTS.md` §3's function list exactly (16 functions across the
four mutation categories plus `validate_promo`, D31 — no extras or
omissions on either side).

**Phase 1.1 re-verification (added after the correctness review):** the
same fifteen-item check was re-run against the corrected spec set.
Additionally verified: every reference to `orders.runner_id` across
`DATABASE_SPEC.md`, `RBAC_MATRIX.md`, `ORDER_STATE_MACHINE.md`, and
`API_CONTRACTS.md` consistently targets `runners.id` (D28) — no document
was missed. Every reference to the payment flow across the same four
documents plus `SECURITY_MODEL.md` consistently describes the three-phase
design (D24) — no document still describes the original single-
transaction version. The `(orders.status, payments.status)` consistency
table appears once, canonically, in `ORDER_STATE_MACHINE.md` §2.1, and is
referenced (not restated) everywhere else it's relevant
(`DATABASE_SPEC.md` §8, `API_CONTRACTS.md`'s error catalogue, this
document's §6). No remaining contradiction was found.

---

## Final output (per Phase 1 prompt's required format)

**A. Files created/modified.** Phase 1: `docs/engineering/{ENGINEERING_
SPECIFICATION,DECISION_LOG,DATABASE_SPEC,RBAC_MATRIX,ORDER_STATE_MACHINE,
API_CONTRACTS,SECURITY_MODEL,DEPLOYMENT_TOPOLOGY,TEST_STRATEGY,
PHASE_PLAN}.md`, plus `.agent-os/specs/{architecture,data,auth,orders,
payments,inventory,fulfilment,realtime,notifications,security,testing,
deployment}/README.md`. **Phase 1.1 (this correctness review) modified
all ten Phase 1 documents above** (targeted edits, not rewrites — see
each document's inline "Phase 1.1"/"revised" markers for exactly what
changed) **and added** `docs/engineering/PHASE_1_1_CORRECTIONS.md`. No
product code, migration, Edge Function, or UI was written or modified in
either phase — specification only, verified by `git status` showing no
changes under `apps/`, `src/`, or `supabase/` (none of those exist yet
outside the pre-existing, untouched Next.js prototype).

**B. Engineering decisions made.** 32 numbered decisions in `DECISION_
LOG.md` total. Phase 1 (D1–D23): domain resolution (D1), monorepo/
boundaries (D2/D3), Expo version deferral (D4), UUID/enum/money
conventions (D5-D7), role claims (D8), RLS+Edge Function split (D9),
wallet strategy (D10), inventory locking (D11), payment abstraction
(D12), claim locking (D13), delivery code hashing (D14), address/
serviceability model (D15/D16), migration strategy (D17), no cache/no
separate API confirmed (D18/D19), polling/Realtime strategy (D20/D21),
hackathon representation (D22), idempotency (D23). **Phase 1.1 (D24–D32,
this review):** payment transaction phasing (D24), wallet concurrency
locking (D25), promo concurrency locking (D26), reservation lifetime
(D27), runner FK retarget (D28), payments-table redesign/refunds table
(D29), payment/order state consistency (D30), Edge Function mutation
categories (D31), audit log/webhook payload redaction (D32).

**C. Target architecture.** §1 above.

**D. Target database model.** §2 above, full detail `DATABASE_SPEC.md`.

**E. Target RBAC model.** §3 above, full detail `RBAC_MATRIX.md`.

**F. Target order state machine.** §4 above, full detail
`ORDER_STATE_MACHINE.md`.

**G. Critical correctness mechanisms.** §5 above — all six dossier
guarantees plus two additional ones closed in Phase 1.1 (wallet
concurrency, promo concurrency), each with a named database mechanism.

**H. Payment architecture.** §6 above — three-phase design (D24), no
transaction held across gateway I/O, full compensation table in
`PHASE_1_1_CORRECTIONS.md` §4.

**I. Existing frontend reuse plan.** §18 above — design system and
toolchain reused, backend/domain-model code replaced, screens migrated
incrementally per phase, customer/runner surfaces built fresh in Expo.

**J. Phase implementation sequence.** `PHASE_PLAN.md` — 13 phases, P2
through P14, each with objective/inputs/scope/tests/acceptance/gate/
rollback.

**K. Phase 2 gate.** Database exists, migrations clean, RLS tests pass
(`PHASE_PLAN.md` Phase 2).

**L. Remaining genuine open decisions** (not resolved by this spec,
correctly deferred rather than force-resolved — see also `DECISION_LOG.md`'s
own "explicitly deferred" list):
- Exact runner per-delivery earnings formula/amount — a pricing decision,
  not an architecture one; the schema (`runner_earnings.amount`) accepts
  whatever value the eventual formula produces.
- Referral credit exact amounts/limits — dossier §18 names referral as a
  retention lever without specifying economics; `wallet_ledger` supports
  it as-is once decided.
- OTP rate-limit tuning — depends on Supabase's actual default limits at
  the chosen plan tier, a conversation with Supabase, not an architecture
  choice.
- Exact automated auto-pause threshold value for `max_queue_depth` — the
  *mechanism* is fully specified (§11 above); the *number* is an
  operational tuning decision best set from Phase 12's load-test results,
  not guessed here.
- **`promo_redemptions` per-user-limit > 1 enforcement — resolved in
  Phase 1.1** (D26, `PHASE_1_1_CORRECTIONS.md` §6); no longer an open
  item, listed here only to note it was previously flagged and is now
  closed, not silently dropped.
- **(Added Phase 1.1)** Post-delivery goodwill refund — no state
  combination supports `delivered`+`refunded` (`ORDER_STATE_MACHINE.md`
  §2.1); deliberately unmodeled, not silently forbidden or silently
  allowed.
- **(Added Phase 1.1)** Reservation expiry duration (15 minutes, D27) —
  an engineering default, not a measured value.
- **(Added Phase 1.1)** `expire_stale_reservations` scheduling mechanism
  (`pg_cron` vs. Supabase scheduled Edge Function) — mechanically
  equivalent for this spec's purposes, left to Phase 4/5 implementation.

None of the above blocks Phase 2 from starting — each is scoped to a
later phase (`PHASE_PLAN.md`) where it naturally needs an answer, not to
the foundational schema/architecture work this spec gates.
