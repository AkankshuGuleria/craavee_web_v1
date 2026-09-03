# Phase 10A — Deployment, Data Safety & Staging Validation

**Branch:** `feat/deployment-data-safety-10a`
**Base `main`:** `c5cc663c13bcf327852d112deb43a958ad9f0c70`
**Date:** 2026-09-03

Evidence levels are kept distinct throughout and never merged:
**IMPLEMENTED** · **LOCAL** · **CI** · **STAGING** · **BROWSER** ·
**IOS SIMULATOR** · **EXTERNAL** · **PRODUCTION**.

---

## 1. Ownership verification — VERIFIED

| Check | Finding |
|---|---|
| Repository | `Rexy-5097/craavee_web_v1` (transfer confirmed) |
| Owner / `gh` identity | both **`Rexy-5097`** (Soumyadeb Tripathy, id 177911845) |
| Permission | **ADMIN**, `viewerCanAdminister: true` |
| Supabase org | **`Rexy-5097's Org`** — the same person |
| Visibility | **PUBLIC** (relevant to secret handling, §13) |

The GitHub/Supabase identity split that blocked earlier planning is
resolved. The local remote URL was updated from the pre-transfer path.

**Unrelated projects untouched.** `sb1-xccrwcrc` ×2, `FurnitureOps` and
`aaroh-dev` appeared in listings only — never linked, migrated, dumped or
modified. No AdityaNet or Cartograph project exists in this org.

## 2. Phase 9 merge — VERIFIED (merged this session, on explicit authorisation)

| PR | Result |
|---|---|
| #16 Phase 9A | **MERGED** → `2a2cf6e` |
| #17 Phase 9B | retargeted to `main`, **MERGED** → `95205d8` |
| #18 Phase 9C audit | **MERGED** → `c5cc663` |

`main` migration chain is now **`0001 → 0012`**, working tree clean.

## 3. Environment topology — IMPLEMENTED

See `RUNBOOK.md` §2 for the full matrix.

| | LOCAL | STAGING | PRODUCTION |
|---|---|---|---|
| Supabase | Docker | **`craavee-staging`** `awahemlbgmymahpvhczk` | **does not exist** |
| Region | — | **ap-south-1** | — |
| Web | localhost | **not deployed (no Vercel access)** | — |
| Secrets | none | `CRAAVEE_ENV=staging` only | — |
| Gateway | mock (env-supplied) | **fails closed** | — |

## 4. Staging project — STAGING / VERIFIED

`craavee-staging`, ref `awahemlbgmymahpvhczk`, **ap-south-1**,
`ACTIVE_HEALTHY`, created on the **free plan** per the owner's decision.
It is not production and is not an unrelated project.

## 5. Recovery project — STAGING / VERIFIED

`craavee-recovery`, ref `izqhydtwpucrovnrunly`, ap-south-1,
`ACTIVE_HEALTHY`. Separate from staging; restore target only.

## 6. Plan / capability — PARTIALLY UNVERIFIED

| Capability | Status |
|---|---|
| Logical dump + restore | **VERIFIED** (§10–§12) |
| pg_cron | **VERIFIED** — 1.6.4 installed and executing |
| Platform physical backups | **UNVERIFIED** |
| **PITR** | **UNVERIFIED — not claimed** |
| Plan tier | **REQUIRES OWNER VERIFICATION** — the CLI exposes no billing surface |

Projects were created on the free plan as authorised, so platform PITR
should be assumed absent until the dashboard says otherwise. The runbook
promises only what was exercised.

## 7. Deployment pipeline — IMPLEMENTED, not yet CI-run

`.github/workflows/deploy-staging.yml`. Triggers on push to `main`
touching `supabase/**`, plus manual dispatch. **No `pull_request`
trigger**, so a fork PR cannot reach the credentials.

- `environment: staging` — secrets are environment-scoped, not repo-wide
  (repo-level secret count: **0**).
- `permissions: contents: read` only.
- The credential is a **database URL, not an account access token** — it
  can migrate one database and cannot create, pause, bill or reconfigure
  a project.
- Fails closed on a missing secret, and **refuses any project ref other
  than the staging one**.
- Prints COMMIT SHA / ENVIRONMENT / SUPABASE PROJECT / TRIGGER before
  acting, then MIGRATION RESULT and HEALTH CHECK.

`ci.yml` and `database.yml` gained explicit `permissions: contents: read`
blocks.

**Not yet demonstrated by an actual CI run** — the workflow lands with
this PR and first executes on the merge to `main`. What it does was
executed by hand against the same project with the same commands (§8).

