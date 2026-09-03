-- ============================================================
-- 18 — Phase 10B scheduled operations
-- ============================================================
-- The audit's finding was not that the dispatcher was wrong. It was that
-- nothing called it, and that this is invisible: orders keep working and
-- notifications simply never arrive. So the headline here (§A) is that
-- BOTH scheduled jobs exist and are active, and that installing them
-- twice converges on one job rather than two - the failure mode a
-- re-deploy or a restore-then-reinstall would otherwise produce.
--
-- §B pins the stale-runner function as DETECTION ONLY. That is the
-- assertion that stops a later phase quietly turning
-- ORDER_STATE_MACHINE.md row #8's undecided "N minutes" into shipped
-- behaviour.
--
-- §C is the security surface of the new functions, and §D the health
-- check's honesty about an unconfigured environment.
--
-- Whole file rolls back at the end (pgTAP convention).
begin;
create extension if not exists pgtap;
select plan(26);

-- ---------- §A. the schedule itself ----------
select has_extension('pg_cron', 'pg_cron is installed - without it nothing below runs');

select is(
  (select count(*)::int from cron.job where jobname = 'craavee-expire-stale-reservations' and active),
  1, 'A1. the reservation sweep is scheduled and active (0004)');

select is(
  (select count(*)::int from cron.job where jobname = 'craavee-dispatch-notifications' and active),
  1, 'A2. the notification dispatcher is scheduled and active - the gap the audit found');

select is(
  (select schedule from cron.job where jobname = 'craavee-dispatch-notifications'),
  '* * * * *', 'A3. the dispatcher runs every minute, matching the sweep');

select matches(
  (select command from cron.job where jobname = 'craavee-dispatch-notifications')::text,
  'dispatch_notifications_tick', 'A4. the job calls the tick function, not the Edge Function directly');

-- Idempotent installation. cron.schedule upserts on the job name, so a
-- re-applied migration, a repeated deploy, or a post-restore reinstall
-- must all converge on exactly one job.
select cron.schedule('craavee-dispatch-notifications', '* * * * *',
                     $cron$ select public.dispatch_notifications_tick(); $cron$);
select cron.schedule('craavee-dispatch-notifications', '* * * * *',
                     $cron$ select public.dispatch_notifications_tick(); $cron$);

select is(
  (select count(*)::int from cron.job where jobname = 'craavee-dispatch-notifications'),
  1, 'A5. scheduling three times over leaves ONE job, not three');

select is(
  (select count(*)::int from cron.job where jobname like 'craavee-%'),
  2, 'A6. exactly the two Craavee jobs exist - no strays');

-- ---------- §B. stale runner jobs are DETECTION ONLY ----------
select has_function('public', 'stale_runner_jobs', array['integer'],
                    'B1. stale_runner_jobs exists');

