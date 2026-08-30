# Phase 2 Test Provenance

Produced during Phase 2A in response to discovering test files in
`supabase/tests/` that were not written in the visible, current part of
this session. This document records the investigation, the evidence
found (and not found), and the final disposition of every file.

## 1. Investigation method and result

```
git status --short                          -> supabase/ untracked (??)
git ls-files supabase/tests/                 -> (no output — nothing tracked)
git log --all --oneline -- supabase/tests/   -> (no output — no commits ever touched it)
```

**`supabase/tests/` has never been committed to git, in any branch.**
This means git history provides **zero** provenance evidence — no
commit, no author, no timestamp of record — for any file in that
directory, recognized or not. This is stated explicitly per the
instruction not to infer ownership from filename alone and to say so
plainly when provenance cannot be established from authoritative
history.

**What filesystem evidence does show:** `stat` modification timestamps
on every `*_test.sql` file, plus `scripts/run-db-tests.sh`, fall inside
one continuous ~27-minute window (17:23–17:50) on 2026-08-29, all within
this session's working directory, with no gap suggesting a different
session or process:

| Time | File |
|---|---|
| 17:23:49 | `00_schema_smoke_test.sql` (unrecognized) |
| 17:24:48 | `scripts/run-db-tests.sh` (unrecognized) |
| 17:25:54 | `01_money_and_constraints_test.sql` (unrecognized) |
| 17:26:31 | `02_auth_role_infrastructure_test.sql` (unrecognized) |
| 17:29:35 | `03_order_state_machine_test.sql` (unrecognized) |
| 17:30:33 | `04_rls_profiles_and_staff_test.sql` (unrecognized) |
| 17:34:36 | `01_rls_customer_isolation_test.sql` (this session's authored work) |
| 17:41:33 | `02_rls_runner_packer_test.sql` (authored) |
| 17:42:46 | `03_rls_staff_roles_and_admin_test.sql` (authored) |
| 17:49:20 | `04_order_state_machine_test.sql` (authored) |
| 17:50:12 | `05_payment_order_consistency_test.sql` (authored) |
| 17:50:55 | `06_core_constraints_test.sql` (authored) |

**Best-evidence conclusion, not a certainty:** the unrecognized files
were created *before* the authored set, in the same working directory,
in the same short window, and — materially — they solve the exact same
rare environment bug (`supabase test db`'s bundled `pg_prove` failing on
this repository's space-containing path, `/Volumes/T7 Shield/...`) with
the same diagnosis and a structurally identical workaround
(`scripts/run-db-tests.sh` drives `psql -f` directly and parses TAP
output itself — precisely what this session later did by hand, file by
file, without initially finding the script). Independently reaching an
identical, fairly specific fix for an obscure bug twice is a low-
probability coincidence for two genuinely unrelated authors. The
far more likely explanation is that this is this same session's own
earlier output, produced before a context summarization this session has
no direct memory of — not the user, and not an unrelated process. This
cannot be stated as certain (git provides no confirming record either
way), so it is presented here as evidence-based judgment, not fact.

**No shell history or process log was available to consult** beyond
filesystem timestamps and content comparison — both were used to the
extent they exist.

## 2. Per-file disposition

| File | Provenance | Purpose | Overlaps | Disposition |
|---|---|---|---|---|
| `00_schema_smoke_test.sql` | Unrecognized (see §1) | Structural introspection — every table/enum/column/constraint/index/trigger/function/RLS-forced-state the spec requires, via pgTAP's `has_table`/`has_column`/`col_is_unique`/etc. helpers | **None** — no file in the authored set does schema introspection at all | **Keep as-is.** Unique, required coverage (Phase 2 gate: "database schema matches DATABASE_SPEC.md") |
| `01_money_and_constraints_test.sql` | Unrecognized | CHECK/UNIQUE enforcement for money, inventory, orders, order_items, payments, refunds, wallet_ledger, profiles, promos, zones | Partial overlap with `10_core_constraints_test.sql` (both cover money-integer, inventory reserve, wallet non-negative, idempotency, refund cap, promo cap, payable math) | **Keep.** Also covers `order_items`, `zones`, positive/valid-row acceptance cases, and duplicate-promo-code rejection that the authored file does not |
| `02_auth_role_infrastructure_test.sql` | Unrecognized | Direct unit tests of `handle_new_user` (creation, idempotent retry, no-clobber) and `custom_access_token_hook` (default/packer/admin role injection, `store_id` claim, claim preservation, EXECUTE privilege lockdown) | **None** — no file in the authored set tests either mechanism directly | **Keep.** Unique, required coverage (Phase 2 gate: "profile trigger works", "JWT role hook infrastructure exists") |
| `03_rls_customer_isolation_test.sql` | This session, authored (visible) | Customer-role RLS: own-data visibility, cross-customer isolation, inventory/staff_roles/order-status write blocks, `payments_customer_view` | Some ground shared with `06_rls_profiles_and_staff_test.sql`'s customer section, from a different angle (this file is order/wallet/payments-centric; that file is profiles/staff_roles-centric) | **Keep** |
| `04_rls_runner_packer_test.sql` | Authored | Runner/packer RLS: claimable-vs-assigned visibility, cross-runner isolation, wallet/payments blocked, packer scope, self-edit column restriction | Some ground shared with `06_rls_profiles_and_staff_test.sql`'s runner section (that file is specifically the runner→profile access path; this file is runner→orders/wallet/payments) | **Keep** |
| `05_rls_staff_roles_and_admin_test.sql` | Authored | `staff_roles` write-blocking for every role including admin; admin's actual allowed direct-write surface (catalog, store config); admin still EF-gated for orders/staff_roles | No other file tests admin's *positive* allowed-write surface this thoroughly | **Keep** |
| `06_rls_profiles_and_staff_test.sql` (was `04_rls_profiles_and_staff_test.sql`) | Unrecognized | `profiles`/`staff_roles` RLS — **including the runner→profile access path** (runner sees the customer profile on their own live job, not otherwise) | Real overlap with `03_rls_customer_isolation_test.sql`/`05_rls_staff_roles_and_admin_test.sql` on the customer/staff_roles basics | **Keep — this is the primary test for Phase 2A §5's runner→profile requirement**, and the file whose failure led to the real bug fix in §3 below |
| `07_order_state_machine_curated_test.sql` (was `03_order_state_machine_test.sql`) | Unrecognized | Order/payment state machine via **hand-picked, realistic sequences** — a full customer→packer→runner actor chain on one order, explicit timestamp-stamping checks, self-release clearing `runner_id`/`assigned_at` | Same mechanism as `08_...exhaustive_test.sql`, different method | **Keep — tests things the exhaustive sweep does not** (realistic multi-step actor sequences, timestamp side effects, self-release field-clearing) |
| `08_order_state_machine_exhaustive_test.sql` (was `04_order_state_machine_test.sql`) | Authored | Order state machine via an **exhaustive, generated sweep** — every row in `order_transition_rules` (positive) and the full `order_status × order_status` cross product minus legal pairs (negative) | Same mechanism as `07_...curated_test.sql`, different method | **Keep — proves the trigger and the rules table can never silently drift apart**, which a curated subset cannot guarantee by construction |
| `09_payment_order_consistency_test.sql` (was `05_...`) | Authored | D30 payment/order consistency — exhaustive sweep of all `order_status × payment_status` combinations against `payment_order_consistency_rules`, plus a statement-order-independence check | `07_...curated_test.sql` has 2 hand-picked D30 cases | **Keep — exhaustive coverage (45 combinations) the curated file's 2 cases don't provide** |
| `10_core_constraints_test.sql` (was `06_core_constraints_test.sql`) | Authored | Money type sweep, inventory constraints, wallet non-negative, **one-live-job-per-runner** (not covered by `01_money_and_constraints_test.sql` at all), idempotency, refund cap, promo cap, payable math | Real overlap with `01_money_and_constraints_test.sql` | **Keep — the one-live-job-per-runner assertion and the money-column-type sweep across the whole schema are not in `01_...` at all** |

## 3. The real bug this investigation found

`06_rls_profiles_and_staff_test.sql` (at the time still numbered
`04_rls_profiles_and_staff_test.sql`) failed with `permission denied for
table runners` at what was then line 96 — the anon-session assertion.
Full trace (reproduced in isolation first, per instruction):

1. **Exact statement:** `select count(*) from profiles` run as `anon`
   with `request.jwt.claims` reset to default (no claims at all).
2. **Principal:** Postgres role `anon` (`current_role`/`session_user`
   confirmed via direct reproduction), no JWT context.
3. **Root cause:** `profiles_select`'s policy calls `auth_runner_id()`
   inside its runner-visibility branch. That helper was `SECURITY
   INVOKER` (the default) and queries `runners`. Postgres's RLS/query
   planner does **not** guarantee left-to-right short-circuit evaluation
   of the policy's `AND`/`OR` expression — the nested `runners` query got
   evaluated even though `auth_role() = 'runner'` was false for this
   session, and `anon` has no grant on `runners` at all (correct,
   intentional — confirmed via `information_schema.role_table_grants`).
4. **What was checked before concluding this** (per the instruction not
   to guess): `current_role`/`session_user` in an isolated reproduction;
   `information_schema.role_table_grants` for `runners` and `profiles`;
   `pg_class.relrowsecurity`/`relforcerowsecurity` for `runners`;
   `pg_policies` for `runners_select` and `profiles_select`; `pg_proc`
   for `auth_runner_id`'s `prosecdef`/`provolatile`.
5. **Fix applied:** `auth_runner_id()` changed to `SECURITY DEFINER` with
   a pinned `search_path` (`supabase/migrations/0003_rls_policies.sql`).
   This is narrowly safe, not a broadened grant — the function's query is
   unconditionally scoped to `profile_id = auth.uid()`, so it can only
   ever return the *calling session's own* runner id, never any other
   user's data, regardless of which role executes it. **No grant on
   `runners` was added for `anon` or any other role** — the fix is
   entirely inside the function definition, matching the explicit
   instruction to never fix an RLS test by broadening a policy or grant.
6. **Second, independent finding from the same investigation:** after
   the fix, the *same* anon query failed again, this time with
   `permission denied for table profiles` — revealing that `anon`
   genuinely has zero grant on `profiles` too, which is the **correct,
   intended** state (no other customer-scoped table grants `anon`
   anything either, and RBAC_MATRIX.md never lists `anon` against
   `profiles`). The test's original assertion (expecting a graceful
   0-row result) was based on a wrong premise. **The test was corrected**
   to `throws_ok('42501', ...)`, matching the same pattern already
   established and used correctly elsewhere in the authored files — the
   schema was not weakened to fit the old assertion.

Both changes are minimal, targeted, and increase confidence in the
existing design rather than loosen it. Full suite result after both
fixes: **11/11 files, 218/218 assertions, green, reproduced twice from a
clean `supabase db reset`.**
