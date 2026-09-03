# Craavee Operations Runbook

Operational procedures for deploying, backing up, restoring and
recovering Craavee. Every command below was executed against the real
staging project during Phase 10A unless a step is explicitly marked
**NOT YET EXERCISED**.

Audience: an engineer who did not write this system.

---

## 1. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Supabase CLI | 2.113.0 | `brew install supabase/tap/supabase` |
| psql / pg_dump | any | **The local client is 14.x and cannot dump a PG 17 server.** Use `supabase db dump`, which runs a matching pg_dump in Docker. |
| Docker Desktop | required for `supabase start` / `db dump` | See §9.3 — file sharing must include the repo path or `functions deploy` fails. |
| Node | 20+ | |
| `gh` | authenticated as a repo admin | Needed only for environment/secret changes. |

Access needed: Supabase account in **`Rexy-5097's Org`**, GitHub **admin**
on `Rexy-5097/craavee_web_v1`.

---

## 2. Environment matrix

| | LOCAL | STAGING | PRODUCTION |
|---|---|---|---|
| Supabase project | `supabase start` (Docker) | **`craavee-staging`** | **does not exist yet** |
| Project ref | — (local `project_id = craavee_web_v1`, not a cloud ref) | **`awahemlbgmymahpvhczk`** | — |
| Region | — | **ap-south-1** (Mumbai) | ap-south-1 when created |
| API URL | `http://127.0.0.1:54321` | `https://awahemlbgmymahpvhczk.supabase.co` | — |
| Migration target | `supabase db reset` | `supabase db push --db-url $SUPABASE_DB_URL` | manual, gated (§6) |
| Web deploy | `npm run dev:web` | **not deployed — no Vercel access** | — |
| Public env vars | `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` → localhost | → staging URL + anon key | — |
| Server-only secrets | none | `CRAAVEE_ENV=staging` only | — |
| CI secrets | none | `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF` on the **`staging` GitHub environment** | none |
| OTP | fixed test OTPs in `config.toml` | fixed test OTPs (pushed deliberately — see §10) | **must be none** |
| Payment gateway | mock (flag supplied by the local env, never by config) | **fails closed** — no gateway credentials, `CRAAVEE_ENV=staging` refuses the mock | must be real Razorpay |

**The recovery project** `craavee-recovery` (`izqhydtwpucrovnrunly`,
ap-south-1) is not an environment. It is a disposable restore target and
holds no traffic.

---

## 3. Deploying database migrations

### 3.1 Staging (automatic)

A push to `main` touching `supabase/migrations/**`,
`supabase/functions/**` or `supabase/config.toml` runs
`.github/workflows/deploy-staging.yml`. It prints commit SHA, environment
and project ref, dry-runs, applies, then health-checks (§7).

Manual re-run: Actions → **Deploy staging** → Run workflow.

### 3.2 Staging (from a laptop)

```bash
supabase link --project-ref awahemlbgmymahpvhczk
supabase db push --linked -p "$STAGING_DB_PASSWORD"
```

Or without linking:

```bash
supabase db push --db-url "$SUPABASE_DB_URL"
```

Always run `--dry-run` first. It lists the migrations that would apply
and applies nothing.

### 3.3 Production — **NOT YET EXERCISED**

No production project exists. When one does:

1. It gets its own GitHub environment secret. Never reuse staging's.
2. The `production` GitHub environment already exists with a **required
   reviewer**, so a production job cannot start until a human approves it
   in the Actions UI.
3. Change the project-ref guard in `deploy-staging.yml` (or copy it) —
   the staging workflow **hard-codes** `awahemlbgmymahpvhczk` and refuses
   to run against any other ref.

---

## 4. Deploying Edge Functions

```bash
supabase functions deploy --use-api \
  --import-map supabase/functions/deno.json \
  --project-ref awahemlbgmymahpvhczk
```

`--use-api` bundles server-side. Use it — the Docker bundler fails on
this machine (§9.3). `--import-map` is **required**: without it the
server-side bundler cannot resolve `@supabase/supabase-js` and every
function fails with a 400.

Verify: `supabase functions list --project-ref awahemlbgmymahpvhczk`
— expect **21 functions, all ACTIVE**.

---

## 5. Function secrets

```bash
supabase secrets list  --project-ref awahemlbgmymahpvhczk
supabase secrets set   CRAAVEE_ENV=staging --project-ref awahemlbgmymahpvhczk
supabase secrets unset NAME --project-ref awahemlbgmymahpvhczk
```

**Staging must hold `CRAAVEE_ENV` and nothing else** until real gateway
credentials are provisioned. Confirm after any change:

```bash
supabase secrets list --project-ref awahemlbgmymahpvhczk
```

> `supabase secrets set` also pushes every key declared under
> `[edge_runtime.secrets]` in `config.toml`. That block is now empty and
> a test in the gateway suite keeps it that way — see §10.

---

## 6. Backup