## 8. Migration deployment — STAGING / VERIFIED

`supabase db push` applied **0001 → 0012** to real staging. Verified by
querying the database, not by trusting the CLI:

```
supabase_migrations.schema_migrations = 0001..0012
tables 26 · views 4 · functions 89 · policies 39 · triggers 14 · indexes 60
RLS enabled 23 · FORCE 20 · without RLS: the 3 published rules tables
extensions: citext, pg_cron 1.6.4, pg_stat_statements, pgcrypto, plpgsql,
            supabase_vault, uuid-ossp
```

RLS 23/FORCE 20 reproduces the audit's S2 finding on real infrastructure.

One cosmetic warning during push (`failed to cache migrations catalog`,
a pg-delta SSL cert path inside the CLI's container). It affects a
caching step only; every migration applied and the ledger confirms it.

**All 21 Edge Functions deployed and ACTIVE.** Two things were required
and are now in the runbook: `--use-api` (the Docker bundler fails on this
host, §14) and `--import-map supabase/functions/deno.json` (without it
the server-side bundler cannot resolve `@supabase/supabase-js` and every
function 400s).

## 9. pg_cron — STAGING / VERIFIED, including execution

```
jobid 1 | craavee-expire-stale-reservations | * * * * * |
  select public.expire_stale_reservations(); | database postgres | active t

cron.job_run_details: runid 1, status succeeded, "1 row",
  19:31:00.173787+00 → 19:31:00.191738+00
```

Not merely scheduled — **observed executing successfully**. Both sweeps
the audit asked about are this one function (it expires the reservation
*and* fails the payment). Failure would be observable in
`job_run_details`, and the deploy workflow now fails the build if the job
is missing.

**Confirmed on real infrastructure: `cron.job` contains exactly one job.**
The audit's finding that nothing schedules `dispatch_notifications` is
now proven rather than inferred. Fixing it is Phase 10B.

## 10. Backup — STAGING / VERIFIED (logical)

```
supabase db dump --linked -p ***                        → schema.sql 202,544 B
supabase db dump --linked --data-only --use-copy -p *** → data.sql    63,222 B
supabase db dump --linked --role-only -p ***            → roles.sql    1,075 B
```

The data dump covers `public`, `auth` (including `auth.users`) and
`storage`, and begins `SET session_replication_role = replica`.

The local `pg_dump` is 14.x and cannot dump a PG 17 server; the CLI runs a
matching 17.6 pg_dump in Docker. Recorded in the runbook so the next
person does not lose an hour to it.

**Not yet scheduled, not off-machine.** Frequency, retention, storage
location, RPO/RTO and recovery ownership are all **OWNER DECISION** and
deliberately left unstated rather than invented.

## 11. Restore — STAGING / VERIFIED (real, not a dry run)

`craavee-staging` → dump → **`craavee-recovery`** → restore → validate.
Roles, schema and data restored with **zero errors** (one harmless
`ALTER ROLE ... log_min_messages` permission error, a Supabase-managed
parameter). Production was never touched; the source was never restored
over.

## 12. Restore validation — STAGING / VERIFIED

**All 51 measured values identical between source and restored.**

| Group | Result |
|---|---|
| Row counts, 26 public tables + `auth.users` (23) | identical |
| Wallet balance total | **47,000 paise** both sides |
| Ledger delta total / rows | **47,000** / **9** both sides |
| `wallet_balance` ≠ Σ ledger | **0** both sides |
| Orphan ledger rows | **0** |
| Payments total / refunded | 11,000 / 0 both sides |
| Orphan payments / order_items / refunds | **0 / 0 / 0** |
| Inventory on-hand / reserved | 700 / 7 both sides |
| `qty_reserved > qty_on_hand` | **0** |
| MD5 over profiles, wallet_ledger, orders, order_items, payments, inventory, audit_logs, runners, staff_roles | **all 9 identical** |
| Policies / functions / RLS tables / indexes | 39 / 89 / 23 / 60 — all match |

### 12.1 Two real gaps the drill found

Both would have been invisible without actually restoring.

**a) `auth.users.on_auth_user_created` is not carried by a logical dump.**
Trigger count came back 14 vs 13. The missing one creates the `profiles`
row for every new sign-in. Existing data restored perfectly — but **new
sign-ups would silently have got no profile**. `handle_new_user()` itself
survives (it is in `public`). Re-creating the trigger restored parity
(14 = 14), and a fresh `auth.users` insert then produced a `profiles` row.
Now in the runbook **and asserted on every staging deploy**.

