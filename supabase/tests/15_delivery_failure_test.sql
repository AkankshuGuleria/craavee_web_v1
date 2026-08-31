-- ============================================================
-- 15 — Delivery failure (Phase 8, Part A)
--
-- ORDER_STATE_MACHINE.md #12: picked_up -> delivery_failed, actor
-- `runner` (own job) or `admin`, reason required, NO wallet/payment
-- effect ("none yet — see #13/#14 for resolution"), audit row carries
-- the reason.
--
-- Whole file rolls back at the end (pgTAP convention).
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(40);

insert into stores (id, name, is_open, max_queue_depth) values
  ('c8000000-0000-4000-8000-000000000001', 'P8 Store A', true, 9999);
insert into zones (id, store_id, name, delivery_fee, is_serviceable) values
  ('c8000000-0000-4000-8000-000000000101', 'c8000000-0000-4000-8000-000000000001', 'Zone A', 1500, true);

insert into auth.users (id, phone) values
  ('c8000000-0000-4000-8000-000000001001', '919981000001'),  -- customer
  ('c8000000-0000-4000-8000-000000001002', '919981000002'),  -- runner A
  ('c8000000-0000-4000-8000-000000001003', '919981000003'),  -- runner B
  ('c8000000-0000-4000-8000-000000001004', '919981000004'),  -- packer
  ('c8000000-0000-4000-8000-000000001005', '919981000005');  -- admin

insert into staff_roles (profile_id, role, store_id) values
  ('c8000000-0000-4000-8000-000000001002', 'runner', 'c8000000-0000-4000-8000-000000000001'),
  ('c8000000-0000-4000-8000-000000001003', 'runner', 'c8000000-0000-4000-8000-000000000001'),
  ('c8000000-0000-4000-8000-000000001004', 'packer', 'c8000000-0000-4000-8000-000000000001'),
  ('c8000000-0000-4000-8000-000000001005', 'admin',  null);

insert into runners (id, profile_id, store_id, is_online) values
  ('c8000000-0000-4000-8000-00000000ca01', 'c8000000-0000-4000-8000-000000001002', 'c8000000-0000-4000-8000-000000000001', true),
  ('c8000000-0000-4000-8000-00000000ca02', 'c8000000-0000-4000-8000-000000001003', 'c8000000-0000-4000-8000-000000000001', true);

insert into addresses (id, customer_id, zone_id, block, room) values
  ('c8000000-0000-4000-8000-000000002001', 'c8000000-0000-4000-8000-000000001001',
   'c8000000-0000-4000-8000-000000000101', 'D', '12');

insert into products (id, store_id, name, mrp, sale_price, category, is_listed) values
  ('c8000000-0000-4000-8000-000000003001', 'c8000000-0000-4000-8000-000000000001', 'P8 Prod', 6000, 5000, 'Snacks', true);
insert into inventory (store_id, product_id, qty_on_hand, qty_reserved) values
  ('c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000003001', 50, 0);

insert into profiles (id, phone, wallet_balance) values
  ('c8000000-0000-4000-8000-000000001001', '919981000001', 0)
on conflict (id) do update set wallet_balance = 0;

-- Two packed orders.
insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee,
                    wallet_applied, payable, payment_status, idempotency_key, confirmed_at, packed_at)
values
  ('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001001',
   'c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000002001',
   'packed', 5000, 1500, 0, 6500, 'captured', 'c8000000-0000-4000-8000-00000000a001', now(), now()),
  ('c8000000-0000-4000-8000-000000005002', 'c8000000-0000-4000-8000-000000001001',
   'c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000002001',
   'packed', 5000, 1500, 0, 6500, 'captured', 'c8000000-0000-4000-8000-00000000a002', now(), now());

insert into order_items (id, order_id, product_id, qty, unit_price) values
  ('c8000000-0000-4000-8000-000000006001', 'c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000003001', 1, 5000),
  ('c8000000-0000-4000-8000-000000006002', 'c8000000-0000-4000-8000-000000005002', 'c8000000-0000-4000-8000-000000003001', 1, 5000);

insert into payments (order_id, gateway, amount, status, gateway_order_ref, gateway_payment_ref) values
  ('c8000000-0000-4000-8000-000000005001', 'razorpay', 6500, 'captured', 'ord_p8_1', 'pay_p8_1'),
  ('c8000000-0000-4000-8000-000000005002', 'razorpay', 6500, 'captured', 'ord_p8_2', 'pay_p8_2');