**Capability on the current plan: `supabase backups` reports no physical
backups and PITR is not enabled.** The org's plan tier has not been
confirmed in the dashboard, so treat platform backup guarantees as
**UNVERIFIED** and rely on the logical dump below, which has been
exercised end to end.

### 6.1 Logical backup (exercised)

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ); OUT=~/craavee-backups/$TS; mkdir -p "$OUT"
supabase link --project-ref awahemlbgmymahpvhczk
supabase db dump --linked -p "$PW" -f "$OUT/schema.sql"
supabase db dump --linked -p "$PW" --data-only --use-copy -f "$OUT/data.sql"
supabase db dump --linked -p "$PW" --role-only  -f "$OUT/roles.sql"
```

`--data-only` covers `public`, `auth` (including `auth.users`) and
`storage`. Sizes seen in the drill: schema 202 KB, data 63 KB, roles 1 KB.

| Property | Value |
|---|---|
| Method | logical dump, three files |
| Frequency | **OWNER DECISION** — not yet scheduled |
| Retention | **OWNER DECISION** |
| Storage location | **OWNER DECISION** — currently a local directory, which is not a backup |
| RPO / RTO | **OWNER DECISION** — not committed to. The drill took minutes at seed-scale; that is not an RTO. |
| Recovery owner | **OWNER DECISION** |

Nothing above is scheduled or off-machine yet. **A backup that only ever
runs when someone remembers is not a backup**; scheduling and off-site
storage are the first follow-ups.

### 6.2 Platform backups

```bash
supabase backups list --project-ref awahemlbgmymahpvhczk
```

Check this in the dashboard before relying on it.

---

## 7. Restore

**Never restore over the source.** Restore into `craavee-recovery`, or a
freshly created project, and validate before repointing anything.

```bash
RECOVERY_URL="postgresql://postgres.izqhydtwpucrovnrunly:<pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

psql "$RECOVERY_URL" -f "$OUT/roles.sql"    # ALTER ROLE ... log_min_messages fails; harmless, Supabase-managed
psql "$RECOVERY_URL" -f "$OUT/schema.sql"
psql "$RECOVERY_URL" -f "$OUT/data.sql"     # begins with SET session_replication_role = replica
```

### 7.1 Two things a logical restore does NOT carry

Both were found by running the drill, not by reading documentation.

**a) The `auth.users` trigger.** `on_auth_user_created` lives in the
`auth` schema and is not in the dump. Existing data restores perfectly,
but **new sign-ups would silently get no `profiles` row**. Re-apply:

```sql
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

`handle_new_user()` itself is in `public` and does survive. Verified: a
new `auth.users` row produced a `profiles` row afterwards. The staging
deploy workflow now asserts this trigger on every run.

**b) pg_cron jobs.** `cron.job` is not dumped. After a restore,
`select count(*) from cron.job` is **0**. Re-apply:

```sql
select cron.schedule('craavee-expire-stale-reservations', '* * * * *',
                     $$ select public.expire_stale_reservations(); $$);
```

---

## 8. Restore validation

Run the same query set against source and restored, then diff. The script
used in the drill covers row counts for every public table, `auth.users`,
wallet totals, money totals, orphan checks, inventory totals, and nine
MD5 checksums.

### 8.1 Wallet verification (money-bearing — always run)

```sql
select coalesce(sum(wallet_balance),0) from profiles;               -- balances
select coalesce(sum(delta),0), count(*) from wallet_ledger;         -- ledger
select count(*) from profiles p                                     -- must be 0
 where p.wallet_balance <> coalesce(
   (select sum(delta) from wallet_ledger w where w.customer_id = p.id), 0);
select count(*) from wallet_ledger w                                -- must be 0
  left join profiles p on p.id = w.customer_id where p.id is null;
```

`wallet_balance` is a denormalised column maintained by the money
functions, **not by a trigger** — a direct ledger insert does not update
it. The mismatch query above is the invariant that catches drift.

### 8.2 Commerce, inventory, operations, audit

```sql
select count(*) from payments pm left join orders o on o.id=pm.order_id where o.id is null;   -- 0
select count(*) from order_items oi left join orders o on o.id=oi.order_id where o.id is null; -- 0
select count(*) from refunds r left join payments p on p.id=r.payment_id where p.id is null;   -- 0
select count(*) from inventory where qty_reserved > qty_on_hand;                               -- 0
```

Plus checksums over `profiles`, `wallet_ledger`, `orders`, `order_items`,
`payments`, `inventory`, `audit_logs`, `runners`, `staff_roles`.

### 8.3 Structural parity

```sql
select count(*) from pg_policies where schemaname='public';                 -- 39
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public';                                                  -- 89
select count(*) from pg_trigger where not tgisinternal;                     -- 14
select count(*) from pg_indexes where schemaname='public';                  -- 60
```

A trigger count of 13 means §7.1(a) has not been applied.

---

## 9. Health checks

### 9.1 Database

