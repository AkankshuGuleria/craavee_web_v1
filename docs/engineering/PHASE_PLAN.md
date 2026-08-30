# Implementation Phase Plan

Thirteen phases, P2–P14 (P0/P1 are the dossier's own product-roadmap
phases from `docs/audit/`'s Phase 0 work and this Phase 1 spec itself —
numbering continues from there, not restarted). Sequence follows the
Phase 1 prompt's suggested order; dependency analysis below confirms it
holds, with two adjustments noted where a strict reading of the prompt's
order would create a false dependency.

Every phase objective/scope references the canonical spec document for
detail rather than re-deriving it — this document is the sequencing and
gating layer, not a restatement of `DATABASE_SPEC.md`/`API_CONTRACTS.md`/
etc.

---

## Phase 2 — Foundation

**Objective.** Stand up the monorepo, Supabase project(s), and the full
schema with RLS, with nothing else built on top yet.
**Inputs.** This spec set (`DATABASE_SPEC.md`, `RBAC_MATRIX.md`,
`DEPLOYMENT_TOPOLOGY.md`), founder confirmation that Supabase project
creation (billing) is authorized.
**Scope.** Monorepo scaffold (`DEPLOYMENT_TOPOLOGY.md` §1) with empty
`apps/*` shells; three Supabase projects (dev/staging/prod); migration
`0001_init.sql` implementing all of `DATABASE_SPEC.md`; every RLS policy
in `RBAC_MATRIX.md` §5; the `handle_new_user` trigger and Custom Access
Token Auth Hook (`SECURITY_MODEL.md` §1) — auth *schema* wiring, not yet
a real sign-in UI; CI pipeline skeleton (`DEPLOYMENT_TOPOLOGY.md` §3)
running typecheck/lint/migration-check on an otherwise-empty codebase.
**Tests.** Full pgTAP suite for every RLS policy and CHECK constraint;
migration applies cleanly to a fresh database and is idempotent
(`supabase db reset` succeeds repeatedly in CI).
**Acceptance criteria.** `supabase db push` succeeds against all three
environment tiers; every RLS policy has a passing pgTAP test proving both
the allowed and denied case (a policy with only an "allowed" test isn't
proven).
**Gate (verbatim from the prompt).** Database exists, migrations clean,
RLS tests pass.
**Rollback.** Trivial — no user-facing surface exists yet; a bad migration
is fixed by amending it (no production data to preserve at this phase).

---

## Phase 3 — Authentication + live catalog

**Objective.** Real phone-OTP sign-in, deployed, with the customer
catalog reading from the live database.
**Inputs.** Phase 2's schema + auth hook; `apps/customer-runner` Expo
scaffold created (D4 — SDK version resolved *now*, at this phase, not
earlier).
**Scope.** Phone OTP sign-in screen (customer route group only — runner
routing gate exists in code but has nothing to route to yet); catalog
screen reading `products`/`inventory` via RLS-gated PostgREST, replacing
`src/lib/products.ts`'s static array entirely (`DEPLOYMENT_TOPOLOGY.md`
§2); `apps/store`/`apps/console` skeletons with auth-gated shells (no
real operational screens yet — just proving the same auth model works
for staff sign-in).
**Tests.** Integration test: sign-in issues a JWT with the correct
default `role` claim absence (customer); E2E: catalog renders real
seeded product data, not mock data.
**Acceptance criteria.** A real phone number completes OTP sign-in on a
physical device (not just simulator) and sees the live catalog.
**Gate (verbatim from the prompt / dossier §20 day 1–6 gate).** Real
phone OTP signup works and a catalog renders from the live database,
deployed.
**Rollback.** Feature-flag the new auth screen behind the still-mocked
version if OTP delivery proves unreliable in testing — do not launch
Phase 4 work on an unverified auth foundation.

---

## Phase 4 — Order creation + inventory correctness

**Status: COMPLETE (2026-08-30).** Report:
`docs/engineering/PHASE_4_IMPLEMENTATION_REPORT.md`. `create_order` (Phase
A real, Phase B/C against a mock gateway adapter),
`expire_stale_reservations`, `validate_promo`, cart + structured address
+ checkout + order-confirmation UI. pgTAP 264/264, 54 order integration
tests (genuine `Promise.all` concurrency), typecheck/lint/build green.

