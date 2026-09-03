-- ============================================================
-- Phase 10B — scheduled operations
-- ============================================================
-- The post-Admin audit found that `dispatch_notifications` was correct,
-- deployed, and invoked by nothing. Every order transition enqueued a
-- notification_outbox row (migration 0010) and no row was ever drained.
-- `expire_stale_reservations` was scheduled in 0004 §8; the dispatcher
-- never received the same treatment, which is easy to miss precisely
-- because its sibling looks after itself.
--
-- This migration adds:
--   1. pg_net, so Postgres can make the one HTTP call the dispatcher
--      needs (the Edge Function does the Expo I/O; nothing here talks to
--      Expo directly).
--   2. `dispatch_notifications_tick()` - a tiny, Vault-configured caller.
--   3. The `craavee-dispatch-notifications` cron job.
--   4. `stale_runner_jobs()` - DETECTION ONLY. See §4 for why it does not
--      release anything.
--   5. `scheduled_jobs_health()` - one query an operator can run.
--
-- It deliberately does NOT change the dispatcher, the outbox, the retry
-- rules, the state machine, or any RLS policy.


-- ============================================================
-- 1. pg_net
-- ============================================================
-- Guarded the same way 0004 guards pg_cron: an environment without the
-- extension still applies the migration, and the health check in §5 is
-- what turns a missing scheduler into a visible failure rather than a
-- silent one.
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not available (%). dispatch_notifications must be driven by an external scheduler in this environment.', sqlerrm;
end;
$$;


-- ============================================================
-- 2. The dispatcher tick
-- ============================================================
-- Configuration lives in Vault, not in this file, because the dispatcher
-- authenticates with the service-role key (it checks
-- `x-craavee-dispatch-key` against SUPABASE_SERVICE_ROLE_KEY) and the
-- functions base URL differs per environment. A migration is committed
-- to a public repository; neither value belongs in one.
--
-- Both secrets are set out-of-band, per environment, and RUNBOOK.md §16
-- carries the commands:
--
--   craavee_functions_base_url  https://<ref>.supabase.co/functions/v1
--   craavee_dispatch_key        the project's service-role key
--
-- Absent configuration is a NO-OP, not an error and not an unauthenticated
-- request: an unconfigured environment (a fresh local stack, a restored
-- scratch project) must not fire HTTP at a URL it does not have. The
-- health check reports the unconfigured state so it cannot pass silently.
create or replace function dispatch_notifications_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_base   text;
  v_key    text;
  v_req_id bigint;
begin
  select decrypted_secret into v_base
  from vault.decrypted_secrets where name = 'craavee_functions_base_url';

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'craavee_dispatch_key';

  if v_base is null or v_key is null then
    return jsonb_build_object('skipped', true, 'reason', 'unconfigured');
  end if;

  -- One POST. The dispatcher claims at most 50 rows per call
  -- (claim_notification_batch's p_limit default), so the work this
  -- triggers is bounded no matter how deep the outbox is. Overlapping
  -- ticks are safe without any lock here: `for update skip locked` inside
  -- claim_notification_batch means two in-flight dispatchers cannot claim
  -- the same row, which is the same guarantee that already protects two
  -- manual invocations.
  select net.http_post(
           url     := rtrim(v_base, '/') || '/dispatch_notifications',
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'x-craavee-dispatch-key', v_key),
           body    := '{}'::jsonb
         )
    into v_req_id;

  return jsonb_build_object('skipped', false, 'requestId', v_req_id);
end;
$$;

comment on function dispatch_notifications_tick() is
  'Phase 10B. Fires one bounded HTTP POST at the dispatch_notifications Edge Function. Configuration (functions base URL + service-role dispatch key) comes from Vault, never from this migration. Returns {skipped:true} when unconfigured rather than issuing an unauthenticated request. Overlapping ticks are safe: claim_notification_batch uses FOR UPDATE SKIP LOCKED.';

-- Not a client endpoint. Only the scheduler (which runs as the table
-- owner) and an operator connecting as service_role may call it.
revoke execute on function dispatch_notifications_tick() from public, anon, authenticated;
grant  execute on function dispatch_notifications_tick() to service_role;


-- ============================================================
-- 3. Schedule it
-- ============================================================
-- Cadence: every minute, matching `craavee-expire-stale-reservations`.
-- No document states a notification latency target, so this is not an
-- attempt to meet one - it is pg_cron's practical granularity and the
-- cadence the only other scheduled job in this system already uses.
-- Notifications are explicitly not the system of record
-- (ENGINEERING_SPECIFICATION.md §14): the customer's 8s/30s poll (D20) is
-- what makes state visible, so a push arriving up to a minute late costs
-- nothing that matters.
--
-- `cron.schedule(name, ...)` upserts on the job name in pg_cron >= 1.4, so
-- re-running this migration converges on exactly one job rather than
-- accumulating duplicates. Asserted in pgTAP.
do $$
begin
  perform cron.schedule(
    'craavee-dispatch-notifications',
    '* * * * *',
    $cron$ select public.dispatch_notifications_tick(); $cron$
  );