```bash
psql "$SUPABASE_DB_URL" -tAc "select string_agg(version,',' order by version) from supabase_migrations.schema_migrations"
psql "$SUPABASE_DB_URL" -tAc "select count(*) from pg_extension where extname='pg_cron'"
psql "$SUPABASE_DB_URL" -tAc "select jobname, schedule, active from cron.job"
psql "$SUPABASE_DB_URL" -tAc "select status, count(*) from cron.job_run_details group by status"
```

Expected: `0001..0012`, pg_cron present, one active job, `succeeded`.

### 9.2 Application

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "https://awahemlbgmymahpvhczk.supabase.co/functions/v1/create_order" \
  -H "apikey: $ANON" -H 'content-type: application/json' -d '{}'
```

`401` unauthenticated is correct. With a valid customer JWT and an empty
body, `400 VALIDATION_FAILED` is correct. Either proves the function is
live and rejecting properly.

### 9.3 Known host issue — Docker file sharing

`supabase functions deploy` (Docker bundler) fails with
`entrypoint path does not exist` even though the file is there. Docker
mounts the repo path as an **empty directory** — file sharing does not
cover `/Users/<you>/Craavee`.

Confirm: `docker run --rm -v "$PWD:/w" alpine ls /w` — empty means this
is the problem. Fix in Docker Desktop → Settings → Resources → File
sharing, or keep using `--use-api` (§4), which does not need Docker.

---

## 10. Environment safety invariants

Check these before any production work.

1. **Staging and production must be different projects.** Staging is
   `awahemlbgmymahpvhczk`. The deploy workflow refuses any other ref.
2. **Test OTPs must never reach production.** Staging has fixed test OTPs
   (pushed via `supabase config push` so the apps can sign in without an
   SMS provider — sanctioned by `TEST_STRATEGY.md` §3). `config push`
   sends the whole local `[auth]` block, **including
   `site_url = http://127.0.0.1:3000`**. Never run it against production.
3. **The mock gateway must never activate off a developer's machine.**
   `CRAAVEE_ALLOW_MOCK_CONTROL` is no longer declared in `config.toml`
   because `supabase secrets set` pushed it to the linked remote project.
   A gateway-suite test fails if it is reintroduced. Verified on staging:
   a non-wallet order returns **`PAYMENT_SETUP_FAILED`** — fail-closed,
   as designed.
4. **No service-role key in a client bundle.** The apps read only
   `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*`.

---

## 11. Secret rotation

| Secret | Where | How |
|---|---|---|
| Staging DB password | Supabase dashboard → Settings → Database | Reset, then update the `SUPABASE_DB_URL` secret on the GitHub **staging** environment (`gh secret set SUPABASE_DB_URL --env staging`) and re-run the deploy workflow. |
| Anon / service-role keys | dashboard → API | Rotate, update Vercel/EAS env, redeploy. The service-role key must never leave the server. |
| Function secrets | `supabase secrets set` | Redeploy functions afterwards. |
| GitHub environment secrets | `gh secret set --env <env>` | Environment-scoped; a job that does not name the environment cannot read them. |

Rotate immediately if a value was printed in a log, committed, or shared.
Then check for a leak:

```bash
git grep -nIE "(sk_live|rzp_live|service_role.{0,40}eyJ|BEGIN [A-Z ]*PRIVATE KEY)"
```

---

## 12. Abort a deploy

Migrations are forward-only; **there are no down-migrations**. Rolling
back means restoring (§7), not reversing.

1. Cancel the run in Actions.
2. `psql "$SUPABASE_DB_URL" -tAc "select version from supabase_migrations.schema_migrations order by version desc limit 3"`.
3. If the schema is wrong, restore from the most recent backup into a new
   project, validate (§8), then repoint — do not attempt an in-place undo.
4. If the schema is right and only the app is bad, redeploy the previous
   commit's functions.

---

## 13. Incident response

1. **Stop the bleeding.** Pause ordering with the Console kill switch, or
   `set_service_pause` with `isOpen: false`. Verified: `create_order`
   then returns **`422 STORE_CLOSED`**, and resuming restores it.
2. **Establish scope.** `audit_logs` for admin actions; `cron.job_run_details`
   for the sweep; Supabase function logs for errors (a structured
   `[craavee] {...}` line is emitted on every captured failure regardless
   of whether Sentry is configured).
3. **Money first.** Run §8.1. A wallet mismatch is the most serious class
   of incident this system can have.
4. **Escalate.** Single owner today (`Rexy-5097`). There is no on-call
   rotation and no alerting — see the checkpoint's remaining blockers.
5. **Write it down.** Postmortems belong beside this file.

---

## 14. What this runbook cannot yet do

Stated plainly so nobody assumes otherwise:

- **No production environment exists.** Every production procedure is
  untested.
- **No web deployment.** Vercel access is not configured, so Store and
  Console are not reachable on any URL.
- **Backups are not scheduled and not off-site.**
- **No alerting.** Nothing pages anyone. The notification outbox in
  particular has no dispatcher schedule and would grow silently.
- **PITR is unverified** and probably unavailable on the current plan.
- **Real SMS, real push, Razorpay and Sentry ingestion remain
  unverified** — none was touched in Phase 10A.