**b) pg_cron jobs are not carried either.** `cron.job` in the restored
database: **0**. A recovered database would look healthy and quietly stop
expiring reservations. Re-schedule step added to the runbook.

## 13. Environment separation — VERIFIED

| Invariant | Evidence |
|---|---|
| Staging ≠ production | production does not exist; workflow hard-refuses any ref but `awahemlbgmymahpvhczk` |
| Secrets scoped | repo-level secrets **0**; `SUPABASE_DB_URL` + `SUPABASE_PROJECT_REF` on the **staging environment** |
| Production gated | `production` environment created with **required_reviewers** + protected-branches-only |
| `main` protected | required checks `build-and-test`, `db-test`; force-push and deletion disabled (`enforce_admins: false` keeps the owner from being locked out) |
| Fork PRs | the deploy workflow has no `pull_request` trigger; environment secrets are unreachable from one |
| No service-role key in a client bundle | apps read only `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` |
| Mock gateway cannot activate | **proven on staging** — a non-wallet order returns `PAYMENT_SETUP_FAILED` |

### 13.1 A real defect found and fixed

`supabase/config.toml` declared `[edge_runtime.secrets]
CRAAVEE_ALLOW_MOCK_CONTROL = "1"` as a local convenience. It is not
local: **`supabase secrets set` pushes every key in that block to the
linked remote project**. Setting one secret reported `count: 2` and the
mock flag appeared on staging. After removing the block the same command
reports `count: 1`; staging holds `CRAAVEE_ENV` only.

With `CRAAVEE_ENV` correctly set the mock was still refused, so nothing
was actually mockable — but `mockGatewayAllowed()` reads
`CRAAVEE_ENV ?? "development"`, so a deployed project that merely *lost*
that variable would have satisfied both halves of the check and taken
mock money instead of failing closed. Every real consumer already
supplies the flag from its own environment, so the declaration was
redundant for all of them and load-bearing only for the leak.

Guarded by a new gateway-suite test, **proven to catch the regression**:
reintroducing the block fails the assertion, removing it passes.

## 14. CI security review

| Item | Before | Now |
|---|---|---|
| Repo secrets | 0 | **0** (staging secrets are environment-scoped) |
| Environments | 0 | **staging**, **production** (required reviewer) |
| Branch protection on `main` | none | required checks + no force-push/delete |
| Workflow `permissions:` | none declared | **explicit `contents: read`** in all three |
| Deploy credential | — | **database URL**, not an account token |
| Deployment target | — | pinned; a wrong ref fails the build |
| Default workflow token | `read` | unchanged |

Remaining, not addressed here: `allowed_actions: all` and
`sha_pinning_required: false` at the repository level.

**Host issue, not a repo issue:** Docker Desktop file sharing does not
cover the repo path — `docker run -v "$PWD:/w" alpine ls /w` returns
empty, which is why the Docker function bundler fails. Runbook §9.3.

## 15. iOS simulator against real staging — IOS SIMULATOR / VERIFIED

`Craavee_iPhone17` (iOS 26.5, Xcode 26.6), app pointed at
`https://awahemlbgmymahpvhczk.supabase.co`, **not** local Docker.

1. Bundled and launched — 1,927 modules, 7,155 ms.
2. Sign-in screen rendered.
3. `+91 9990000001` → **OTP request accepted by real staging Auth**.
4. Code `123456` → **signed in**.
5. **Catalog loaded from staging**: Sparkling Water ₹45.00 (was ₹50.00),
   Iced Mango Slushie ₹85.00, Coca-Cola ₹38.00, Sting ₹19.00, Toned Milk
   ₹29.00, Curd Cup — the seeded staging rows.
6. Push permission prompt → **denied** (push is out of 10A scope; no EAS
   projectId exists, so registration would report `unconfigured` anyway).

Test OTPs were enabled on staging via `supabase config push`, which
`TEST_STRATEGY.md` §3 explicitly anticipates. That command sends the
whole local `[auth]` block **including `site_url = http://127.0.0.1:3000`**
— fine for staging with no web deployed, and flagged in the runbook as
something never to run against production.

**UX observation for the later UI phase, not fixed here:** product images
render as empty placeholders on staging.

## 16. Cross-role validation — STAGING / VERIFIED

Driven over HTTPS against the deployed functions with four real sessions.
No mock gateway: the order is wallet-covered (`payable = 0`), which
`create_order` confirms in Phase A with no gateway step.

