# Phase 10B — Scheduled Operations & Notification Dispatch

**Branch:** `feat/scheduled-operations-10b`
**Base `main`:** `1e92fa83554801722f33a2d90b26a2f7739439b4`
**Date:** 2026-09-03

Evidence levels are kept distinct: **LOCAL** · **CI** · **STAGING** ·
**EXTERNAL**. Nothing below claims a push reached a handset.

---

## 1. Scope

The post-Admin audit found that `dispatch_notifications` was correct,
deployed, and **invoked by nothing**. Every order transition enqueued a
`notification_outbox` row and no row was ever drained. On staging at the
start of this phase: **12 rows pending, 0 attempts, 0 sent** — the
residue of Phase 10A's cross-role validation, sitting untouched.

Done here: the dispatcher runs on a schedule; two real defects found by
running it are fixed; stale runner jobs are detectable without inventing
a policy; and `scheduled_jobs_health()` makes the whole scheduled half of
the system answerable in one query.

Not started: **Phase 10C, real push credentials, real SMS, Razorpay,
Sentry client, UX redesign, design tokens.** The runner earnings formula
remains **BLOCKED**.

---

## 2. Architecture

```
order transition
  → trigger (in-transaction, no I/O — D24)
    → notification_outbox
                                 pg_cron every minute
                                   → dispatch_notifications_tick()   [new]
                                     → pg_net POST                   [new]
                                       → dispatch_notifications EF   [unchanged logic]
                                         → Expo
                                       → claim / mark / delete token
```

No new worker service, no Redis, no polling loop. `pg_cron` was already
the documented mechanism (migration 0004 §8 schedules the reservation
sweep); this uses the same one.

**Why a tick function rather than scheduling the Edge Function directly:**
pg_cron runs SQL, not HTTP. `pg_net` is the supported bridge, and putting
it behind a named function means the schedule stays a one-liner and the
configuration lives in Vault instead of in a cron command string.

---

## 3. Cron configuration

| Job | Schedule | Command |
|---|---|---|
| `craavee-expire-stale-reservations` | `* * * * *` | `select public.expire_stale_reservations();` (0004) |
| **`craavee-dispatch-notifications`** | **`* * * * *`** | **`select public.dispatch_notifications_tick();`** (0013) |

**Cadence rationale.** No document states a notification latency target,
so this is not an attempt to meet one. It is pg_cron's practical
granularity, and the cadence the only other scheduled job already uses.
Notifications are explicitly not the system of record
(`ENGINEERING_SPECIFICATION.md` §14) — the customer's 8s/30s poll (D20) is
what makes state visible, so a push arriving up to a minute late costs
nothing that matters.

**Idempotent installation.** `cron.schedule(name, …)` upserts on the job
name. Scheduling three times over leaves one job (pgTAP A5), and exactly
two `craavee-*` jobs exist (A6).

**Configuration is in Vault, not in the migration.** A migration is
committed to a public repository; the dispatch key and the per-environment
functions URL are not. Absent configuration is a **no-op**
(`{"skipped": true, "reason": "unconfigured"}`), never an unauthenticated
request.

---

## 4. Two real defects, found by running it

### 4.1 Overlapping dispatchers could double-send

0010's comment says *"`for update skip locked` means two dispatcher runs
can never pick up the same row."* That holds **within** the claim
transaction. It does not cover the gap after it:

```
claim (commit: attempts+1, sent_at still null)
  … HTTP round-trip …
mark_notification_sent (sent_at stamped)
```

In that window the row is unsent, under the attempt cap, and unlocked — so
a second dispatcher claims it again. **Demonstrated before the fix: two
concurrent dispatchers claimed 12 pairs from 6 rows.**

Nothing noticed because nothing ever ran the dispatcher, let alone two.
Scheduling it every minute is what would have started surfacing it.

**Fix:** a 60-second claim lease (`notification_outbox.claimed_at`),
matching the cron cadence — the standard queue visibility window. A
dispatcher that dies mid-send leaves its rows retryable on the next tick
and no sooner. A recorded failure releases the lease immediately, so the
existing retry cadence is unchanged. After the fix: 6 rows, 6 messages,
one attempt each.

### 4.2 Notifications for a profile with no device burned their retries

`claim_notification_batch` bumps `attempts` for every claimed row, but the
returned set joins `push_tokens`. A profile with no registered device
therefore burned one attempt per tick against nothing, exhausted its five,
and sat pending forever.

