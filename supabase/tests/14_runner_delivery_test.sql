-- ============================================================
-- 14 — Runner + last-mile delivery (Phase 7)
--
-- Unit tests of the migration 0007 functions over psql (RLS bypassed on
-- purpose — these test FUNCTION logic; the Edge Function auth/envelope
-- layer and genuine concurrency are covered by the integration suite in
-- apps/customer-runner/__tests__/runner.integration.test.ts).
--
-- Canonical: API_CONTRACTS.md §"Fulfilment Claim & Handoff",
-- ORDER_STATE_MACHINE.md #7/#8/#10/#11/#13, RBAC_MATRIX.md §4/§5,
-- DECISION_LOG.md D13/D14/D28, and D39 (Phase 7, delivery-code storage).
--
-- Whole file rolls back at the end (pgTAP convention).
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(89);

-- ---- fixtures -------------------------------------------------
insert into stores (id, name, is_open, max_queue_depth) values
  ('c7000000-0000-4000-8000-000000000001', 'P7 Store A', true, 9999),
  ('c7000000-0000-4000-8000-000000000002', 'P7 Store B', true, 9999);

insert into zones (id, store_id, name, delivery_fee, is_serviceable) values
  ('c7000000-0000-4000-8000-000000000101', 'c7000000-0000-4000-8000-000000000001', 'Zone A', 1500, true),
  ('c7000000-0000-4000-8000-000000000102', 'c7000000-0000-4000-8000-000000000002', 'Zone B', 1500, true);

insert into auth.users (id, phone) values
  ('c7000000-0000-4000-8000-000000001001', '919971000001'),  -- customer
  ('c7000000-0000-4000-8000-000000001002', '919971000002'),  -- runner A  @ store A
  ('c7000000-0000-4000-8000-000000001003', '919971000003'),  -- runner B  @ store A
  ('c7000000-0000-4000-8000-000000001004', '919971000004'),  -- runner C  @ store B
  ('c7000000-0000-4000-8000-000000001005', '919971000005'),  -- packer    @ store A
  ('c7000000-0000-4000-8000-000000001006', '919971000006'),  -- admin
  ('c7000000-0000-4000-8000-000000001007', '919971000007');  -- runner D @ store A (kept free)

insert into staff_roles (profile_id, role, store_id) values
  ('c7000000-0000-4000-8000-000000001002', 'runner', 'c7000000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000001003', 'runner', 'c7000000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000001004', 'runner', 'c7000000-0000-4000-8000-000000000002'),
  ('c7000000-0000-4000-8000-000000001005', 'packer', 'c7000000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000001006', 'admin',  null),
  ('c7000000-0000-4000-8000-000000001007', 'runner', 'c7000000-0000-4000-8000-000000000001');

insert into runners (id, profile_id, store_id, is_online) values
  ('c7000000-0000-4000-8000-00000000ba01'::uuid, 'c7000000-0000-4000-8000-000000001002', 'c7000000-0000-4000-8000-000000000001', true),
  ('c7000000-0000-4000-8000-00000000ba02'::uuid, 'c7000000-0000-4000-8000-000000001003', 'c7000000-0000-4000-8000-000000000001', true),
  ('c7000000-0000-4000-8000-00000000ba03'::uuid, 'c7000000-0000-4000-8000-000000001004', 'c7000000-0000-4000-8000-000000000002', true),
  ('c7000000-0000-4000-8000-00000000ba04'::uuid, 'c7000000-0000-4000-8000-000000001007', 'c7000000-0000-4000-8000-000000000001', true);

insert into addresses (id, customer_id, zone_id, block, floor, room, landmark) values
  ('c7000000-0000-4000-8000-000000002001', 'c7000000-0000-4000-8000-000000001001',
   'c7000000-0000-4000-8000-000000000101', 'B', '3', '301', 'near the gate');

insert into products (id, store_id, name, mrp, sale_price, category, is_listed) values
  ('c7000000-0000-4000-8000-000000003001', 'c7000000-0000-4000-8000-000000000001', 'P7 Prod', 6000, 5000, 'Snacks', true);

