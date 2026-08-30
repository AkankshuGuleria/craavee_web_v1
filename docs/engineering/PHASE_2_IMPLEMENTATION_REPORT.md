# Phase 2 — Foundation Implementation Report

Covers Phase 2 (Foundation) and Phase 2A (test provenance, RLS failure
analysis, and completion). Companion document: `PHASE_2_TEST_PROVENANCE.md`
(full detail on §5/§7 below — not duplicated here).

**Update:** the app/tooling items left open in §14/§15 below (workspaces,
Store/Console split, Expo scaffold, CI, lint) were completed in Phase 2B —
see `PHASE_2B_IMPLEMENTATION_REPORT.md`. This document is left as-written
for the database/RLS work it actually covers.

**Formal gate: DATABASE EXISTS + MIGRATIONS CLEAN + RLS TESTS PASS — MET.**
Full gate checklist in §14.

---

## 1. Database implementation

Three migrations, applied in order, against a real local Supabase
Postgres 17 instance (not mocked):

| File | Contents |
|---|---|
| `supabase/migrations/0001_init.sql` | Extensions, 4 enum types, 20 spec tables + 3 reference-data tables (`order_transition_rules`, `payment_transition_rules`, `payment_order_consistency_rules`), all FKs/CHECK/UNIQUE constraints, all indexes |
| `supabase/migrations/0002_triggers_and_functions.sql` | `handle_new_user`, `custom_access_token_hook`, `enforce_order_transition`, `enforce_payment_transition`, `check_payment_order_consistency` (deferred constraint triggers), `find_wallet_balance_mismatches` |
| `supabase/migrations/0003_rls_policies.sql` | Helper functions (`auth_role`, `auth_store_id`, `auth_runner_id`), every RLS policy, self-edit-restriction triggers, 3 views (`products_with_availability`, `payments_customer_view`, `payments_admin_view`), all base-table grants |

### Object census (live schema, `information_schema`/`pg_catalog` queried directly)

20 tables, 3 views, 52 indexes, 31 foreign keys, 31 CHECK constraints, 23
primary keys, 12 unique constraints, 5 trigger functions, 3 RLS helper
functions.

### DATABASE_SPEC.md conformance — every required object, checked against the live schema, not "approximately equivalent"

| Spec object | Exists | Exact name | Notes |
|---|---|---|---|
| `profiles` | ✅ | `profiles` | 7 columns; `wallet_balance` cached (D10) |
| `staff_roles` | ✅ | `staff_roles` | 6 columns; `staff_role_store_required` CHECK verified by test |
| `campaigns` | ✅ | `campaigns` | 7 columns |
| `stores` | ✅ | `stores` | 8 columns |
| `zones` | ✅ | `zones` | 6 columns |
| `addresses` | ✅ | `addresses` | 9 columns; block/floor/room structured (D15) |
| `products` | ✅ | `products` | 12 columns; `sale_price_not_above_mrp` verified |
| `inventory` | ✅ | `inventory` | 6 columns; `reserved_not_above_on_hand` verified |
| `orders` | ✅ | `orders` | 22 columns; `runner_id → runners.id` (D28, verified via `pg_constraint`), `reservation_expires_at` (D27), `idempotency_key` UNIQUE NOT NULL |
| `order_items` | ✅ | `order_items` | 7 columns |
| `payments` | ✅ | `payments` | 12 columns; `order_id` UNIQUE (D29, strict 1:1), `gateway_intent_requested_at` claim marker (D24) |
| `webhook_events` | ✅ | `webhook_events` | 6 columns; `(gateway, gateway_event_id)` UNIQUE |
| `wallet_ledger` | ✅ | `wallet_ledger` | 6 columns; `delta_not_zero` CHECK |
| `runners` | ✅ | `runners` | 5 columns; `profile_id` UNIQUE |
| `runner_earnings` | ✅ | `runner_earnings` | 6 columns; `order_id` UNIQUE, partial index for unsettled |
| `promos` | ✅ | `promos` | 11 columns; `uses_count`/`uses_not_above_max` (D26) |
| `promo_redemptions` | ✅ | `promo_redemptions` | 5 columns |
| `audit_logs` | ✅ | `audit_logs` | 7 columns |
| `rate_limit_events` | ✅ | `rate_limit_events` | 4 columns |
| `refunds` | ✅ | `refunds` | 8 columns; `idempotency_key` UNIQUE, `amount > 0` |
| `user_role` enum | ✅ | `user_role` | packer/runner/admin |
| `order_status` enum | ✅ | `order_status` | 9 values, exact order verified against ORDER_STATE_MACHINE.md §1 |
| `payment_status` enum | ✅ | `payment_status` | 5 values |
| `wallet_ledger_reason` enum | ✅ | `wallet_ledger_reason` | incl. `reservation_reversal` (D27) |
| Partial unique, one-live-job-per-runner | ✅ | `idx_orders_one_live_job_per_runner` | verified live: two `assigned` orders for the same runner rejected; a different runner independently succeeds |
| Partial index, reservation expiry | ✅ | `idx_orders_reservation_expiry` | |
| `enforce_order_transition` | ✅ | trigger `trg_enforce_order_transition` on `orders` | exhaustive + curated tests both pass |
| `enforce_payment_transition` | ✅ | trigger `trg_enforce_payment_transition` on `payments` | |
| `check_payment_order_consistency` (D30) | ✅ | constraint triggers `trg_check_consistency_orders`/`_payments`, **deferred** | verified statement-order-independent |
| `handle_new_user` | ✅ | trigger `on_auth_user_created` on `auth.users` | idempotent, no-clobber, verified |
| `custom_access_token_hook` | ✅ | function, registered in `config.toml` | role/`store_id` injection verified directly against the function |
| RLS enabled + forced, every spec table | ✅ | — | verified via `pg_class.relrowsecurity`/`relforcerowsecurity`, all 20 tables |

