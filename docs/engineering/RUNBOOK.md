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

### 7.0 Restore order (do not skip a step)

1. Restore roles, schema, data (§7).
2. Re-create the `auth.users` trigger (§7.1a).
3. **Re-create BOTH cron jobs** (§7.1b) - there are two now, not one.
4. Re-configure the dispatcher's Vault secrets (§14.1) - Vault contents are
   encrypted with a key that does not travel with a logical dump, so the
   restored `vault.decrypted_secrets` is empty.
5. Verify: `select * from scheduled_jobs_health();` - every row `ok`.
6. Validate wallet, inventory and order invariants (§8).

Only then is the restored environment operational. A database that passes
step 1 and fails steps 2-4 looks completely healthy and quietly does none
of its scheduled work.

### 7.1 Three things a logical restore does NOT carry

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
`select count(*) from cron.job` is **0**. Re-apply **both**:

```sql
select cron.schedule('craavee-expire-stale-reservations', '* * * * *',
                     $$ select public.expire_stale_reservations(); $$);
select cron.schedule('craavee-dispatch-notifications', '* * * * *',
                     $$ select public.dispatch_notifications_tick(); $$);
```

`cron.schedule` upserts on the job name, so running this twice is safe.

**c) Vault secrets.** `vault.decrypted_secrets` comes back empty - the
dump carries ciphertext, not the key. The dispatcher will then no-op with
`{"skipped": true, "reason": "unconfigured"}` rather than fire
unauthenticated requests, which is deliberate but means notifications go
nowhere until you re-run §14.1.

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

## 14. Notification dispatcher (Phase 10B)

### 14.1 Configure it (per environment, once)

The dispatcher authenticates with `x-craavee-dispatch-key`. Use a
**dedicated key**, not the service-role key: the scheduler must store this
value in the database to send it, and the service-role key bypasses RLS
entirely.

```bash
DK=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)
supabase secrets set CRAAVEE_DISPATCH_KEY="$DK" --project-ref <ref>
supabase functions deploy dispatch_notifications --use-api \
  --import-map supabase/functions/deno.json --project-ref <ref>
psql "$DB_URL" -tAc "select configure_dispatcher('https://<ref>.supabase.co/functions/v1','$DK')"
```

Store `$DK` in the password manager. `configure_dispatcher` never returns
it.

> Do **not** try to use `SUPABASE_SERVICE_ROLE_KEY` here. The platform
> injects that into the function runtime in a form the Management API does
> not hand back, so the scheduler gets a 401 that cannot be diagnosed from
> outside the runtime. That is what the dedicated key exists to avoid.

### 14.2 Is the scheduled half of the system alive?

```sql
select * from scheduled_jobs_health();
```

Seven rows, all `ok` when healthy: both extensions, both cron jobs,
dispatcher configured, no recent cron failures, outbox drained.

`notification outbox drained` counts only **deliverable** rows - those
whose profile has a registered device. `no_device=N` in the detail is
people who declined push, not a backlog.

### 14.3 Cron history

```sql
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where d.start_time > now() - interval '1 hour'
order by d.start_time desc limit 20;
```

`succeeded` here means the SQL ran, **not** that the notification was
sent - the tick only enqueues an HTTP request. For the outcome:

```sql
select status_code, count(*), left(max(content), 120)
from net._http_response where created > now() - interval '15 minutes'
group by 1;
```

A healthy line looks like
`200 | {"ok":true,"data":{"claimed":12,"sent":12,"dropped":0}}`.
`401` means the dispatch key in Vault does not match the function's
`CRAAVEE_DISPATCH_KEY` - redo §14.1.

### 14.4 Outbox depth

```sql
select count(*) filter (where sent_at is null)                 as pending,
       count(*) filter (where sent_at is null and attempts >= 5) as exhausted,
       count(*) filter (where sent_at is not null)              as sent,
       max(attempts) as worst_attempts
from notification_outbox;
```

### 14.5 Run the dispatcher by hand (recovery)

```bash
curl -s -X POST "https://<ref>.supabase.co/functions/v1/dispatch_notifications" \
  -H 'content-type: application/json' -H "x-craavee-dispatch-key: $DK" -d '{}'
```

Safe at any time, including while cron is running: rows carry a 60-second
claim lease and `for update skip locked`, so a manual run and a scheduled
one cannot send the same row twice.

Or from SQL: `select dispatch_notifications_tick();`