**Objective.** `create_order` fully implemented; overselling and
idempotency guarantees verified under real concurrency.
**Inputs.** Phase 3's authenticated customer + live catalog; address
capture UI (structured campus geography, `DATABASE_SPEC.md` §5) — this
phase is where addresses first become real, since `create_order` needs
one.
**Scope.** `create_order` Edge Function (`API_CONTRACTS.md`) — **Phase A
in full** (validation, fixed-order locking, pricing, inventory
reservation, wallet debit, promo redemption, `orders`+`order_items`+
`payments` row creation), plus Phases B/C wired against a **mock gateway
adapter** (D12's abstraction is what makes this possible — Phase 5 swaps
the mock for a real Razorpay/Cashfree adapter behind the same interface,
nothing else changes). A fully wallet-covered order (`payable=0`) is
fully real in this phase, including its gateway-free `confirmed`
transition, since it never touches the mock/real adapter distinction at
all. `expire_stale_reservations` is also built here (D27) — it depends
only on Phase A's `reservation_expires_at`, not on a real gateway, so
there's no reason to defer it to Phase 5. Cart UI (can reuse the existing
repo's cart *UX patterns*, not its localStorage-only implementation —
cart state may still be client-local until checkout, per dossier's own
architecture, but the order itself is server-created); address capture
screen (zone/block/floor/room, D15).
**Tests.** All of `TEST_STRATEGY.md` §2 guarantees #1 and #3 (duplicate
orders, overselling) and §2.1 cases 1–2c (wallet concurrency, promo
concurrency — D25/D26), including the concurrent-request integration
tests specifically, not just sequential ones. `expire_stale_reservations`
tested against orders left in `created` past their `reservation_
expires_at` with the mock gateway never asked to respond.
**Acceptance criteria.** Two concurrent requests for the last unit of a
SKU: exactly one succeeds. A double-submitted identical request: exactly
one order. Two concurrent wallet-spending or promo-redeeming requests:
exactly the correct number succeed, never more. An order left unpaid past
its reservation window is swept to `payment_failed` with inventory/wallet
released.
**Gate.** Orders can be created transactionally, overselling/idempotency/
wallet-concurrency/promo-concurrency tests pass, and the reservation-
expiry sweep correctly releases an abandoned order's holds.
**Rollback.** `create_order` is net-new — no existing behavior to
preserve; a bug here blocks Phase 5, doesn't corrupt anything already
shipped.

---

## Phase 5 — Payments + refunds

**Status: COMPLETE (2026-08-30), awaiting human review.** Report:
`docs/engineering/PHASE_5_IMPLEMENTATION_REPORT.md`. Delivered: migration
`0005_payment_webhook_refunds.sql` (`process_payment_webhook` +
`process_refund` plpgsql, D36); real **Razorpay** adapter
(`_shared/gateway/razorpay.ts`, D37) behind the unchanged D12 interface +
a production-safety `getGateway()` factory; Edge Functions
`supabase/functions/{payment_webhook,refund}`; pgTAP
`12_payment_webhook_refund_test.sql` (+50) → total **314**; integration
`payment.integration.test.ts` (**29/29**, genuine `Promise.all`
concurrency + the §19 security matrix + §20 A–O); Deno
`gateway.test.ts` (8/8 — production-safety branching + real HMAC).
Decisions D36/D37/D38. **External blocker unchanged:** live-sandbox
verification + production KYC need real `rzp_test_`/`rzp_live_` keys not
provisioned in this environment — the adapter is verified by
deterministic mock fault-injection + direct unit tests of the real
HMAC/parse code (D37, report §2/§14).