| Step | Result |
|---|---|
| Sign-in: customer, packer, runner, admin | all four, real Auth |
| **Non-wallet order (production safety)** | **500 `PAYMENT_SETUP_FAILED`** — fails closed |
| Wallet-covered order | **200 `confirmed`**, subtotal 4500, fee 1000, wallet 5500, payable 0 |
| Same idempotency key twice | **same `orderId`** |
| Packer queue via PostgREST (RLS) | 200, 5 rows |
| `mark_packed` | 200 `packed` |
| `claim_job` | 200 `assigned` |
| `mark_picked_up` | 200 `picked_up` |
| Customer poll (D20) | sees `picked_up` |
| Delivery code — customer | **readable, 4 digits** |
| Delivery code — runner | **0 rows (D14 holds)** |
| Wrong code | 400 `DELIVERY_CODE_INVALID` |
| Correct code | **200 `delivered`** |
| Kill switch → pause | 200, `isOpen: false` |
| Order while paused | **422 `STORE_CLOSED`** |
| Resume → order | 200 `confirmed` |
| Customer calls an admin function | **403 `FORBIDDEN`** |

A complete order lifecycle — placed, packed, claimed, picked up,
delivered — ran end to end against real staging.

## 17. Realtime — NOT VALIDATED THIS PHASE

Store and Console are not deployed (no Vercel access), so the staff
Realtime surfaces had nowhere to run. The customer path is polling by
D20 and was exercised (§16). No Realtime architecture was changed.
Carried forward as an open item.

## 18. Performance observations — indicative only

Single-run, one machine, seed-scale data, over the public internet from
India to ap-south-1. **Not benchmarks, and no KPI was invented.**
`TEST_STRATEGY.md` §3 targets (catalog p95 < 500 ms, order placement
p95 < 1500 ms) are not evaluated here — that needs k6 in Phase 12.

| Observation | Measured |
|---|---|
| iOS cold bundle + launch | ~7.2 s (Expo Go dev bundle; not a release build) |
| Sign-in → catalog rendered | sub-second, felt immediate |
| Full 12-migration push to a fresh project | ~90 s |
| Dump + restore + validate at seed scale | a few minutes |
| pg_cron sweep execution | **18 ms** |

## 19. Test results

| Suite | Result |
|---|---|
| pgTAP | **570 assertions, 18 files, 0 failed** |
| Integration | **211 / 211**, 0 skipped, 0 todo |
| Gateway (Deno) | **9 / 9** (was 8 — +1 config-leak guard) |
| Unit | **44 / 44** (26 + 15 + 3) |
| Typecheck | 0 errors |
| Lint | **0 errors** (2 pre-existing `packages/ui` warnings) |
| `functions:check` | exit 0 |
| Store + Console build | ✓ both, **against staging env vars** |

Plus staging migration, staging health check, staging app smoke, the
cross-role flow, the restore drill and wallet validation above.

## 20. Remaining blockers

**Closed by this phase:** no staging environment · no deployment pipeline
· no backup/restore procedure · no restore rehearsal · no production
deployment gate · no branch protection · pg_cron unverified.

**Still open:**

| # | Blocker | Owner |
|---|---|---|
| 1 | **No production environment** | Owner — deliberately not created |
| 2 | **No Vercel access** — Store/Console unreachable; blocks Realtime validation | Owner |
| 3 | **Backups not scheduled, not off-machine** | Owner (cadence, retention, location) + engineering |
| 4 | **PITR unverified**, plan tier unconfirmed | Owner |
| 5 | **`dispatch_notifications` still unscheduled** — proven on staging | Phase 10B |
| 6 | No alerting on outbox depth or webhook failures | Phase 11 |
| 7 | Razorpay sandbox — **unverified** | Phase 10C |
| 8 | Real SMS OTP — **unverified** (staging uses test OTPs) | Phase 10C |
| 9 | Real push — **unverified**; no `eas.json`, no EAS projectId | Phase 10C |
| 10 | Sentry ingestion — **unverified** | Phase 10C |
| 11 | Runner earnings formula — **still BLOCKED** | Owner |
| 12 | No load test; `load-tests/k6/` empty | Phase 12 |
| 13 | Docker file sharing broken on this host | Owner (Docker Desktop setting) |
| 14 | Rate limiting covers 1 action of ~20; 3 tables lack `FORCE` RLS | Phase 10I |

## 21. Not claimed

Not production ready. Disaster recovery is **rehearsed once at seed
scale**, not solved. No zero-data-loss claim. Razorpay, real SMS, real
push and Sentry ingestion were **not** verified — none was touched.
Nothing was load tested. No production traffic exists.

**Phase 10B has not started. The frontend redesign has not started.
Design-token consolidation has not started. No unrelated product
functionality was changed.**