-- Drive order 1 to picked_up through the real path.
select lives_ok(
  $$ select process_claim_job('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001002') $$,
  'setup: runner A claims order 1');
select lives_ok(
  $$ select process_mark_picked_up('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001002') $$,
  'setup: runner A picks up order 1');

-- ============================================================
-- A. The transition exists at all (the Phase 7 hole)
-- ============================================================
select has_function('public'::name, 'process_mark_delivery_failed'::name,
  'process_mark_delivery_failed exists — picked_up now has a failure exit');
select is(
  (select count(*)::int from order_transition_rules
    where from_status = 'picked_up' and to_status = 'delivery_failed'),
  2, 'picked_up -> delivery_failed is a legal transition for exactly two actors (runner, admin)');
select is(
  (select count(*)::int from order_transition_rules
    where from_status = 'picked_up' and to_status = 'packed'),
  0, 'picked_up -> packed is still NOT legal — release_job genuinely could not help here');

-- ============================================================
-- B. Authorization (§27.3, §27.4, §5)
-- ============================================================
select throws_ok(
  $$ select process_mark_delivery_failed('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001001', 'nobody home') $$,
  'P0001', null, 'fail-: a customer cannot force a delivery failure');

select throws_ok(
  $$ select process_mark_delivery_failed('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001004', 'nobody home') $$,
  'P0001', null, 'fail-: a packer cannot report a delivery failure');

select throws_ok(
  $$ select process_mark_delivery_failed('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001003', 'nobody home') $$,
  'P0001', null, 'fail-: a runner who is not the assignee is FORBIDDEN');