**Objective.** Real money moves, correctly, with a working refund path.
**Inputs.** Phase 4's order creation; **gateway KYC must be cleared by
this point** — this is the phase most exposed to the external,
unpredictable-timing risk flagged in `docs/audit/PHASE_0_REPOSITORY_
AUDIT.md` blocker #3; if KYC is still pending when Phase 4 completes,
Phase 5 is blocked on an external dependency, not an engineering one, and
that should be surfaced explicitly rather than worked around.
**Scope.** Real gateway adapter (D12) for whichever of Razorpay/Cashfree
cleared KYC, replacing Phase 4's mock behind the same interface — Phase
A/B/C's control flow (`create_order`) does not change, only which
adapter Phase B calls; `payment_webhook` with signature verification,
including the late-capture reconciliation branch (D30 — an order already
`payment_failed`/`cancelled` by the time a real webhook arrives is a
realistic scenario worth testing here, not just a theoretical one);
`refund` Edge Function with the `refunds` table + idempotency key (D29);
checkout UI wired to the gateway's hosted checkout/SDK.
**Tests.** `TEST_STRATEGY.md` §2 guarantee #2 (duplicate captures,
including the literal same-webhook-twice test) and §2.1 cases 3–9
(gateway timeout/retry/duplicate-intent, late webhook after expiry,
duplicate refund, invalid state combinations); a real ₹1 payment,
end-to-end, in the gateway's test mode; refund end-to-end.
**Acceptance criteria.** A real small payment completes, webhook
confirms it (order reaches `confirmed`), a duplicate webhook delivery is
provably a no-op, a refund actually returns money (test-mode) or wallet
credit, a simulated gateway timeout leaves the order safely resumable,
and a late capture against an already-expired order auto-refunds to
wallet without resurrecting the order.
**Gate (verbatim from the prompt, satisfied by the above).** Real small
payment succeeds, webhook confirms it, duplicate webhook is harmless,
refund works.
**Rollback.** Payments stay in gateway test mode until this gate is
independently re-verified in each environment tier before any production
key is activated — no "soft launch" with live keys before this gate
passes.

---

## Phase 6 — Store fulfilment

**Objective.** Orders flow through the packer workflow correctly.
**Inputs.** Phase 4's orders now reliably reaching `confirmed`.
**Scope.** `mark_packed`, `mark_stock_out` (`API_CONTRACTS.md`); packer
queue UI in `apps/store` (can reuse the existing repo's `/packing` visual
design, rebuilt against real data — `DEPLOYMENT_TOPOLOGY.md` §2).
**Tests.** Integration: `mark_packed` correctly consumes reservations;
`mark_stock_out` correctly issues a partial refund and leaves the order
continuing toward `packed` (per `ORDER_STATE_MACHINE.md`'s "stock-out is
not a state transition").
**Acceptance criteria.** An order flows `confirmed → packed`; a stock-out
mid-pack correctly refunds the affected line without cancelling the
whole order.
**Gate.** Order flows through the packer workflow.
**Rollback.** Packer UI is additive to what Phase 4/5 already ships —
disabling it just means orders sit in `confirmed` (visible, not lost).

---

## Phase 7 — Runner workflow

**Objective.** Claim, pickup, and delivery-code verification all work
under real concurrency.
**Inputs.** Phase 6's `packed` orders.
**Scope.** `claim_job`, `release_job`, `mark_picked_up`, `verify_
delivery_code`, `mark_delivery_failed` (`API_CONTRACTS.md`); runner route
group in `apps/customer-runner` (online/offline toggle, job queue, active
job screen).
**Tests.** `TEST_STRATEGY.md` §2 guarantees #4 and #5 (double assignment,
one-live-job), including concurrent-claim integration tests; delivery
code rate-limiting test (6th attempt within the window is rejected
regardless of correctness).
**Acceptance criteria.** Two runners racing to claim the same order:
exactly one succeeds. A runner attempting a second claim while one is
live: rejected. Delivery completes only on correct code.
**Gate (verbatim from the prompt).** Runner claims correctly, one-live-
job guarantee passes, delivery code verifies.
**Rollback.** Runner app is a separate route group from customer —
shipping it broken doesn't affect the customer ordering path already
live from Phase 4/5.

---

## Phase 8 — Realtime + notifications