exception when others then
  raise notice 'pg_cron not available (%). Schedule dispatch_notifications externally in this environment.', sqlerrm;
end;
$$;


-- ============================================================
-- 4. Stale runner jobs — DETECTION ONLY
-- ============================================================
-- ORDER_STATE_MACHINE.md row #8 does define the transition:
--
--   assigned -> packed, actor "Runner (release_job EF) or System
--   (timeout)", "a scheduled check releases a stale `assigned` order
--   after N MINUTES with no `picked_up`", clearing assigned_at and
--   runner_id, audited as order.released.
--
-- The transition is authoritative. **N is not.** The document says "N
-- minutes" literally, and no value for it exists anywhere in
-- .agent-os/, DECISION_LOG.md, ENGINEERING_SPECIFICATION.md or
-- PHASE_PLAN.md. PHASE_7_IMPLEMENTATION_REPORT.md §20.6 records the same
-- gap from the other side: "A stale `assigned` order is not
-- auto-released. Row #8's system-timeout path needs a scheduled job,
-- which is not in scope."
--
-- Choosing N here would turn an open product decision into shipped
-- behaviour by accident - the same trap `settle_runner_earnings` is
-- deliberately left blocked to avoid. So this function only REPORTS. It
-- performs no UPDATE, writes no audit row, and creates no transition.
-- The threshold is a caller-supplied argument, not a stored policy, so
-- asking the question at 10 minutes and at 60 costs nothing and commits
-- to nothing.
--
-- Note the scope difference, which is not an oversight:
--   * `assigned` with no pickup  -> row #8 gives a legal system exit once
--                                   N exists.
--   * `picked_up` and stalled    -> there is NO system actor for this in
--                                   the state machine. Rows #11/#12 are
--                                   Runner/Admin only. It is reported so
--                                   an operator can see it, and an
--                                   operator is the only thing that may
--                                   act on it.
create or replace function stale_runner_jobs(p_stale_minutes integer default 30)
returns table (
  order_id        uuid,
  store_id        uuid,
  status          order_status,
  runner_id       uuid,
  runner_online   boolean,
  since           timestamptz,
  stale_minutes   integer,
  legal_system_exit boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         o.store_id,
         o.status,
         o.runner_id,
         r.is_online,
         case when o.status = 'assigned' then o.assigned_at else o.picked_up_at end,
         (extract(epoch from (now() - case when o.status = 'assigned' then o.assigned_at else o.picked_up_at end)) / 60)::integer,
         -- Only row #8 has a System actor, and only once N is decided.
         o.status = 'assigned'
    from orders o
    left join runners r on r.id = o.runner_id
   where o.status in ('assigned', 'picked_up')
     and case when o.status = 'assigned' then o.assigned_at else o.picked_up_at end
         < now() - make_interval(mins => greatest(p_stale_minutes, 0))
   order by 6 asc;
$$;

comment on function stale_runner_jobs(integer) is
  'Phase 10B. READ-ONLY detection of runner jobs that have not moved. Mutates nothing: ORDER_STATE_MACHINE.md row #8 defines the assigned->packed system exit but leaves the timeout as "N minutes" with no value anywhere in the authoritative docs, so automatic release stays BLOCKED until the project owner sets N. legal_system_exit marks the rows row #8 would eventually cover; a stalled picked_up order has no System actor at all and is operator-only.';

revoke execute on function stale_runner_jobs(integer) from public, anon;
grant  execute on function stale_runner_jobs(integer) to service_role;


-- ============================================================
-- 5. Scheduler health
-- ============================================================
-- One query for "is the scheduled half of this system actually alive?".
-- It exists because the failure mode here is silence: an uninstalled
-- cron job, an unconfigured Vault secret and a dispatcher that is simply
-- never called all look identical from the application side - orders keep
-- working and notifications quietly never arrive.
create or replace function scheduled_jobs_health()
returns table (
  check_name text,
  ok         boolean,
  detail     text
)
language sql
stable
security definer
set search_path = public
as $$
  select 'pg_cron installed', exists (select 1 from pg_extension where extname = 'pg_cron'),
         coalesce((select 'version ' || extversion from pg_extension where extname = 'pg_cron'), 'missing')
  union all
  select 'pg_net installed', exists (select 1 from pg_extension where extname = 'pg_net'),
         coalesce((select 'version ' || extversion from pg_extension where extname = 'pg_net'), 'missing')
  union all
  select 'reservation sweep scheduled',
         exists (select 1 from cron.job where jobname = 'craavee-expire-stale-reservations' and active),
         coalesce((select schedule from cron.job where jobname = 'craavee-expire-stale-reservations'), 'not scheduled')
  union all
  select 'notification dispatcher scheduled',
         exists (select 1 from cron.job where jobname = 'craavee-dispatch-notifications' and active),
         coalesce((select schedule from cron.job where jobname = 'craavee-dispatch-notifications'), 'not scheduled')
  union all
  select 'dispatcher configured',
         (select count(*) from vault.decrypted_secrets
           where name in ('craavee_functions_base_url', 'craavee_dispatch_key')) = 2,
         (select coalesce(string_agg(name, ', ' order by name), 'no secrets set')
            from vault.decrypted_secrets
           where name in ('craavee_functions_base_url', 'craavee_dispatch_key'))
  union all
  select 'no recent cron failures',
         not exists (select 1 from cron.job_run_details
                      where status = 'failed' and start_time > now() - interval '1 hour'),
         (select coalesce(count(*)::text, '0') || ' failed run(s) in the last hour'
            from cron.job_run_details
           where status = 'failed' and start_time > now() - interval '1 hour')
  union all
  -- "Deliverable" is the only honest measure of backlog. A row addressed
  -- to a profile with no registered device is not a queue that is failing
  -- to drain; it is a person who declined push. Counting those would leave
  -- this check permanently red, and a check that is always red is a check
  -- nobody reads.
  select 'notification outbox drained',
         (select count(*) from notification_outbox o
           where o.sent_at is null and o.attempts < 5
             and o.created_at < now() - interval '10 minutes'
             and exists (select 1 from push_tokens t where t.profile_id = o.profile_id)) = 0,
         (select 'deliverable_pending=' || count(*) filter (
                    where o.sent_at is null and o.attempts < 5
                      and exists (select 1 from push_tokens t where t.profile_id = o.profile_id))
                 || ' no_device=' || count(*) filter (
                    where o.sent_at is null
                      and not exists (select 1 from push_tokens t where t.profile_id = o.profile_id))
                 || ' exhausted=' || count(*) filter (where o.sent_at is null and o.attempts >= 5)
                 || ' sent=' || count(*) filter (where o.sent_at is not null)
            from notification_outbox o);
$$;

comment on function scheduled_jobs_health() is
  'Phase 10B. One-shot health of the scheduled half of the system: both cron jobs, both extensions, dispatcher Vault configuration, recent cron failures, and outbox depth. "notification outbox drained" allows a 10-minute grace so a row enqueued seconds ago does not read as a fault.';

revoke execute on function scheduled_jobs_health() from public, anon;
grant  execute on function scheduled_jobs_health() to service_role;


-- ============================================================
-- 6. Dispatcher configuration
-- ============================================================
-- Writing the two Vault secrets by hand means remembering whether the row
-- already exists (vault.create_secret fails on a duplicate name, and
-- vault.update_secret needs the id). An operator recovering an incident at
-- 2am should not have to. This upserts both, so re-running it is safe.
--
-- service_role only. It stores the service-role key, so an
-- `authenticated` caller must never be able to reach it - a client that
-- could set `craavee_functions_base_url` could point the scheduler's
-- authenticated POST at a server it controls.
create or replace function configure_dispatcher(p_base_url text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(p_base_url, '') = '' or coalesce(p_key, '') = '' then
    raise exception 'VALIDATION_FAILED: both a base url and a dispatch key are required'
      using errcode = 'P0001';
  end if;

  select id into v_id from vault.secrets where name = 'craavee_functions_base_url';
  if v_id is null then
    perform vault.create_secret(p_base_url, 'craavee_functions_base_url',
                                'Phase 10B. Edge Functions base URL for the scheduled dispatcher tick.');
  else
    perform vault.update_secret(v_id, p_base_url);
  end if;

  select id into v_id from vault.secrets where name = 'craavee_dispatch_key';
  if v_id is null then
    perform vault.create_secret(p_key, 'craavee_dispatch_key',
                                'Phase 10B. Service-role key the dispatcher checks as x-craavee-dispatch-key.');
  else
    perform vault.update_secret(v_id, p_key);
  end if;

  -- Never echo the key back, not even truncated.
  return jsonb_build_object('configured', true, 'baseUrl', p_base_url);
end;
$$;

comment on function configure_dispatcher(text, text) is
  'Phase 10B. Upserts the two Vault secrets dispatch_notifications_tick() reads. service_role only: it stores the service-role key, and a caller who could set the base URL could redirect the scheduler''s authenticated POST. Never returns the key.';

revoke execute on function configure_dispatcher(text, text) from public, anon, authenticated;
grant  execute on function configure_dispatcher(text, text) to service_role;


-- ============================================================
-- 7. Close the claim/send window
-- ============================================================
-- 0010's comment says "`for update skip locked` means two dispatcher runs
-- can never pick up the same row, so a retry or an overlapping invocation
-- cannot double-send." SKIP LOCKED does guarantee that WITHIN the claim
-- transaction. It does not cover the gap that follows it:
--
--   claim (commit: attempts+1, sent_at still null)
--     ... HTTP round-trip to the provider ...
--   mark_notification_sent (sent_at stamped)
--
-- Between those two statements the row is unsent, under the attempt cap,
-- and holds no lock - so a second dispatcher starting in that window
-- claims it again and the user gets the notification twice. Demonstrated
-- by the Phase 10B suite before this change: two genuinely concurrent
-- dispatchers claimed 12 pairs from 6 rows.
--
-- It went unnoticed because nothing ever ran the dispatcher, let alone two
-- of them. Scheduling it every minute is exactly what would have started
-- surfacing it.
--
-- The fix is a visibility window, the same shape every queue uses: record
-- when a row was handed out and do not hand it out again until that lease
-- expires. 60 seconds matches the cron cadence, so a dispatcher that dies
-- mid-send leaves its rows retryable on the next tick and no sooner.
-- Nothing else about the claim changes: same ordering, same attempt cap,
-- same SKIP LOCKED, same fan-out to a profile's devices.
alter table notification_outbox add column if not exists claimed_at timestamptz;

comment on column notification_outbox.claimed_at is
  'Phase 10B. When this row was last handed to a dispatcher. Rows claimed within the last 60s are not re-claimed, which closes the window between claim (attempts+1) and mark_notification_sent (sent_at) in which an overlapping dispatcher would otherwise send the same notification twice.';

create or replace function claim_notification_batch(p_limit integer default 50)
returns table (
  outbox_id uuid,
  order_id  uuid,
  event     text,
  title     text,
  body      text,
  token     text,
  platform  text
)
language plpgsql
set search_path = public
as $$
begin
  return query
  with claimed as (
    select o.id
    from notification_outbox o
    where o.sent_at is null
      and o.attempts < 5
      -- The lease. Unclaimed rows, or rows whose previous claim is old
      -- enough that the dispatcher holding it is certainly gone.
      and (o.claimed_at is null or o.claimed_at < now() - interval '60 seconds')
      -- ...and only rows with somewhere to go. The UPDATE below bumps
      -- `attempts` for every claimed row, but the final SELECT joins
      -- push_tokens - so a profile with no registered device used to burn
      -- one attempt per tick against nothing, exhaust its five, and sit
      -- pending forever. Observed on staging: 12 rows reached attempts=4
      -- in four minutes without a single message being sendable, because
      -- the only token had already been deleted as DeviceNotRegistered.
      --
      -- This matters more than it sounds. Push permission is optional and
      -- often declined, and no environment has EAS credentials yet, so
      -- "profile with no device" is the common case, not the edge one.
      -- `attempts` should count real send attempts.
      and exists (select 1 from push_tokens t where t.profile_id = o.profile_id)
    order by o.created_at
    limit p_limit
    for update skip locked
  ), bumped as (
    update notification_outbox n
       set attempts = n.attempts + 1,
           claimed_at = now()
      from claimed c
     where n.id = c.id
    returning n.id, n.order_id, n.event, n.title, n.body, n.profile_id
  )
  select b.id, b.order_id, b.event, b.title, b.body, t.token, t.platform
  from bumped b
  join push_tokens t on t.profile_id = b.profile_id;
end;
$$;

revoke execute on function claim_notification_batch(integer) from public, anon, authenticated;
grant  execute on function claim_notification_batch(integer) to service_role;

-- A row that failed and should be retried promptly (a provider 500, say)
-- must not wait out the lease pointlessly: releasing the claim on a
-- recorded failure keeps the existing retry cadence intact.
create or replace function mark_notification_sent(p_outbox_id uuid, p_error text default null)
returns void
language sql
set search_path = public
as $$
  update notification_outbox
     set sent_at    = case when p_error is null then now() else sent_at end,
         last_error = p_error,
         claimed_at = case when p_error is null then claimed_at else null end
   where id = p_outbox_id;
$$;

revoke execute on function mark_notification_sent(uuid, text) from public, anon, authenticated;
grant  execute on function mark_notification_sent(uuid, text) to service_role;