select is((select status from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  'picked_up'::order_status, 'fail-: none of the refused attempts changed the order');

-- ============================================================
-- C. Reason is required (API_CONTRACTS: "reason: string, required")
-- ============================================================
select throws_ok(
  $$ select process_mark_delivery_failed('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001002', null) $$,
  'P0001', null, 'fail-: a null reason is rejected');
select throws_ok(
  $$ select process_mark_delivery_failed('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001002', '   ') $$,
  'P0001', null, 'fail-: a blank reason is rejected');

-- ============================================================
-- D. Invalid source states (§27.2)
-- ============================================================
select throws_ok(
  $$ select process_mark_delivery_failed('c8000000-0000-4000-8000-000000005002', 'c8000000-0000-4000-8000-000000001002', 'x') $$,
  'P0001', null, 'fail-: a `packed` order cannot go straight to delivery_failed');

-- ============================================================
-- E. The happy path (§27.1)
-- ============================================================
select lives_ok(
  $$ select process_mark_delivery_failed('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001002', 'customer unreachable, phone off') $$,
  'fail+: the assigned runner reports a delivery failure');

select is((select status from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  'delivery_failed'::order_status, 'fail+: status is delivery_failed');

-- #12 writes no timestamp, and the runner stays attributable.
select is((select delivered_at from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  null, 'fail+: delivered_at was NOT set — the order never became both delivered and failed');
select is((select runner_id from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  'c8000000-0000-4000-8000-00000000ca01'::uuid,
  'fail+: the runner stays on the order (#12 does not clear runner_id) so it remains attributable');

-- The code is destroyed: the failed attempt must not stay completable.
select is((select count(*)::int from order_delivery_codes where order_id = 'c8000000-0000-4000-8000-000000005001'),
  0, 'fail+: the plaintext delivery code was destroyed');
select is((select delivery_code_hash from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  null, 'fail+: the hash was cleared, so the failed runner cannot still complete the delivery');

-- ============================================================
-- F. Financial consistency (§27.9, §6)
-- ============================================================
select is((select payment_status from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  'captured'::payment_status, 'money+: payment stays captured — a failure is not itself a refund event (#12)');
-- refunds reaches an order through payments (D29), not directly.
select is(
  (select count(*)::int from refunds r
     join payments p on p.id = r.payment_id
    where p.order_id = 'c8000000-0000-4000-8000-000000005001'),
  0, 'money+: no refund was created automatically');
select is((select count(*)::int from wallet_ledger where customer_id = 'c8000000-0000-4000-8000-000000001001'),
  0, 'money+: the wallet was not touched');
select is((select wallet_balance from profiles where id = 'c8000000-0000-4000-8000-000000001001'),
  0, 'money+: wallet balance unchanged');
select is((select payable from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  6500, 'money+: payable unchanged');
-- The pair must still be one the consistency trigger accepts.
select is(
  (select count(*)::int from payment_order_consistency_rules
    where order_status = 'delivery_failed' and payment_status = 'captured'),
  1, 'money+: (delivery_failed, captured) is a valid resting pair');

-- Inventory untouched. These fixtures insert orders already in `packed`
-- rather than running mark_packed, so no reservation was ever consumed
-- here - the assertion is simply that the failure itself moves nothing.
-- (#12's inventory column is "none"; stock is consumed at pack time and
-- a failed delivery does not put it back - the bag physically exists.)
select is((select qty_on_hand from inventory
            where store_id = 'c8000000-0000-4000-8000-000000000001'
              and product_id = 'c8000000-0000-4000-8000-000000003001'),
  50, 'stock+: qty_on_hand is unchanged by the failure');
select is((select qty_reserved from inventory
            where store_id = 'c8000000-0000-4000-8000-000000000001'
              and product_id = 'c8000000-0000-4000-8000-000000003001'),
  0, 'stock+: qty_reserved is unchanged by the failure');

-- ============================================================
-- G. Audit (§27.10, §7)
-- ============================================================
select is((select action from audit_logs
            where entity_id = 'c8000000-0000-4000-8000-000000005001' and action = 'order.delivery_failed'),
  'order.delivery_failed', 'audit+: an order.delivery_failed row was written');
select is((select metadata ->> 'reason' from audit_logs
            where entity_id = 'c8000000-0000-4000-8000-000000005001' and action = 'order.delivery_failed'),
  'customer unreachable, phone off', 'audit+: the reason is recorded');
select is((select metadata ->> 'runnerId' from audit_logs
            where entity_id = 'c8000000-0000-4000-8000-000000005001' and action = 'order.delivery_failed'),
  'c8000000-0000-4000-8000-00000000ca01', 'audit+: the attempting runner is recorded');

-- ============================================================
-- H. Idempotency (§27.6)
-- ============================================================
select is(
  (select (process_mark_delivery_failed('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001002', 'again') ->> 'alreadyFailed')::boolean),
  true, 'idempotent: a duplicate failure report is safe, not an error');
select is((select count(*)::int from audit_logs
            where entity_id = 'c8000000-0000-4000-8000-000000005001' and action = 'order.delivery_failed'),
  1, 'idempotent: the replay did not write a second audit row');

-- ============================================================
-- I. Terminal-ish behaviour and recovery (§27.8, §3)
-- ============================================================
-- A failed order is NOT claimable: claim_job only ever selects `packed`.
select throws_ok(
  $$ select process_claim_job('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001003') $$,
  'P0001', null, 'recovery-: a delivery_failed order is not in the claim queue');

select throws_ok(
  $$ select process_verify_delivery_code('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001002', '0000') $$,
  'P0001', null, 'recovery-: a failed order cannot be delivered');

-- #13: an admin reassigns it to another runner. This is the documented
-- recovery path, and it was already implemented in Phase 7 - it just had
-- no way to be reached until now.
select lives_ok(
  $$ select process_admin_reassign('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001005', 'c8000000-0000-4000-8000-00000000ca02') $$,
  'recovery+: an admin reassigns the failed order to another runner (#13)');
select is((select status from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  'assigned'::order_status, 'recovery+: the order is assigned again');
select is((select runner_id from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  'c8000000-0000-4000-8000-00000000ca02'::uuid, 'recovery+: runner B now owns it');
select is((select count(*)::int from order_delivery_codes where order_id = 'c8000000-0000-4000-8000-000000005001'),
  1, 'recovery+: a fresh delivery code was minted for the retry');

-- And the retry can actually complete.
select lives_ok(
  $$ select process_mark_picked_up('c8000000-0000-4000-8000-000000005001', 'c8000000-0000-4000-8000-000000001003') $$,
  'recovery+: runner B picks up the reattempt');
select lives_ok(
  $$ select process_verify_delivery_code(
       'c8000000-0000-4000-8000-000000005001',
       'c8000000-0000-4000-8000-000000001003',
       (select code from order_delivery_codes where order_id = 'c8000000-0000-4000-8000-000000005001')) $$,
  'recovery+: the reattempt delivers successfully — the loop is closed');
select is((select status from orders where id = 'c8000000-0000-4000-8000-000000005001'),
  'delivered'::order_status, 'recovery+: final status is delivered');

select * from finish();
rollback;