**Observed on real staging:** 12 rows reached `attempts=4` in four minutes
with **zero tokens in the table** — the only one had already been deleted
as `DeviceNotRegistered`.

This is the common case, not an edge case: push permission is optional and
often declined, and no environment has EAS credentials yet.

**Fix:** claim only rows whose profile has a device. `attempts` now counts
real send attempts. `scheduled_jobs_health()` reports `no_device=N`
separately, because a person who declined push is not a queue failing to
drain — and a check that is permanently red is a check nobody reads.

---

## 5. Retry semantics (unchanged, now exercised)

| Situation | Behaviour |
|---|---|
| Success | `sent_at` stamped; never re-claimed |
| Provider 5xx | `last_error='expo 500'`, `sent_at` null, lease released, retried next tick |
| `DeviceNotRegistered` | token **deleted**, row closed with that error |
| Any other provider error | recorded; token **kept** (an unknown error must not delete a live device) |
| 5 attempts | no longer claimable — one broken row cannot grow the queue forever |
| No device | not claimed at all (§4.2) |

---

## 6. Payload safety — re-confirmed

`title`, `body`, and an `orderId` pointer. The suite asserts on what the
dispatcher actually put on the wire that it contains no `eyJ`, `Bearer `,
`service_role`, `delivery_code`/`deliveryCode`, `wallet`, `razorpay`,
`rzp_`, private-key header, or any run of 4+ digits (no amounts, no
codes). Unchanged from Phase 8; now checked at the provider boundary
rather than only in the table.

---

## 7. Stale runner jobs — detection only, deliberately

`ORDER_STATE_MACHINE.md` **row #8** defines the transition:

> `assigned` → `packed`, actor **"Runner (`release_job` EF) or System
> (timeout)"** — *"a scheduled check releases a stale `assigned` order
> after **N minutes** with no `picked_up`"*, clearing `assigned_at` and
> `runner_id`, audited as `order.released`.

**The transition is authoritative. N is not.** The document says "N
minutes" literally, and no value exists in `.agent-os/`,
`DECISION_LOG.md`, `ENGINEERING_SPECIFICATION.md` or `PHASE_PLAN.md`.
`PHASE_7_IMPLEMENTATION_REPORT.md` §20.6 records the same gap from the
other side.

So `stale_runner_jobs(p_stale_minutes)` **reports and nothing else**:

- plain `sql`, `STABLE` — structurally incapable of writing (pgTAP B2/B3)
- its body contains no `UPDATE` and no `audit_logs` (B4/B5)
- **nothing schedules it** (B6) — a scheduled detector is one edit from a
  scheduled mutator
- the threshold is a caller argument, not stored policy (B9)

A scope difference worth naming: a stalled **`picked_up`** order has **no
System actor at all** in the state machine — rows #11/#12 are Runner or
Admin only. It is reported with `legal_system_exit = false` so an operator
can see it, and an operator is the only thing that may act on it.

**Automatic release stays BLOCKED until the owner sets N**, the same
posture as `settle_runner_earnings`.

---

## 8. Concurrency

| Guarantee | Evidence |
|---|---|
| Two dispatchers never send a row twice | §4 integration test — 6 rows, 6 messages, one attempt each |
| A duplicate scheduler invocation is safe | same test; plus the 60s lease |
| A sent row is never re-claimed | §1 test — second dispatch claims 0, provider not called |
| A manual run alongside cron is safe | lease + `SKIP LOCKED`; documented in RUNBOOK §14.5 |

---

## 9. Audit behaviour

**No new audit rows.** Nothing in this phase mutates domain state:
the dispatcher only touches `notification_outbox` and `push_tokens`, and
the stale scan is read-only. The integration suite asserts that observing
a stale job writes **no** `order.released` row (§6), and pgTAP asserts the
same structurally (B14).

Recovering a stale job goes through the existing audited admin paths, and
`RUNBOOK.md` §15 shows how to verify the resulting audit row.

---

## 10. Staging evidence — STAGING

Migration `0013` applied to `craavee-staging` (`awahemlbgmymahpvhczk`,
ap-south-1). Ledger: **`0001…0013`**.

```
 jobid |              jobname              | schedule  | active
     1 | craavee-expire-stale-reservations | * * * * * | t
     2 | craavee-dispatch-notifications    | * * * * * | t

scheduled_jobs_health()  — all seven rows ok
```

**The full chain, cron-driven, no manual calls:**

```
cron.job_run_details : succeeded, "1 row", every minute
net._http_response   : 200 | {"ok":true,"data":{"claimed":12,"sent":0,"dropped":12}}
```