**Objective.** Staff surfaces update live; customers reliably see order
progress.
**Inputs.** Phases 4–7's full order lifecycle now producing real state
changes to broadcast/poll.
**Scope.** Realtime channels per `DECISION_LOG.md` D21 for Store/Runner/
Console; customer polling per D20; `expo-notifications` wiring for the
event list in the Phase 1 prompt §7.17 (order confirmed/packed/assigned/
picked up/delivered/payment failure/stock-out).
**Tests.** Realtime channel authorization test (a store-A packer cannot
subscribe to store-B's channel); notification-failure path doesn't block
order progress (notifications are never the system of record — `orders`
table state is authoritative regardless of push delivery success).
**Acceptance criteria.** A packer sees a new order appear on `/packing`
without a manual refresh; a customer's tracking screen updates within one
polling interval of a real status change; a failed push doesn't corrupt
or block any order state.
**Gate.** Staff surfaces update live and customers reliably see order
progress.
**Rollback.** Realtime/notifications are additive UX on top of an
already-correct backend (Phases 2–7) — disabling either degrades UX, not
correctness.

---

## Phase 9 — Admin/Console

**Objective.** An admin can operate the entire store without manual
database intervention.
**Inputs.** All prior phases — Console is the operational surface over
everything built so far.
**Scope.** Live order board, catalog/pricing CRUD, inventory view,
customer/runner management, promos CRUD, refund UI (wrapping the Phase 5
`refund` function), reassignment UI (wrapping `admin_reassign`), store
hours/pause/queue-threshold config, audit log viewer, CSV export, metrics
dashboard (dossier §22 targets).
**Tests.** E2E covering every capability in `RBAC_MATRIX.md`'s admin row;
a manual "run the whole store for an hour using only the console" dry run
by the founder/operator, not just automated tests — this phase's gate is
explicitly about operational sufficiency, which automated tests alone
under-verify.
**Acceptance criteria.** Every admin capability listed in `RBAC_MATRIX.md`
§2 is reachable through the Console UI, not just the API.
**Gate (verbatim from the prompt).** Admin can operate the entire store
without database manual intervention.
**Rollback.** Console gaps mean falling back to direct (service-role,
founder-only) SQL for that one operation — acceptable as a stopgap for a
single missing admin feature, not acceptable as the plan for launch.

---

## Phase 10 — Mobile packaging

**Objective.** Customer and runner apps run as real installs on physical
devices, not just Expo Go/simulator.
**Inputs.** Phases 3–8's Expo app fully functional in development.
**Scope.** EAS Build configuration, TestFlight submission, Play internal-
test-track submission (per dossier §16's distribution plan — 12 testers/
14 days for Play, which should start **as early as possible**, likely
overlapping earlier phases in practice even though it's sequenced here
for narrative clarity — see the note in §"Adjustments" below), PWA/web
build via Vercel.
**Tests.** Manual device testing across a representative Android/iOS
device set; EAS build succeeds in CI.
**Acceptance criteria.** A real device (not simulator) installs the app
via TestFlight/Play internal track/direct APK and completes a full order
as a customer, and a full job as a runner.
**Gate (verbatim from the prompt).** Customer and runner Expo builds run
on physical devices.
**Rollback.** PWA/web build (already deploying via Vercel from earlier
phases, since Expo web output is continuously deployable) remains the
fallback distribution channel if native builds slip — matches dossier
§16's "PWA is primary, native is parallel, launch doesn't depend on
either" framing.

---

## Phase 11 — Observability + analytics

**Objective.** Errors and business events appear correctly across every
surface.
**Inputs.** A functioning full-stack app from Phases 2–10 to instrument.
**Scope.** Sentry across all four apps + Edge Functions; PostHog event
schema (Phase 1 prompt §7.24's event list: install/open, first order,
checkout started, payment success/failure, order status transitions,
delivered, reorder, promo redeemed); campaign attribution surfaced in
PostHog (D22 — the hackathon cohort must be identifiable as a campaign
dimension on these events, not a separate event taxonomy).
**Tests.** A deliberately-thrown test error appears in Sentry within
expected latency; a test event fires in PostHog with correct campaign
attribution.
**Acceptance criteria.** Every event in the Phase 1 prompt's §7.24 list
fires correctly in a manual end-to-end walkthrough; a forced Edge
Function error appears in Sentry with a usable stack trace.
**Gate.** Errors and business events appear correctly.
**Rollback.** Observability gaps are not launch-blocking in isolation but
are treated as a hard prerequisite for Phase 12 (you cannot verify load
test results you can't observe) — this phase's completion gates Phase 12
starting, per the dependency, not per an arbitrary sequencing choice.

---

## Phase 12 — Load + security verification

**Objective.** The system holds up at 2× launch-day peak load, and the
threat model in `SECURITY_MODEL.md` is verified, not just documented.
**Inputs.** A fully observable (Phase 11), fully functional (Phases 2–10)
system.
**Scope.** k6 scripts implementing `TEST_STRATEGY.md` §3's scenarios
(first real implementation of the k6 layer — the spec existed since
Phase 1, the scripts are written here); a focused security review pass
against `SECURITY_MODEL.md` §2's threat table, verifying each mitigation
is actually in place (not just designed).
**Tests.** The full 1,600-VU k6 run against a staging environment
configured to mirror production capacity.
**Acceptance criteria.** All `TEST_STRATEGY.md` §3 thresholds pass; the
concurrent-purchase-contention scenario shows zero oversold orders; no
connection pool exhaustion.
**Gate (verbatim from the prompt).** 1,600 VU test passes agreed
thresholds.
**Rollback.** A failed load test blocks Phase 13, not a production
incident — this is exactly why the phase exists before the live dry run,
per dossier §14's "verify... anything that breaks at 2x would have broken
at 1x."

---

## Phase 13 — Live dry run

**Objective.** Real users, real money, real campus network conditions,
before the actual launch event.
**Inputs.** Phase 12's passed load test; all legal/operational blockers
from `docs/audit/PHASE_0_REPOSITORY_AUDIT.md` (gateway KYC, university
permission, FSSAI, entity/bank account) resolved — this phase cannot run
with real payments if any of those are still open.
**Scope.** No new code — this phase is operational rehearsal, matching
dossier §21's launch-day runbook structure at smaller scale.
**Tests.** 25+ real users complete real orders with real payment, on the
actual campus network (not office wifi) — per the Phase 1 prompt's gate
wording exactly.
**Acceptance criteria.** All 25+ dry-run orders complete `delivered`
correctly; any real-world failure (network, OTP delivery, gateway
latency) surfaces here, not on launch night.
**Gate (verbatim from the prompt).** 25+ real users successfully complete
the flow under real campus network conditions.
**Rollback.** If the dry run surfaces a blocking issue, launch date slips
rather than shipping with a known-broken flow — this is the entire
purpose of running a dry run separately from the actual launch event.

---

## Phase 14 — Production freeze

**Objective.** No new features; only fixes for issues found in Phase 13,
until launch.
**Inputs.** Phase 13's dry-run results.
**Scope.** Bug fixes only, scoped strictly to what Phase 13 surfaced;
final go/no-go review against every gate from Phases 2–13.
**Tests.** Whatever Phase 13 found reproduced and fixed, then re-verified
by a targeted re-run of the relevant Phase 13 scenario (not a full
25-user re-run for every small fix, unless the fix touches the order/
payment core).
**Acceptance criteria.** Every prior phase's gate still holds after any
freeze-period fixes (a fix that touches `create_order`, for instance,
re-runs Phase 4's concurrency tests before merge, even during freeze).
**Gate.** Founder sign-off that launch can proceed — the only phase gate
in this plan that is a human decision rather than an automated/measurable
condition, appropriately, since it's the actual launch decision.
**Rollback.** N/A — this is the terminal phase before the dossier's own
launch-day runbook (`docs/audit/` Phase 0 findings referenced the
dossier's §21 runbook; that document, not this one, governs launch night
itself).

---

## Adjustments to the prompt's suggested sequence (with reasoning, per this document's instruction to justify deviations)

1. **Play Store closed-test enrollment (dossier §16: 12 testers, 14 days)
   should start as early as Phase 3–4**, not wait for Phase 10, because
   its lead time is fixed and external — sequencing it at Phase 10 in
   the phase *plan* doesn't mean waiting until Phase 10 to *start* the
   clock on it. This mirrors the Phase 0 audit's finding that operational/
   external items (gateway KYC, university permission) run on a parallel
   track with no slack, not serially after engineering phases. No schema/
   architecture change results from this — it's a project-management
   note, flagged here rather than silently assumed.
2. **Phase 5 (Payments) is explicitly gated on an external dependency**
   (gateway KYC) in a way the original prompt's phase list states as pure
   engineering sequencing. This is called out rather than smoothed over,
   because it's a genuine risk to the mid-September date identified
   already in `docs/audit/PHASE_0_REPOSITORY_AUDIT.md` blocker #2 — the
   phase plan should surface it again here, not just once in the audit.
3. **Phase 1.1 correction (`PHASE_1_1_CORRECTIONS.md`) did not change the
   phase order.** The payment transaction redesign (three-phase `create_
   order`, D24) shifted *where inside Phase 4 vs. Phase 5* certain work
   happens — Phase 4 now builds `create_order`'s full Phase A plus a
   mock-gateway-backed Phase B/C, and `expire_stale_reservations` moved
   earlier (into Phase 4, since it only depends on Phase A) rather than
   waiting for Phase 5's real gateway — but the *dependency chain itself*
   (schema → auth+catalog → orders → payments → fulfilment → ...) is
   unchanged, because Phase 4's mock-adapter approach was always
   implied by D12's gateway-agnostic contract even before Phase 1.1 made
   the phasing explicit. No phase was reordered, added, or removed.

No other deviations from the prompt's suggested sequence were found to be
necessary — the dependency chain (schema → auth+catalog → orders →
payments → fulfilment → runner → realtime → admin → mobile → observability
→ load → dry run → freeze) holds up under scrutiny.