No spec object was found missing or "approximately" implemented.

---

## 2. RLS implementation

Every table has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
Policies implement `RBAC_MATRIX.md` §5 verbatim. Explicit "zero policy,
zero grant" tables (`staff_roles`, `webhook_events`, `rate_limit_events`,
`promo_redemptions`): confirmed via direct `pg_policies` query, not
assumed.

**Critical finding and fix — full detail in `PHASE_2_TEST_PROVENANCE.md`
§3:** `auth_runner_id()`, a helper used inside `profiles_select`/
`orders_select`/`order_items_select`, was `SECURITY INVOKER` and threw a
hard permission error for roles (e.g. `anon`) lacking a direct grant on
`runners`, instead of gracefully evaluating its branch to false — because
Postgres does not guarantee AND/OR short-circuit evaluation order in RLS
policy expressions. **Fixed by making the function `SECURITY DEFINER`**
(narrowly safe: unconditionally scoped to `auth.uid()`, cannot return
another user's data regardless of caller). **No grant was broadened** —
the fix is entirely inside the function definition. A second, related
finding (not a bug): `anon` genuinely has zero grant on `profiles`,
matching every other customer-scoped table — a test assertion that
assumed otherwise was corrected, not the schema.

### Runner → profile access path (Phase 2A §5, explicit verification)

| Requirement | Verified by | Result |
|---|---|---|
| Runner reads own profile | `06_rls_profiles_and_staff_test.sql` (implicit via `id = auth.uid()` branch, also covered by `profiles_update` tests) | ✅ |
| Runner sees the customer on their own active order | `06_rls_profiles_and_staff_test.sql` test 12 | ✅ |
| Runner cannot see an unrelated customer | `06_rls_profiles_and_staff_test.sql` test 13 | ✅ |
| Runner cannot infer unrelated profiles through joins | Same policy path exercised by tests 12/13; the `EXISTS` subquery is scoped to `orders.runner_id = auth_runner_id()` and `status IN ('assigned','picked_up')` — no join surface exists that isn't already gated by that same condition | ✅ (by construction + test) |
| Runner cannot directly read `staff_roles` | `03_rls_customer_isolation_test.sql` test 7 (customer), `04_rls_runner_packer_test.sql`, and the zero-grant fact verified structurally in `00_schema_smoke_test.sql` test 78 | ✅ |
| Runner cannot manipulate profiles outside `full_name` | `reject_profiles_self_edit_beyond_name` trigger; not runner-specific but applies to every non-admin session including runner — no separate runner bypass exists | ✅ |

---

## 3. Auth infrastructure

`handle_new_user` (idempotent via `ON CONFLICT DO NOTHING`, verified not
to clobber existing profile data on retry — `02_auth_role_infrastructure_
test.sql`). `custom_access_token_hook` (role defaulting to `customer`,
`store_id` injection for staff, existing-claim preservation, EXECUTE
locked to `supabase_auth_admin` only — verified directly against the
function, not just indirectly through RLS behavior). Registered in
`supabase/config.toml`'s `[auth.hook.custom_access_token]`. Phone OTP
enabled (`[auth.sms]`), email signup disabled (phone is the sole method
per SECURITY_MODEL.md §1), local test OTPs configured for dev/CI use only.

**Client cannot assign roles:** `staff_roles` has zero grants and zero
policies for `authenticated`/`anon` — verified structurally (`00_schema_
smoke_test.sql` test 78) and behaviorally, including that even an admin
session cannot write it directly (`05_rls_staff_roles_and_admin_test.sql`
tests 3–4) — the only door is the (not-yet-built, Phase 4+)
`assign_staff_role` Edge Function, matching D8/RBAC_MATRIX.md exactly.

---

## 4. Triggers / functions

5 trigger-bearing functions + 3 RLS helpers, all listed in §1. Notably:
`enforce_order_transition` and `enforce_payment_transition` read their
legal-transition tables as **data** (`order_transition_rules`,
`payment_transition_rules`), not hard-coded `IF` chains, specifically so
tests can be generated from the same table rather than hand-duplicating
it (TEST_STRATEGY.md §2's explicit requirement). `check_payment_order_
consistency` (D30) is implemented as **deferred constraint triggers**
(`AFTER INSERT OR UPDATE ... DEFERRABLE INITIALLY DEFERRED`) on both
`orders` and `payments`, verified to make statement order within one
transaction irrelevant (`09_payment_order_consistency_test.sql` test 3).

---

## 5. Tests

**11 files, 218 assertions, all passing**, reproduced from a clean
`supabase db reset` **twice** (Phase 2A §10 requirement). Full file list,
provenance, and disposition: `PHASE_2_TEST_PROVENANCE.md`.

```
00_schema_smoke_test.sql                  81/81
01_money_and_constraints_test.sql         24/24
02_auth_role_infrastructure_test.sql      14/14
03_rls_customer_isolation_test.sql        14/14
04_rls_runner_packer_test.sql             14/14
05_rls_staff_roles_and_admin_test.sql     10/10
06_rls_profiles_and_staff_test.sql        16/16
07_order_state_machine_curated_test.sql   24/24
08_order_state_machine_exhaustive_test.sql 4/4
09_payment_order_consistency_test.sql      3/3
10_core_constraints_test.sql              14/14
------------------------------------------------
TOTAL                                    218/218  (0 failed, 0 skipped, 0 errors)
```

**A. Tests created during Phase 2 implementation (this session, directly
authored/visible):** `03_rls_customer_isolation_test.sql`,
`04_rls_runner_packer_test.sql`, `05_rls_staff_roles_and_admin_test.sql`,
`08_order_state_machine_exhaustive_test.sql`,
`09_payment_order_consistency_test.sql`, `10_core_constraints_test.sql` —
6 files, 83 assertions.

**B. Previously existing / unrecognized tests** (provenance investigated,
not certain — `PHASE_2_TEST_PROVENANCE.md` §1):
`00_schema_smoke_test.sql`, `01_money_and_constraints_test.sql`,
`02_auth_role_infrastructure_test.sql`,
`07_order_state_machine_curated_test.sql`,
`06_rls_profiles_and_staff_test.sql` — 5 files, 135 assertions
(post-fix). `scripts/run-db-tests.sh` (the test runner itself) falls in
this same unrecognized-but-kept category.

### Environment note: `supabase test db` does not work in this repository

Its bundled `pg_prove` (run in a Docker container) reports zero files
found for a project path containing a space (`/Volumes/T7 Shield/...`),
independent of RLS/schema correctness — confirmed with a raw `docker run
-v` bind-mount test showing the file genuinely isn't visible inside the
container despite existing on the host. Colima mount reconfiguration
(`--mount`, both `virtiofs` and `sshfs` backends) did not resolve it —
same class of exFAT/external-volume passthrough issue already
documented in Phase 0's audit for git. `scripts/run-db-tests.sh` (found
during provenance investigation, already correctly diagnosing and
working around this exact issue) is the verified way to run this suite:
drives each `*_test.sql` through `psql -f` directly against the local
Postgres instance and parses TAP output itself — same assertions, same
real database, no `pg_prove`.

### Test failures found and fixed this phase

1. **Real RLS bug** — `auth_runner_id()` SECURITY INVOKER gap. Full
   trace: `PHASE_2_TEST_PROVENANCE.md` §3.
2. **Test assertion error, not a schema bug** — anon-on-`profiles`
   expectation corrected to `throws_ok`.
3. Several self-inflicted test-authoring bugs caught and fixed while
   writing the 6 authored files (documented for completeness, not
   schema issues): non-hex characters in hand-written test UUIDs;
   `PERFORM` inside a `DO` block silently discarding pgTAP's TAP-output
   row (fixed by collecting loop results into a temp table and asserting
   at the top level); `throws_ok` 3-vs-4-argument confusion causing the
   description string to be treated as an expected error message;
   assuming `authenticated`'s table-level GRANT existence implies a
   permission error rather than an RLS-filtered empty result (and the
   reverse); reusing one fixture runner ID across every iteration of the
   state-machine sweep, tripping the one-live-job-per-runner constraint
   for the wrong reason (test-data collision, not the guarantee itself);
   a payments-table view (`security_invoker = true`) that would have
   required the caller to hold a base-table grant anyway, defeating its
   own purpose — fixed using the same owner-context-view-with-explicit-
   WHERE pattern already used correctly for `products_with_availability`.

---

## 6. Monorepo changes

Directory skeleton exists (`apps/{customer-runner,store,console}`,
`packages/{types,validation,api-contracts,ui}`, `supabase/`,
`load-tests/k6/`, `.github/workflows/`) per `DEPLOYMENT_TOPOLOGY.md` §1.
`packages/types` has real content (§7). **Everything else under `apps/`
and the remaining `packages/` is still an empty directory** — the
existing Next.js prototype (`src/`) has not yet been split into
`apps/console`/`apps/store`, no Expo scaffold exists, `packages/
validation`/`packages/api-contracts` have no content, no CI workflow
files exist, and `next lint`'s brokenness (Phase 0 finding) is not yet
fixed. See §15 (known limitations) — this phase's explicit focus was
test provenance and database correctness (Phase 2A §§1–13), and that work
consumed the available effort; the remaining mechanical scaffolding is
real, tracked, outstanding Phase 2 work, not silently skipped.

---

## 7. Generated types

`packages/types/src/database.ts` generated via `supabase gen types
typescript --local` against the live local schema — 1,316 lines, 28
table/view entries confirmed present including `orders`, `payments`,
`profiles`, `refunds`, `runners`, `staff_roles`. `packages/types/src/
index.ts` re-exports the generated types plus thin convenience aliases
(`Tables<T>`, `Order`, `Payment`, etc.) — no hand-maintained duplicate
schema type exists anywhere, per the explicit instruction. `npm run gen`
inside `packages/types` regenerates against whatever local instance is
running.

---

## 8. Seed data

`supabase/seed.sql` — applies automatically on `supabase db reset`,
verified clean on two consecutive resets. Dev-only, explicitly labeled as
such in the file header. Contents: 1 store, 4 zones (3 serviceable, 1
deliberately paused to exercise that path), 2 campaigns (the hackathon +
a referral campaign, D22 — attribution only, no schema fork), 9 profiles
(4 customers, 1 packer, 3 runners, 1 admin) with realistic names, 2
staff_roles rows, 3 runner rows, 4 structured addresses (block/floor/
room, D15), 24 products across 8 categories, 24 matching inventory rows
(one zeroed for stock-out testing, one low), 2 promos (one hackathon-
attributed wallet-credit code, one evergreen flat-discount code). **Zero
orders, payments, refunds, or webhook_events seeded** — an order is a
live transactional object `create_order` will produce in Phase 4+;
seeding a fake captured payment would itself be exactly the "fake
production payment record" this file is explicitly told not to contain.
No secrets anywhere in the file (phone numbers are obviously-synthetic
`900000xxxx` sequences).

---

## 9. Environment configuration

`.env.example` created at repo root, documenting every variable from
`SECURITY_MODEL.md` §3, categorized `PUBLIC` / `EDGE_FUNCTION_ONLY` /
`CI_ONLY` (no `SERVER_ONLY` variable was identified as needed yet — none
of the current Next.js prototype code reads server-only secrets). No real
credentials anywhere in the file or the repository.

---

## 10. Lint / CI

**Not completed this phase.** `next lint`'s brokenness (Phase 0 finding —
no working ESLint config for the installed Next.js version) is
unresolved. No `.github/workflows/*.yml` files exist yet. This is
explicitly named as outstanding work in §15, not silently passed over.

---

## 11. Commands run (representative, this phase)

```
colima start [--mount variants tried and reverted]
supabase init
supabase start / supabase stop
supabase db reset                       (run 4+ times across this phase)
supabase gen types typescript --local
psql ... -f supabase/migrations/000{1,2,3}_*.sql   (manual isolation tests)
scripts/run-db-tests.sh                 (full suite, multiple times)
docker run --rm -v "<path>:/mnt/tests" alpine ls   (mount-bug isolation)
git status / git log --all -- supabase/tests/ / git ls-files supabase/tests/
```

---

## 12. Deviations from the specification

- **`payments_admin_view`** was added (not in the original Phase 1
  spec) as a companion to `payments_customer_view` once implementing the
  column-restriction requirement revealed that a single `security_
  invoker` view can't cleanly serve both audiences without either
  granting the base table broadly (rejected) or splitting into two
  owner-context views with explicit row-scoping (adopted) — a Phase 2
  implementation-level refinement of D29, not a change to it.
- **Test file numbering** deviates from the exact scheme suggested in
  the Phase 2A prompt (`03_rls_customer_isolation_test.sql`/
  `04_rls_staff_and_runner_test.sql`/etc. as a merged pair) because
  content inspection showed the two provenance lines' overlapping files
  are genuinely complementary, not redundant (`PHASE_2_TEST_PROVENANCE.md`
  §2) — kept as 11 separate files with collision-free numbering instead
  of merging, per the explicit instruction to rename only when it
  matches actual content and to prefer correctness/coverage over a
  cleaner file count.

---

## 13. Warnings

- The exFAT/space-in-path environment issue (Phase 0: git; Phase 2: `supabase
  test db`/`pg_prove`) is now confirmed to affect more than git — any
  future tool that bind-mounts this project directory into a container
  should be assumed at risk until proven otherwise.
- `auth_runner_id()`'s SECURITY DEFINER status is load-bearing for
  correctness, not just performance — a future migration that
  "simplifies" it back to SECURITY INVOKER would silently reintroduce the
  `anon`-session crash (though not a security hole, since `anon` still
  correctly ends up with no access either way — just via a hard error
  instead of a graceful empty result).
- Test file provenance (§5/`PHASE_2_TEST_PROVENANCE.md` §1) could not be
  established with certainty — flagged, not asserted as fact.

---

## 14. Phase 2 gate — exact status

- [x] all intended test files have known provenance/status (§ Provenance doc; certainty not claimed where git provides none)
- [x] no unexplained failing test remains
- [x] all pgTAP tests pass (218/218)
- [x] schema smoke tests pass (81/81)
- [x] RLS positive tests pass
- [x] RLS negative tests pass
- [x] state-machine tests pass (both curated and exhaustive)
- [x] payment consistency tests pass
- [x] migration reset is repeatable (verified twice, deterministic)
- [x] seed works
- [x] generated types work
- [ ] workspaces typecheck — **not yet run; no workspace config exists (§6)**
- [ ] lint passes — **not applicable yet; no working lint config exists (§10)**
- [ ] Store builds — **not applicable yet; `apps/store` has no content (§6)**
- [ ] Console builds — **not applicable yet; `apps/console` has no content (§6)**
- [ ] Expo scaffold validates — **not created yet (§6)**
- [ ] CI foundation works — **no workflow files exist yet (§10)**
- [x] no secrets committed
- [x] no old event/venue business logic remains in the production foundation (the new schema has no `venues`/`tables`/`seats`/`event_credits` — verified by construction, matching D1/D15)

**Formal gate (DATABASE EXISTS + MIGRATIONS CLEAN + RLS TESTS PASS): MET.**
The broader Phase 2 checklist has real, tracked, outstanding items —
app/tooling scaffolding — which are Phase 2 work, not Phase 3 work, and
are not being represented as done.

---

## 15. Known limitations / recommended Phase 2 continuation

1. Split the existing Next.js prototype into `apps/console`/`apps/store`
   per `DEPLOYMENT_TOPOLOGY.md` §2's move plan; retire the fake
   auth/API/db layers per `docs/audit/BACKEND_READINESS.md`.
2. Scaffold `apps/customer-runner` (Expo, current stable SDK resolved at
   scaffold time per D4 — not before).
3. Populate `packages/validation` (Zod schemas from `API_CONTRACTS.md`)
   and `packages/api-contracts` (TS request/response types).
4. Fix `next lint` / add a working ESLint flat config.
5. Add `.github/workflows/` for typecheck/lint/test/build/migration-check
   (this session's pgTAP suite is exactly what a migration-check +
   pgTAP CI job would run, via `scripts/run-db-tests.sh` — the script
   already exists and is verified working).
6. None of the above blocks Phase 3 being *specified* — but per the
   explicit stop condition, Phase 3 implementation (phone OTP UI, catalog,
   `create_order`, payments, runner claim) does not begin until a human
   has reviewed this report.