### 14.6 Diagnose failed attempts

```sql
select last_error, count(*), max(attempts)
from notification_outbox where sent_at is null group by 1 order by 2 desc;
```

| `last_error` | Meaning | Action |
|---|---|---|
| `DeviceNotRegistered` | the app was uninstalled or the token rotated | none - the token is deleted automatically |
| `expo 5xx` | provider outage | none - it retries next tick |
| `MessageTooBig`, other | Expo rejected the message | inspect the row; the token is deliberately **not** deleted |
| `null` with `attempts = 0` | never claimed | the profile has no device, or the dispatcher is not running |

A row stops being retried at `attempts >= 5`. To give a batch one more
chance after fixing the cause:

```sql
update notification_outbox set attempts = 0, claimed_at = null
where sent_at is null and attempts >= 5 and created_at > now() - interval '1 day';
```

## 15. Stale runner jobs

**There is no automatic reaper, and that is deliberate.**
`ORDER_STATE_MACHINE.md` row #8 defines the transition (`assigned →
packed`, actor "System (timeout)") but specifies the threshold only as
"after N minutes". **N is not defined anywhere.** Until the project owner
sets it, detection is all that ships - the same posture as
`settle_runner_earnings`.

```sql
select * from stale_runner_jobs(30);   -- the threshold is yours to choose
```

| Column | Meaning |
|---|---|
| `legal_system_exit = true` | `assigned` with no pickup - row #8 would cover it once N exists |
| `legal_system_exit = false` | `picked_up` and stalled - **no System actor exists**; operator only |

Recovering one is a human decision, through the existing audited paths:

```bash
# hand it to a specific runner
curl -X POST ".../admin_reassign" -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"orderId":"...","runnerId":"..."}'
# or release it back to the queue (assigned only)
curl -X POST ".../admin_reassign" -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"orderId":"..."}'
```

Both write `audit_logs`. Verify:

```sql
select action, actor_id, metadata, created_at
from audit_logs where entity_id = '<order id>' order by created_at desc;
```

## 16. Razorpay (Phase 10C)

### 16.1 Test Mode credentials

Dashboard → Settings → API Keys with **Test Mode on**. The key id starts
`rzp_test_`; `rzp_live_` is real money and must never reach staging.

```bash
supabase secrets set \
  RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=... \
  PAYMENT_GATEWAY=razorpay --project-ref <ref>
supabase functions deploy create_order payment_webhook refund --use-api \
  --import-map supabase/functions/deno.json --project-ref <ref>
```

All three Razorpay values are required: `getGateway()` checks
`keyId && keySecret && webhookSecret` and otherwise fails closed.

### 16.2 Webhook

Dashboard → Account & Settings → Webhooks → Add New Webhook.

- URL `https://<ref>.supabase.co/functions/v1/payment_webhook`
- Events: `payment.captured`, `payment.failed`

> **The secret field is the trap.** On this account Razorpay signs with
> the **API key secret**, not with a distinct webhook secret — a separate
> one was entered twice and never took effect. So
> `RAZORPAY_WEBHOOK_SECRET` must be set to the **API key secret** value.
>
> **Therefore rotating the API key also rotates webhook verification.**
> After any key rotation, update `RAZORPAY_WEBHOOK_SECRET` too and
> redeploy `payment_webhook`, or every delivery starts 403-ing.
>
> Before production, try again to configure a genuinely distinct webhook
> secret and confirm with §16.4 which key is actually in use.

Enabling all 54 event types is harmless: `order.paid` maps to a capture
but the capture branch is guarded on order state, so the second event is
an audited no-op.

### 16.3 A sandbox transaction

Indian test card — an international card is declined by this account:

```
card 5267 3181 8797 5449   any future expiry   any CVV   OTP 1234
```

```bash
# order + checkout params
curl -s -X POST "$STAGING_URL/functions/v1/create_order" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT" \
  -H 'content-type: application/json' \
  -d '{"idempotencyKey":"<uuid>","addressId":"<uuid>","items":[{"productId":"<uuid>","qty":1}]}'
```

Pay via Razorpay's hosted checkout (POST the returned `order_id` to
`https://api.razorpay.com/v1/checkout/embedded`). Then watch the truth:

```sql
select o.status, o.payment_status, p.status, p.gateway_payment_ref
from orders o join payments p on p.order_id = o.id where o.id = '<order>';
select gateway_event_id, processed_at from webhook_events order by created_at desc limit 3;
```