That is `pg_cron → dispatch_notifications_tick() → pg_net → the deployed
Edge Function → the real Expo API → outbox updated`, on real
infrastructure. Expo answered `DeviceNotRegistered` for the deliberately
fake token, which exercised the dead-token path: **the token was deleted**
(`push_tokens` → 0 rows).

**And then attempts froze at 12.** Before the §4.2 fix they climbed by 12
every minute against a table with no tokens in it. That is the fix
demonstrated on real infrastructure, not in a harness.

**A 401 that cost real time, now documented.** The dispatcher originally
checked `x-craavee-dispatch-key` against the ambient
`SUPABASE_SERVICE_ROLE_KEY`. On hosted Supabase the platform injects that
in a form the Management API does not hand back, so neither the legacy JWT
nor the `sb_secret_` key matched and the 401 could not be diagnosed from
outside the runtime. It now prefers an explicit **`CRAAVEE_DISPATCH_KEY`**
(service-role key retained as the fallback, so local dev and the existing
suites need no configuration). This is also the better posture: the
scheduler must hold this value in the database to send it, and a
purpose-specific secret can invoke exactly one function, where the
service-role key bypasses RLS entirely.

Probe after the change: **200 with the key, 401 without.**

---

## 11. Test results

| Suite | Before | After |
|---|---|---|
| pgTAP | 570, 18 files | **596, 19 files** |
| Integration | 211 | **223** |
| Gateway (Deno) | 9 | 9 |
| Unit | 44 | 44 |

Typecheck 0 errors · lint **0 errors** (2 pre-existing `packages/ui`
warnings) · `functions:check` exit 0 · Store + Console build.
**0 skipped, 0 todo.**

New coverage: `supabase/tests/18_scheduled_operations_test.sql` (26
assertions) and `apps/customer-runner/__tests__/phase10b.integration.test.ts`
(12 tests).

Both defects in §4 were **proven before being fixed** — §4.1 failed with
`12 !== 6`, and §4.2 was observed on staging as attempts climbing against
an empty token table.

---

## 12. Restore implications

`RUNBOOK.md` §7.0 now states the restore order explicitly, because a
database that restores cleanly and skips steps 2–4 looks healthy and does
none of its scheduled work:

1. restore roles/schema/data
2. re-create the `auth.users` trigger
3. **re-create BOTH cron jobs** (there are two now)
4. **re-configure the dispatcher's Vault secrets** — `vault.decrypted_secrets`
   comes back empty; the dump carries ciphertext, not the key
5. `select * from scheduled_jobs_health();` — every row ok
6. validate wallet/inventory/order invariants

Step 4 is new to this phase and would otherwise be a silent gap: the
dispatcher would no-op forever with `{"skipped": true}`.

The staging deploy workflow now **fails the build** if either cron job is
missing, and **warns** if the dispatcher is scheduled but unconfigured.

---

## 13. Performance observations

Single-run, seed-scale, indicative only. No load test, no capacity claim.

| Observation | Measured |
|---|---|
| `cron.job_run_details` duration for the tick | **~1–2 ms** (it enqueues one HTTP request) |
| Dispatcher batch, 12 rows, real Expo round-trip | **~400 ms** first call, ~40–60 ms locally against the stand-in |
| Outbox depth before → after on staging | 12 pending → 12 dropped, one cron cycle |
| Stale scan, seed-scale | **~110 ms** including fixture setup |

---

## 14. Remaining limitations

1. **Real push delivery is UNVERIFIED.** The queue drains and the provider
   answers; nothing has reached a handset. No EAS project, no APNs key, no
   FCM config. **Draining a queue is not delivery** — Phase 10C.
2. **The abandoned-job timeout (N) is undecided**, so automatic release
   stays blocked. Detection only.
3. **Vault secrets do not survive a logical restore** — a manual step.
4. **No alerting.** `scheduled_jobs_health()` tells the truth, but only
   when somebody runs it. Phase 11.
5. `pg_net` failures surface in `net._http_response`, which nothing
   watches automatically.
6. Real SMS, Razorpay and Sentry ingestion — **unchanged, unverified**.
7. **Runner earnings formula — still BLOCKED.**

---

**Phase 10C has NOT started. Real push credentials have NOT been
configured. Real SMS has NOT been configured. Razorpay has NOT been
externally verified. Sentry client integration has NOT started. UX
redesign has NOT started. Design-token work has NOT started.**