insert into inventory (store_id, product_id, qty_on_hand, qty_reserved) values
  ('c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000003001', 50, 0);

insert into profiles (id, phone, wallet_balance) values
  ('c7000000-0000-4000-8000-000000001001', '919971000001', 0)
on conflict (id) do update set wallet_balance = 0;

-- Four packed orders at store A, one at store B.
insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee,
                    wallet_applied, payable, payment_status, idempotency_key, confirmed_at, packed_at)
values
  ('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001001',
   'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000002001',
   'packed', 5000, 1500, 0, 6500, 'captured', 'c7000000-0000-4000-8000-00000000a001', now(), now()),
  ('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001001',
   'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000002001',
   'packed', 5000, 1500, 0, 6500, 'captured', 'c7000000-0000-4000-8000-00000000a002', now(), now()),
  ('c7000000-0000-4000-8000-000000005003', 'c7000000-0000-4000-8000-000000001001',
   'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000002001',
   'confirmed', 5000, 1500, 0, 6500, 'captured', 'c7000000-0000-4000-8000-00000000a003', now(), null),
  ('c7000000-0000-4000-8000-000000005004', 'c7000000-0000-4000-8000-000000001001',
   'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000002001',
   'packed', 5000, 1500, 0, 6500, 'captured', 'c7000000-0000-4000-8000-00000000a004', now(), now());

insert into order_items (id, order_id, product_id, qty, unit_price) values
  ('c7000000-0000-4000-8000-000000006001', 'c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000003001', 2, 2500),
  ('c7000000-0000-4000-8000-000000006002', 'c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000003001', 1, 5000),
  ('c7000000-0000-4000-8000-000000006004', 'c7000000-0000-4000-8000-000000005004', 'c7000000-0000-4000-8000-000000003001', 1, 5000);

insert into payments (order_id, gateway, amount, status, gateway_order_ref, gateway_payment_ref) values
  ('c7000000-0000-4000-8000-000000005001', 'razorpay', 6500, 'captured', 'ord_p7_1', 'pay_p7_1'),
  ('c7000000-0000-4000-8000-000000005002', 'razorpay', 6500, 'captured', 'ord_p7_2', 'pay_p7_2'),
  ('c7000000-0000-4000-8000-000000005003', 'razorpay', 6500, 'captured', 'ord_p7_3', 'pay_p7_3'),
  ('c7000000-0000-4000-8000-000000005004', 'razorpay', 6500, 'captured', 'ord_p7_4', 'pay_p7_4');

-- ============================================================
-- A. Schema (D39)
-- ============================================================
select has_table('public'::name, 'order_delivery_codes'::name,
  'order_delivery_codes exists — plaintext lives off `orders` so the runner cannot read it');
select has_column('public'::name, 'order_delivery_codes'::name, 'code'::name,
  'order_delivery_codes.code exists');
select col_is_pk('public'::name, 'order_delivery_codes'::name, 'order_id'::name,
  'one live code per order');
select has_index('public'::name, 'orders'::name, 'idx_orders_one_live_job_per_runner'::name,
  'the one-live-job partial unique index is still present (0001, D13)');

-- RLS must be ON, and the only policy is the customer read. A runner
-- policy here would defeat D14 entirely.
select is(
  (select relrowsecurity from pg_class where relname = 'order_delivery_codes'),
  true, 'RLS is enabled on order_delivery_codes');
select is(
  (select count(*)::int from pg_policies where tablename = 'order_delivery_codes'),
  1, 'exactly one policy on order_delivery_codes — the customer read');
select is(
  (select cmd from pg_policies where tablename = 'order_delivery_codes'),
  'SELECT', 'that policy is read-only: no authenticated write path to a delivery code');

-- ============================================================
-- B. claim_job — authorization (§8)
-- ============================================================
select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001001') $$,
  'P0001', null, 'claim-: a customer (no staff role) is FORBIDDEN');