Expect `confirmed / captured / captured` within ~15 seconds. **The
browser callback is not authoritative** — the order stays `created` until
a signature-verified webhook arrives. That is by design.

### 16.4 Which key is Razorpay signing with?

If deliveries 403, do not guess. Capture one real request and test keys
offline:

```python
import hmac, hashlib
hmac.new(candidate.encode(), raw_body, hashlib.sha256).hexdigest() == received_signature
```

Try `RAZORPAY_WEBHOOK_SECRET`, then `RAZORPAY_KEY_SECRET`. Whichever
matches is the key in use.

Check reachability first, so you are debugging the right thing:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$STAGING_URL/functions/v1/payment_webhook" \
  -H 'content-type: application/json' -H 'x-razorpay-signature: bogus' -d '{}'
```

`403` means the request reached our handler and was refused — the
platform is not blocking. `401` would mean it never got that far.

### 16.5 Late capture (D36)

A payment captured after Craavee expired the order. To rehearse:

```sql
update orders set reservation_expires_at = now() - interval '1 minute' where id = '<order>';
```

Wait for the sweep (`payment_failed`), then pay the still-payable
Razorpay order. Expect: order **stays** `payment_failed`,
`refunded_amount` = full, one `refunds` row
(`late_capture_reconciliation`, no gateway ref — wallet only), a
`+amount` `wallet_ledger` row, inventory **not** restored, and a
`payment.late_capture_reconciled` audit row.

### 16.6 Refunds

**Wallet only (D38).** `PaymentGatewayAdapter` has no refund method;
Craavee never calls Razorpay's refund API. A gateway refund is a product
decision, not a bug.

### 16.7 Disabling the gateway safely

Remove the credentials and redeploy:

```bash
supabase secrets unset RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET --project-ref <ref>
supabase functions deploy create_order payment_webhook refund --use-api \
  --import-map supabase/functions/deno.json --project-ref <ref>
```

With `CRAAVEE_ENV=staging` or `production` this **fails closed** —
`create_order` returns `PAYMENT_SETUP_FAILED` rather than falling back to
the mock. Wallet-covered orders (`payable = 0`) still complete, because
they never reach the gateway.

### 16.8 Secret rotation

| Secret | Effect of rotating |
|---|---|
| `RAZORPAY_KEY_ID` / `KEY_SECRET` | **also breaks webhook verification** (§16.2). Update `RAZORPAY_WEBHOOK_SECRET` to the new key secret and redeploy in the same change. |
| `RAZORPAY_WEBHOOK_SECRET` | only meaningful once a genuinely distinct webhook secret works |

Then re-run §16.3 and confirm a fresh order reaches `confirmed`.

## 17. SMS, push and Sentry — not configured

Recorded so nobody assumes otherwise:

- **SMS: no provider chosen.** Staging uses fixed test OTPs (§14.1 rules
  still apply: never push that config to production). A provider decision
  is required before any credential is useful.
- **Push: no EAS project.** No `eas.json`, no `expo.extra.eas.projectId`,
  so a token cannot be minted. 10B's dispatcher drains the queue and the
  provider answers — **that is not handset delivery.**
- **Sentry: no DSN.** `_shared/sentry.ts` still emits a structured
  `[craavee] {...}` line to the Supabase log drain regardless, so server
  failures remain diagnosable without it.

## 18. What this runbook cannot yet do

Stated plainly so nobody assumes otherwise:

- **No production environment exists.** Every production procedure is
  untested.
- **No web deployment.** Vercel access is not configured, so Store and
  Console are not reachable on any URL.
- **Backups are not scheduled and not off-site.**
- **No alerting.** Nothing pages anyone. `scheduled_jobs_health()` will
  tell you the truth, but only when somebody runs it.
- **Push delivery itself is unverified.** Phase 10B proved the queue
  drains and the provider answers; nothing has reached a handset, because
  no EAS project or APNs/FCM credentials exist yet.
- **Real SMS is unverified** and blocked on a provider decision.
- **Sentry has never ingested an event.**
- **Razorpay is verified in Test Mode only.** No live key, no real money,
  no merchant KYC.
- **PITR is unverified** and probably unavailable on the current plan.
- **Real SMS, real push, Razorpay and Sentry ingestion remain
  unverified** — none was touched in Phase 10A.