select is(
  (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stale_runner_jobs'),
  's', 'B2. it is STABLE - a volatile function could write; this one structurally cannot');

select is(
  (select l.lanname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.proname = 'stale_runner_jobs'),
  'sql', 'B3. plain SQL, not plpgsql - there is no procedural body to hide an UPDATE in');

select doesnt_match(
  (select lower(prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stale_runner_jobs')::text,
  'update ', 'B4. its body contains no UPDATE - automatic release stays BLOCKED');

select doesnt_match(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stale_runner_jobs')::text,
  'audit_logs', 'B5. it writes no audit row - it observes, it does not act');

-- No scheduled job may call it either. Detection is on demand; a
-- scheduled detector is one edit away from a scheduled mutator.
select is(
  (select count(*)::int from cron.job where command like '%stale_runner_jobs%'),
  0, 'B6. nothing schedules the stale-job scan - the policy is undecided, so it stays operator-driven');

-- ---------- fixtures for the behavioural half of §B ----------
insert into stores (id, name, is_open, max_queue_depth)
values ('cc000000-0000-4000-8000-000000000001', '10B Store', true, 9999);

insert into zones (id, store_id, name, delivery_fee, is_serviceable)
values ('cc000000-0000-4000-8000-000000000101', 'cc000000-0000-4000-8000-000000000001', '10B Zone', 1000, true);

insert into auth.users (id, phone) values
  ('cc000000-0000-4000-8000-000000001001', '919720000001'),
  ('cc000000-0000-4000-8000-000000001002', '919720000002'),
  ('cc000000-0000-4000-8000-000000001003', '919720000003');

-- Two runners, because idx_orders_one_live_job_per_runner correctly
-- refuses to let one runner hold both a stalled `assigned` and a stalled
-- `picked_up` order at once. The fixture has to respect the invariant it
-- is not testing.
insert into runners (id, profile_id, store_id, is_online)
values ('cc000000-0000-4000-8000-000000002001', 'cc000000-0000-4000-8000-000000001002',
        'cc000000-0000-4000-8000-000000000001', false),
       ('cc000000-0000-4000-8000-000000002002', 'cc000000-0000-4000-8000-000000001003',
        'cc000000-0000-4000-8000-000000000001', true);

insert into addresses (id, customer_id, zone_id, block, floor, room)
values ('cc000000-0000-4000-8000-000000000201', 'cc000000-0000-4000-8000-000000001001',
        'cc000000-0000-4000-8000-000000000101', 'B', '1', '101');

-- One order assigned two hours ago and never picked up (row #8's shape),
-- one picked up two hours ago and never completed (no System actor at
-- all), and one assigned just now (not stale).
insert into orders (id, customer_id, store_id, address_id, status, subtotal, discount,
                    delivery_fee, wallet_applied, payable, runner_id, assigned_at, picked_up_at,
                    idempotency_key)
values
  ('cc000000-0000-4000-8000-000000000301', 'cc000000-0000-4000-8000-000000001001',
   'cc000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000201',
   'assigned', 5000, 0, 1000, 0, 6000, 'cc000000-0000-4000-8000-000000002001',
   now() - interval '2 hours', null, 'cc000000-0000-4000-8000-000000009001'),
  ('cc000000-0000-4000-8000-000000000302', 'cc000000-0000-4000-8000-000000001001',
   'cc000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000201',
   'picked_up', 5000, 0, 1000, 0, 6000, 'cc000000-0000-4000-8000-000000002002',
   now() - interval '3 hours', now() - interval '2 hours', 'cc000000-0000-4000-8000-000000009002'),
  ('cc000000-0000-4000-8000-000000000303', 'cc000000-0000-4000-8000-000000001001',
   'cc000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000201',
   'assigned', 5000, 0, 1000, 0, 6000, null, now(), null, 'cc000000-0000-4000-8000-000000009003');

select is(
  (select count(*)::int from stale_runner_jobs(30)
    where order_id in ('cc000000-0000-4000-8000-000000000301',
                       'cc000000-0000-4000-8000-000000000302')),
  2, 'B7. both stalled jobs are detected at a 30-minute threshold');

select is(
  (select count(*)::int from stale_runner_jobs(30)
    where order_id = 'cc000000-0000-4000-8000-000000000303'),
  0, 'B8. a freshly assigned order is not stale');

select is(
  (select count(*)::int from stale_runner_jobs(300)
    where order_id in ('cc000000-0000-4000-8000-000000000301',
                       'cc000000-0000-4000-8000-000000000302')),
  0, 'B9. the threshold is the caller''s, not a stored policy - 300 minutes finds neither');

select is(
  (select legal_system_exit from stale_runner_jobs(30)
    where order_id = 'cc000000-0000-4000-8000-000000000301'),
  true, 'B10. a stalled `assigned` order is flagged as having a legal system exit (row #8)');

select is(
  (select legal_system_exit from stale_runner_jobs(30)
    where order_id = 'cc000000-0000-4000-8000-000000000302'),
  false, 'B11. a stalled `picked_up` order has NO system actor - operator only');

-- The observation must not have moved anything.
select is(
  (select status::text from orders where id = 'cc000000-0000-4000-8000-000000000301'),
  'assigned', 'B12. detecting a stale job does not release it');

select is(
  (select runner_id from orders where id = 'cc000000-0000-4000-8000-000000000301'),
  'cc000000-0000-4000-8000-000000002001'::uuid, 'B13. the runner still holds it');

select is(
  (select count(*)::int from audit_logs
    where entity_id = 'cc000000-0000-4000-8000-000000000301' and action = 'order.released'),
  0, 'B14. no release was audited, because none happened');

-- ---------- §C. security surface ----------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('dispatch_notifications_tick', 'stale_runner_jobs',
                        'scheduled_jobs_health', 'configure_dispatcher')
      and p.prosecdef
      and p.proconfig is not null),
  4, 'C1. all four new functions are SECURITY DEFINER with a pinned search_path');

select ok(
  (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('dispatch_notifications_tick', 'scheduled_jobs_health', 'configure_dispatcher')),
  'C2. no client role can invoke the scheduler, the health check, or the configurator');

select ok(
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('dispatch_notifications_tick', 'stale_runner_jobs',
                        'scheduled_jobs_health', 'configure_dispatcher')),
  'C3. anon can invoke none of them');

-- ---------- §D. the health check tells the truth ----------
select is(
  (select ok from scheduled_jobs_health() where check_name = 'notification dispatcher scheduled'),
  true, 'D1. health reports the dispatcher as scheduled');

select ok(
  (select count(*) from scheduled_jobs_health()) = 7,
  'D2. all seven health checks report');

select finish();
rollback;