select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001005') $$,
  'P0001', null, 'claim-: a packer may not claim a delivery job');

select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001004') $$,
  'P0001', null, 'claim-: a runner from another store is FORBIDDEN (store scoping)');

select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001006') $$,
  'P0001', null, 'claim-: an admin has no runners.id and cannot claim as one');

select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-0000000059ff', 'c7000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'claim-: a non-existent order fails validation');

-- Offline runners are not eligible (§8 "verify runner is active").
update runners set is_online = false where id = 'c7000000-0000-4000-8000-00000000ba01';
select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'claim-: an offline runner is FORBIDDEN');
update runners set is_online = true where id = 'c7000000-0000-4000-8000-00000000ba01';

-- Only a `packed` order is claimable.
select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005003', 'c7000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'claim-: a `confirmed` (not yet packed) order is not claimable');

-- ============================================================
-- C. claim_job — the happy path (#7)
-- ============================================================
select lives_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001002') $$,
  'claim+: runner A claims a packed order at their own store');

select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  'assigned'::order_status, 'claim+: status is now assigned');
select is((select runner_id from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  'c7000000-0000-4000-8000-00000000ba01'::uuid, 'claim+: runner_id is the resolved runners.id, not the profile id (D28)');
select isnt((select assigned_at from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  null, 'claim+: assigned_at was stamped by the trigger, not the function');
select isnt((select delivery_code_hash from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  null, 'claim+: a delivery code hash was minted at assignment (D14)');
select is((select count(*)::int from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005001'),
  1, 'claim+: the customer-readable plaintext row was created');
select matches(
  (select code from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005001'),
  '^\d{4}$', 'claim+: the code is exactly 4 digits (D14)');

-- The stored hash must actually verify against the plaintext, and must
-- not BE the plaintext.
select is(
  (select extensions.crypt(c.code, o.delivery_code_hash) = o.delivery_code_hash
     from orders o join order_delivery_codes c on c.order_id = o.id
    where o.id = 'c7000000-0000-4000-8000-000000005001'),
  true, 'claim+: the bcrypt hash verifies against the issued code');
select isnt(
  (select o.delivery_code_hash from orders o where o.id = 'c7000000-0000-4000-8000-000000005001'),
  (select c.code from order_delivery_codes c where c.order_id = 'c7000000-0000-4000-8000-000000005001'),
  'claim+: the stored hash is not the plaintext');

select is((select action from audit_logs where entity_id = 'c7000000-0000-4000-8000-000000005001' and action = 'order.assigned'),
  'order.assigned', 'claim+: an order.assigned audit row was written');
select is(
  (select (metadata ? 'code') or (metadata::text like '%' || (select code from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005001') || '%')
     from audit_logs where entity_id = 'c7000000-0000-4000-8000-000000005001' and action = 'order.assigned'),
  false, 'claim+: the audit metadata does not contain the delivery code');

-- ============================================================
-- D. One live job per runner (§7)
-- ============================================================
select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'claim-: a runner holding a live job cannot claim a second (RUNNER_ALREADY_ASSIGNED)');

select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  'packed'::order_status, 'claim-: the rejected second order is untouched');

-- A different runner at the same store is unaffected.
select lives_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001003') $$,
  'claim+: a different free runner can claim a different order');

-- The database backstop itself, independent of the function's check.
-- The partial unique index only covers status in ('assigned','picked_up'),
-- so the write has to actually try to create a SECOND live row for the
-- same runner to exercise it.
select throws_ok(
  $$ update orders set runner_id = 'c7000000-0000-4000-8000-00000000ba01', status = 'assigned'
      where id = 'c7000000-0000-4000-8000-000000005004' $$,
  '23505', null, 'backstop: the partial unique index refuses a runner a second live job even on a direct write');

-- ============================================================
-- E. claim_job on an already-claimed order (§6)
-- ============================================================
select throws_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001003') $$,
  'P0001', null, 'claim-: a second runner claiming an assigned order gets JOB_ALREADY_CLAIMED');

-- ============================================================
-- F. mark_picked_up (#10)
-- ============================================================
select throws_ok(
  $$ select process_mark_picked_up('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001003') $$,
  'P0001', null, 'pickup-: a runner who is not the assignee is FORBIDDEN');

select throws_ok(
  $$ select process_mark_picked_up('c7000000-0000-4000-8000-000000005004', 'c7000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'pickup-: packed -> picked_up is rejected (the claim step cannot be skipped)');

select lives_ok(
  $$ select process_mark_picked_up('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001002') $$,
  'pickup+: the assigned runner confirms pickup');
select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  'picked_up'::order_status, 'pickup+: status is picked_up');
select isnt((select picked_up_at from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  null, 'pickup+: picked_up_at was stamped');

select is(
  (select (process_mark_picked_up('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001002') ->> 'alreadyPickedUp')::boolean),
  true, 'pickup+: a duplicate call is idempotent, not an error');

-- ============================================================
-- G. verify_delivery_code (#11, D14)
-- ============================================================
select throws_ok(
  $$ select process_verify_delivery_code('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001003', '0000') $$,
  'P0001', null, 'verify-: a runner who is not the assignee is FORBIDDEN');

-- An `assigned` order cannot jump straight to delivered even with a
-- valid-looking code — order 5002 is assigned to runner B.
select throws_ok(
  $$ select process_verify_delivery_code(
       'c7000000-0000-4000-8000-000000005002',
       'c7000000-0000-4000-8000-000000001003',
       (select code from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005002')) $$,
  'P0001', null, 'verify-: assigned -> delivered is rejected even with the correct code (pickup cannot be skipped)');

select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  'assigned'::order_status, 'verify-: that order is still assigned');

-- Wrong code on a genuinely picked-up order.
select is(
  (select process_verify_delivery_code('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001002', '0000') ->> 'error'),
  'DELIVERY_CODE_INVALID', 'verify-: an incorrect code returns DELIVERY_CODE_INVALID');
select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  'picked_up'::order_status, 'verify-: a wrong guess does not change state');
select is((select count(*)::int from rate_limit_events
            where subject = 'c7000000-0000-4000-8000-000000005001' and action = 'delivery_code_attempt'),
  1, 'verify-: the failed attempt was logged before the comparison');

-- Correct code.
select lives_ok(
  $$ select process_verify_delivery_code(
       'c7000000-0000-4000-8000-000000005001',
       'c7000000-0000-4000-8000-000000001002',
       (select code from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005001')) $$,
  'verify+: the correct code completes the delivery');
select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  'delivered'::order_status, 'verify+: status is delivered');
select isnt((select delivered_at from orders where id = 'c7000000-0000-4000-8000-000000005001'),
  null, 'verify+: delivered_at was stamped');
select is((select count(*)::int from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005001'),
  0, 'verify+: the plaintext code was deleted once it was no longer needed');
select is((select amount from runner_earnings where order_id = 'c7000000-0000-4000-8000-000000005001'),
  1500, 'verify+: a runner_earnings row was created for the delivery fee');
select is((select runner_id from runner_earnings where order_id = 'c7000000-0000-4000-8000-000000005001'),
  'c7000000-0000-4000-8000-00000000ba01'::uuid, 'verify+: earnings are credited to the delivering runner');
select is((select settled_at from runner_earnings where order_id = 'c7000000-0000-4000-8000-000000005001'),
  null, 'verify+: the earnings row is unsettled');

-- Duplicate verification.
select is(
  (select (process_verify_delivery_code('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001002', '1234') ->> 'alreadyDelivered')::boolean),
  true, 'verify+: a duplicate verification is idempotent, not a second delivery');
select is((select count(*)::int from runner_earnings where order_id = 'c7000000-0000-4000-8000-000000005001'),
  1, 'verify+: exactly one earnings row after the duplicate call');

-- `delivered` is terminal.
select throws_ok(
  $$ select process_mark_picked_up('c7000000-0000-4000-8000-000000005001', 'c7000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'terminal: delivered -> picked_up is rejected');

-- ============================================================
-- H. Rate limiting (§12, D14)
-- ============================================================
-- Order 5004: claimed by a free runner, picked up, then guessed at.
select lives_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005004', 'c7000000-0000-4000-8000-000000001002') $$,
  'ratelimit setup: runner A is free again after delivering, and claims another job');
select lives_ok(
  $$ select process_mark_picked_up('c7000000-0000-4000-8000-000000005004', 'c7000000-0000-4000-8000-000000001002') $$,
  'ratelimit setup: picked up');

-- Five wrong guesses are allowed; the sixth is refused outright.
select is((select process_verify_delivery_code('c7000000-0000-4000-8000-000000005004','c7000000-0000-4000-8000-000000001002','0001') ->> 'error'), 'DELIVERY_CODE_INVALID', 'ratelimit: guess 1 rejected as invalid');
select is((select process_verify_delivery_code('c7000000-0000-4000-8000-000000005004','c7000000-0000-4000-8000-000000001002','0002') ->> 'error'), 'DELIVERY_CODE_INVALID', 'ratelimit: guess 2 rejected as invalid');
select is((select process_verify_delivery_code('c7000000-0000-4000-8000-000000005004','c7000000-0000-4000-8000-000000001002','0003') ->> 'error'), 'DELIVERY_CODE_INVALID', 'ratelimit: guess 3 rejected as invalid');
select is((select process_verify_delivery_code('c7000000-0000-4000-8000-000000005004','c7000000-0000-4000-8000-000000001002','0004') ->> 'error'), 'DELIVERY_CODE_INVALID', 'ratelimit: guess 4 rejected as invalid');
select is((select process_verify_delivery_code('c7000000-0000-4000-8000-000000005004','c7000000-0000-4000-8000-000000001002','0005') ->> 'error'), 'DELIVERY_CODE_INVALID', 'ratelimit: guess 5 rejected as invalid');

select is((select count(*)::int from rate_limit_events
            where subject = 'c7000000-0000-4000-8000-000000005004' and action = 'delivery_code_attempt'),
  5, 'ratelimit: all five attempts were recorded');

-- The 6th is RATE_LIMITED even if the code is correct — this is the
-- assertion that makes a 10,000-wide space safe.
select is(
  (select process_verify_delivery_code(
       'c7000000-0000-4000-8000-000000005004',
       'c7000000-0000-4000-8000-000000001002',
       (select code from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005004')) ->> 'error'),
  'RATE_LIMITED', 'ratelimit: the 6th attempt is refused even with the CORRECT code');
select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005004'),
  'picked_up'::order_status, 'ratelimit: the order was not delivered by the rate-limited attempt');

-- The budget is per order, so another order is unaffected.
select is((select count(*)::int from rate_limit_events
            where subject = 'c7000000-0000-4000-8000-000000005002' and action = 'delivery_code_attempt'),
  0, 'ratelimit: the budget is scoped per order, not per runner');

-- ============================================================
-- I. release_job (#8)
-- ============================================================
select throws_ok(
  $$ select process_release_job('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001002', null) $$,
  'P0001', null, 'release-: a runner cannot release another runner''s job');

select is((select count(*)::int from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005002'),
  1, 'release setup: order 5002 currently has a live code');

select lives_ok(
  $$ select process_release_job('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001003', 'phone dying') $$,
  'release+: the assigned runner releases their own job');
select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  'packed'::order_status, 'release+: the order is claimable again');
select is((select runner_id from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  null, 'release+: runner_id was cleared by the trigger');
select is((select assigned_at from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  null, 'release+: assigned_at was cleared by the trigger');
select is((select count(*)::int from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005002'),
  0, 'release+: the released runner''s delivery code was destroyed');
select is((select delivery_code_hash from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  null, 'release+: the hash was cleared too, so the old code cannot complete a delivery');

-- ============================================================
-- J. admin_reassign (#13 and the same-status swap)
-- ============================================================
select throws_ok(
  $$ select process_admin_reassign('c7000000-0000-4000-8000-000000005004', 'c7000000-0000-4000-8000-000000001003', 'c7000000-0000-4000-8000-00000000ba02') $$,
  'P0001', null, 'reassign-: a runner may not reassign (admin only)');

select throws_ok(
  $$ select process_admin_reassign('c7000000-0000-4000-8000-000000005004', 'c7000000-0000-4000-8000-000000001006', 'c7000000-0000-4000-8000-00000000ba03') $$,
  'P0001', null, 'reassign-: the target runner must belong to this order''s store');

-- 5004 is picked_up by runner A, and reassign is only legal from
-- `assigned` or `delivery_failed`.
select throws_ok(
  $$ select process_admin_reassign('c7000000-0000-4000-8000-000000005004', 'c7000000-0000-4000-8000-000000001006', 'c7000000-0000-4000-8000-00000000ba02') $$,
  'P0001', null, 'reassign-: a picked_up order cannot be reassigned');

-- Reach `assigned` the legitimate way: order 5002 was released back to
-- `packed` above, so runner B can claim it. No fixture write forces a
-- status here - the state machine is exercised, not bypassed.
select lives_ok(
  $$ select process_claim_job('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001003') $$,
  'reassign setup: runner B re-claims the released order');
select is((select runner_id from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  'c7000000-0000-4000-8000-00000000ba02'::uuid, 'reassign setup: runner B owns it');

select lives_ok(
  $$ select process_admin_reassign('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001006', 'c7000000-0000-4000-8000-00000000ba04') $$,
  'reassign+: an admin moves an assigned job from runner B to runner D');
select is((select runner_id from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  'c7000000-0000-4000-8000-00000000ba04'::uuid, 'reassign+: runner D now owns the job');
select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  'assigned'::order_status, 'reassign+: the order remains in a legal state');
select is((select count(*)::int from orders
            where runner_id = 'c7000000-0000-4000-8000-00000000ba02' and status in ('assigned','picked_up')),
  0, 'reassign+: runner B no longer holds the job');
select is((select count(*)::int from orders
            where runner_id = 'c7000000-0000-4000-8000-00000000ba04' and status in ('assigned','picked_up')),
  1, 'reassign+: exactly one live job for runner D — no duplicate assignment');

-- A fresh code, so the replaced runner cannot still complete it.
select is(
  (select extensions.crypt(c.code, o.delivery_code_hash) = o.delivery_code_hash
     from orders o join order_delivery_codes c on c.order_id = o.id
    where o.id = 'c7000000-0000-4000-8000-000000005002'),
  true, 'reassign+: a fresh delivery code was minted for the new runner');

select is((select action from audit_logs
            where entity_id = 'c7000000-0000-4000-8000-000000005002' and action = 'order.reassigned'),
  'order.reassigned', 'reassign+: an order.reassigned audit row was written');

-- Runner A is still holding 5004 (picked_up), so they are not a valid
-- reassignment target.
select throws_ok(
  $$ select process_admin_reassign('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001006', 'c7000000-0000-4000-8000-00000000ba01') $$,
  'P0001', null, 'reassign-: cannot reassign to a runner who already has a live job');
select is((select runner_id from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  'c7000000-0000-4000-8000-00000000ba04'::uuid, 'reassign-: the refused reassignment changed nothing');

-- Release to the general queue (runnerId omitted).
select lives_ok(
  $$ select process_admin_reassign('c7000000-0000-4000-8000-000000005002', 'c7000000-0000-4000-8000-000000001006', null) $$,
  'reassign+: omitting the runner releases the order back to the claim queue');
select is((select status from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  'packed'::order_status, 'reassign+: the order is claimable again');
select is((select runner_id from orders where id = 'c7000000-0000-4000-8000-000000005002'),
  null, 'reassign+: no runner owns it');
select is((select count(*)::int from order_delivery_codes where order_id = 'c7000000-0000-4000-8000-000000005002'),
  0, 'reassign+: the code was destroyed on release to the queue');

select * from finish();
rollback;
