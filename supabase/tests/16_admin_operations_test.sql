-- Phase 9A — admin operations at the database layer.
--
-- The headline test is §A: the refund/inventory corruption that migration
-- 0011 fixes. It is written as a REGRESSION test, not a happy path — it
-- reconstructs the exact production scenario (A reserves, A is packed so
-- the reservation is consumed, B reserves, A fails, A is refunded) and
-- asserts B's reservation survives. Reverting 0011's guard makes this
-- file fail, which is the only reason it is worth having.

begin;
create extension if not exists pgtap;
select plan(38);

-- ---------- fixtures ----------
-- Isolated store/zone/product so no other test's stock is involved.
insert into stores (id, name, is_open, max_queue_depth)
values ('aa000000-0000-4000-8000-000000000001', 'Admin Ops Test Store', true, 9999);

insert into zones (id, store_id, name, delivery_fee, is_serviceable)
values ('aa000000-0000-4000-8000-000000000101', 'aa000000-0000-4000-8000-000000000001', 'Ops Zone', 1000, true);

-- profiles.id references auth.users, and handle_new_user creates the
-- profile row from the auth insert, so the users come first.
insert into auth.users (id, phone) values
  ('aa000000-0000-4000-8000-000000001001', '919700000001'),  -- customer A
  ('aa000000-0000-4000-8000-000000001002', '919700000002'),  -- customer B
  ('aa000000-0000-4000-8000-000000001003', '919700000003'),  -- admin
  ('aa000000-0000-4000-8000-000000001004', '919700000004'),  -- runner
  ('aa000000-0000-4000-8000-000000001005', '919700000005'),  -- no staff role
  ('aa000000-0000-4000-8000-000000001006', '919700000006');  -- packer

update profiles set full_name = 'Ops Admin'  where id = 'aa000000-0000-4000-8000-000000001003';
update profiles set full_name = 'Ops Runner' where id = 'aa000000-0000-4000-8000-000000001004';

insert into staff_roles (profile_id, role, store_id) values
  ('aa000000-0000-4000-8000-000000001003', 'admin', null),
  ('aa000000-0000-4000-8000-000000001004', 'runner', 'aa000000-0000-4000-8000-000000000001'),
  ('aa000000-0000-4000-8000-000000001006', 'packer', 'aa000000-0000-4000-8000-000000000001');

insert into runners (id, profile_id, store_id, is_online)
values ('aa000000-0000-4000-8000-000000002001', 'aa000000-0000-4000-8000-000000001004',
        'aa000000-0000-4000-8000-000000000001', true);

insert into addresses (id, customer_id, zone_id, block, floor, room) values
  ('aa000000-0000-4000-8000-000000003001', 'aa000000-0000-4000-8000-000000001001', 'aa000000-0000-4000-8000-000000000101', 'A', '1', '1'),
  ('aa000000-0000-4000-8000-000000003002', 'aa000000-0000-4000-8000-000000001002', 'aa000000-0000-4000-8000-000000000101', 'B', '1', '2');

insert into products (id, store_id, name, mrp, sale_price, category, is_listed)
values ('aa000000-0000-4000-8000-000000004001', 'aa000000-0000-4000-8000-000000000001',
        'Ops Probe Item', 10000, 10000, 'Snacks', true);

insert into inventory (store_id, product_id, qty_on_hand, qty_reserved)
values ('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000004001', 10, 0);


-- ============================================================
-- A. THE REGRESSION: a post-pack refund must not eat another
--    order's reservation
-- ============================================================
-- Order A: 3 units, reserved at creation.
insert into orders (id, customer_id, store_id, address_id, status, payment_status,
                    subtotal, discount, delivery_fee, wallet_applied, payable, idempotency_key)
values ('aa000000-0000-4000-8000-000000005001', 'aa000000-0000-4000-8000-000000001001',
        'aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000003001',
        'created', 'pending', 30000, 0, 1000, 0, 31000, 'aa000000-0000-4000-8000-0000000000a1');
insert into order_items (order_id, product_id, qty, unit_price)
values ('aa000000-0000-4000-8000-000000005001', 'aa000000-0000-4000-8000-000000004001', 3, 10000);
update inventory set qty_reserved = qty_reserved + 3
 where store_id = 'aa000000-0000-4000-8000-000000000001'
   and product_id = 'aa000000-0000-4000-8000-000000004001';
insert into payments (order_id, status, amount, gateway_order_ref)
values ('aa000000-0000-4000-8000-000000005001', 'captured', 31000, 'ops_ref_a');
update orders set status = 'confirmed', payment_status = 'captured'
 where id = 'aa000000-0000-4000-8000-000000005001';

select is(
  (select qty_reserved from inventory
    where store_id = 'aa000000-0000-4000-8000-000000000001'
      and product_id = 'aa000000-0000-4000-8000-000000004001'),
  3, 'A: 3 units reserved at creation');

-- Pack A. This CONSUMES the reservation: qty_reserved -= 3 AND
-- qty_on_hand -= 3 (mark_packed, migration 0006).
select process_mark_packed('aa000000-0000-4000-8000-000000005001',
                           'aa000000-0000-4000-8000-000000001006');

select is(
  (select qty_on_hand from inventory
    where store_id = 'aa000000-0000-4000-8000-000000000001'
      and product_id = 'aa000000-0000-4000-8000-000000004001'),
  7, 'A packed: stock left the shelf');
select is(
  (select qty_reserved from inventory
    where store_id = 'aa000000-0000-4000-8000-000000000001'
      and product_id = 'aa000000-0000-4000-8000-000000004001'),
  0, 'A packed: the reservation is CONSUMED, not still held');

-- A goes out and fails.
update orders set status = 'assigned', runner_id = 'aa000000-0000-4000-8000-000000002001'
 where id = 'aa000000-0000-4000-8000-000000005001';
update orders set status = 'picked_up' where id = 'aa000000-0000-4000-8000-000000005001';
select process_mark_delivery_failed('aa000000-0000-4000-8000-000000005001',
                                    'aa000000-0000-4000-8000-000000001004',
                                    'customer unreachable');
select is(
  (select status::text from orders where id = 'aa000000-0000-4000-8000-000000005001'),
  'delivery_failed', 'A is delivery_failed');

-- Order B: a DIFFERENT customer reserves 2 of the same product and is
-- still live.
insert into orders (id, customer_id, store_id, address_id, status, payment_status,
                    subtotal, discount, delivery_fee, wallet_applied, payable, idempotency_key)
values ('aa000000-0000-4000-8000-000000005002', 'aa000000-0000-4000-8000-000000001002',
        'aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000003002',
        'created', 'pending', 20000, 0, 1000, 0, 21000, 'aa000000-0000-4000-8000-0000000000a2');
insert into order_items (order_id, product_id, qty, unit_price)
values ('aa000000-0000-4000-8000-000000005002', 'aa000000-0000-4000-8000-000000004001', 2, 10000);
update inventory set qty_reserved = qty_reserved + 2
 where store_id = 'aa000000-0000-4000-8000-000000000001'
   and product_id = 'aa000000-0000-4000-8000-000000004001';
insert into payments (order_id, status, amount, gateway_order_ref)
values ('aa000000-0000-4000-8000-000000005002', 'captured', 21000, 'ops_ref_b');
update orders set status = 'confirmed', payment_status = 'captured'
 where id = 'aa000000-0000-4000-8000-000000005002';

select is(
  (select qty_reserved from inventory
    where store_id = 'aa000000-0000-4000-8000-000000000001'
      and product_id = 'aa000000-0000-4000-8000-000000004001'),
  2, 'B: 2 units reserved and live');

-- Refund A in full. Before migration 0011 this released 3 units that A
-- no longer held, taking them out of B's reservation and leaving
-- qty_reserved at 0 — an oversell of B's stock.
select process_refund('aa000000-0000-4000-8000-000000005001',
                      'aa000000-0000-4000-8000-00000000f001',
                      null, 'ops probe: cancel the failed delivery',
                      'aa000000-0000-4000-8000-000000001003', 'wallet');

select is(
  (select qty_reserved from inventory
    where store_id = 'aa000000-0000-4000-8000-000000000001'
      and product_id = 'aa000000-0000-4000-8000-000000004001'),
  2, 'REGRESSION: B''s reservation survives A''s refund (was 0 before 0011)');
select is(
  (select qty_on_hand from inventory
    where store_id = 'aa000000-0000-4000-8000-000000000001'
      and product_id = 'aa000000-0000-4000-8000-000000004001'),
  7, 'REGRESSION: refunding A does not put A''s packed stock back on the shelf (#9/#14)');
select is(
  (select status::text from orders where id = 'aa000000-0000-4000-8000-000000005002'),
  'confirmed', 'B is untouched and still live');
select is(
  (select status::text from orders where id = 'aa000000-0000-4000-8000-000000005001'),
  'cancelled', 'A is cancelled by the full refund');
select is(
  (select payment_status::text from orders where id = 'aa000000-0000-4000-8000-000000005001'),
  'refunded', 'A is refunded');

-- The pre-pack case must STILL release, or the fix would have broken the
-- thing it was guarding.
select process_refund('aa000000-0000-4000-8000-000000005002',
                      'aa000000-0000-4000-8000-00000000f002',
                      null, 'ops probe: cancel before packing',
                      'aa000000-0000-4000-8000-000000001003', 'wallet');
select is(
  (select qty_reserved from inventory
    where store_id = 'aa000000-0000-4000-8000-000000000001'
      and product_id = 'aa000000-0000-4000-8000-000000004001'),
  0, 'a refund from `confirmed` DOES release the reservation — pre-pack behaviour intact');
select is(
  (select qty_on_hand from inventory
    where store_id = 'aa000000-0000-4000-8000-000000000001'
      and product_id = 'aa000000-0000-4000-8000-000000004001'),
  7, 'and does not invent stock that was never taken');


-- ============================================================
-- B. process_admin_cancel_order
-- ============================================================
insert into orders (id, customer_id, store_id, address_id, status, payment_status,
                    subtotal, discount, delivery_fee, wallet_applied, payable, idempotency_key)
values ('aa000000-0000-4000-8000-000000005003', 'aa000000-0000-4000-8000-000000001001',
        'aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000003001',
        'created', 'pending', 10000, 0, 1000, 0, 11000, 'aa000000-0000-4000-8000-0000000000a3');
insert into order_items (order_id, product_id, qty, unit_price)
values ('aa000000-0000-4000-8000-000000005003', 'aa000000-0000-4000-8000-000000004001', 1, 10000);
insert into payments (order_id, status, amount, gateway_order_ref)
values ('aa000000-0000-4000-8000-000000005003', 'captured', 11000, 'ops_ref_c');
update orders set status = 'confirmed', payment_status = 'captured'
 where id = 'aa000000-0000-4000-8000-000000005003';

select throws_like(
  $$ select process_admin_cancel_order('aa000000-0000-4000-8000-000000005003',
       'aa000000-0000-4000-8000-000000001004', 'nope', 'aa000000-0000-4000-8000-00000000f010') $$,
  '%FORBIDDEN%', 'admin_cancel_order: a runner is refused');
select throws_like(
  $$ select process_admin_cancel_order('aa000000-0000-4000-8000-000000005003',
       'aa000000-0000-4000-8000-000000001005', 'nope', 'aa000000-0000-4000-8000-00000000f011') $$,
  '%FORBIDDEN%', 'admin_cancel_order: a profile with no staff role is refused');
select throws_like(
  $$ select process_admin_cancel_order('aa000000-0000-4000-8000-000000005003',
       'aa000000-0000-4000-8000-000000001003', '   ', 'aa000000-0000-4000-8000-00000000f012') $$,
  '%VALIDATION_FAILED%', 'admin_cancel_order: a blank reason is refused');

select lives_ok(
  $$ select process_admin_cancel_order('aa000000-0000-4000-8000-000000005003',
       'aa000000-0000-4000-8000-000000001003', 'store closing early',
       'aa000000-0000-4000-8000-00000000f013') $$,
  'admin_cancel_order: an admin may cancel a confirmed order');
select is(
  (select status::text from orders where id = 'aa000000-0000-4000-8000-000000005003'),
  'cancelled', 'admin_cancel_order: the order is cancelled');
select is(
  (select refunded_amount from payments where order_id = 'aa000000-0000-4000-8000-000000005003'),
  11000, 'admin_cancel_order: the full captured amount is refunded, server-computed');
select is(
  (select count(*)::int from audit_logs
    where entity_id = 'aa000000-0000-4000-8000-000000005003' and action = 'order.cancelled'),
  1, 'admin_cancel_order: exactly one audit row');
select is(
  (select metadata ->> 'reason' from audit_logs
    where entity_id = 'aa000000-0000-4000-8000-000000005003' and action = 'order.cancelled'),
  'store closing early', 'admin_cancel_order: the reason is in the audit metadata');

-- `packed` has no admin cancel row in order_transition_rules.
insert into orders (id, customer_id, store_id, address_id, status, payment_status,
                    subtotal, discount, delivery_fee, wallet_applied, payable, idempotency_key)
values ('aa000000-0000-4000-8000-000000005004', 'aa000000-0000-4000-8000-000000001001',
        'aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000003001',
        'created', 'pending', 10000, 0, 1000, 0, 11000, 'aa000000-0000-4000-8000-0000000000a4');
insert into payments (order_id, status, amount, gateway_order_ref)
values ('aa000000-0000-4000-8000-000000005004', 'captured', 11000, 'ops_ref_d');
update orders set status = 'confirmed', payment_status = 'captured'
 where id = 'aa000000-0000-4000-8000-000000005004';
update orders set status = 'packed' where id = 'aa000000-0000-4000-8000-000000005004';
select throws_like(
  $$ select process_admin_cancel_order('aa000000-0000-4000-8000-000000005004',
       'aa000000-0000-4000-8000-000000001003', 'x', 'aa000000-0000-4000-8000-00000000f014') $$,
  '%INVALID_ORDER_TRANSITION%',
  'admin_cancel_order: `packed` has no admin cancel edge and is refused');


-- ============================================================
-- C. process_assign_staff_role — the only door into staff_roles
-- ============================================================
select throws_like(
  $$ select process_assign_staff_role('aa000000-0000-4000-8000-000000001005',
       'aa000000-0000-4000-8000-000000001004', 'admin', null) $$,
  '%FORBIDDEN%', 'assign_staff_role: a runner cannot grant roles');
select throws_like(
  $$ select process_assign_staff_role('aa000000-0000-4000-8000-000000001005',
       'aa000000-0000-4000-8000-000000001003', 'packer', null) $$,
  '%VALIDATION_FAILED%', 'assign_staff_role: a packer without a store is refused');
select throws_like(
  $$ select process_assign_staff_role('aa000000-0000-4000-8000-000000001003',
       'aa000000-0000-4000-8000-000000001003', 'packer', 'aa000000-0000-4000-8000-000000000001') $$,
  '%FORBIDDEN%', 'assign_staff_role: an admin cannot strip their own admin role');

select lives_ok(
  $$ select process_assign_staff_role('aa000000-0000-4000-8000-000000001005',
       'aa000000-0000-4000-8000-000000001003', 'runner', 'aa000000-0000-4000-8000-000000000001') $$,
  'assign_staff_role: an admin may grant runner');
select is(
  (select count(*)::int from runners where profile_id = 'aa000000-0000-4000-8000-000000001005'),
  1, 'assign_staff_role: granting runner creates the runners row (D28) so they are assignable');
select lives_ok(
  $$ select process_assign_staff_role('aa000000-0000-4000-8000-000000001005',
       'aa000000-0000-4000-8000-000000001003', null, null) $$,
  'assign_staff_role: null revokes');
select is(
  (select count(*)::int from staff_roles where profile_id = 'aa000000-0000-4000-8000-000000001005'),
  0, 'assign_staff_role: revoking removes the row — "no row" IS the customer state');


-- ============================================================
-- D. process_set_service_pause — the kill switch
-- ============================================================
select throws_like(
  $$ select process_set_service_pause('aa000000-0000-4000-8000-000000000001',
       'aa000000-0000-4000-8000-000000001004', false, 'nope', null) $$,
  '%FORBIDDEN%', 'set_service_pause: a runner cannot pause the business');
select throws_like(
  $$ select process_set_service_pause('aa000000-0000-4000-8000-000000000001',
       'aa000000-0000-4000-8000-000000001003', false, '  ', null) $$,
  '%VALIDATION_FAILED%', 'set_service_pause: closing without a reason is refused');

select lives_ok(
  $$ select process_set_service_pause('aa000000-0000-4000-8000-000000000001',
       'aa000000-0000-4000-8000-000000001003', false, 'kitchen flooded', null) $$,
  'set_service_pause: an admin may pause');
select is(
  (select is_open from stores where id = 'aa000000-0000-4000-8000-000000000001'),
  false, 'set_service_pause: the store is closed');
select is(
  (select pause_reason from stores where id = 'aa000000-0000-4000-8000-000000000001'),
  'kitchen flooded', 'set_service_pause: the reason is stored');
select is(
  (select count(*)::int from audit_logs
    where entity_id = 'aa000000-0000-4000-8000-000000000001' and action = 'service.paused'),
  1, 'set_service_pause: pausing is audited — the whole reason this function exists');

-- Enforcement is create_order's, and it is transactional there. What is
-- asserted here is that the flag the function writes is the flag
-- create_order reads.
select is(
  (select is_open from stores where id = (
     select store_id from zones where id = 'aa000000-0000-4000-8000-000000000101')),
  false, 'set_service_pause: the flag create_order (0004 step 4) reads is the one that changed');

select lives_ok(
  $$ select process_set_service_pause('aa000000-0000-4000-8000-000000000001',
       'aa000000-0000-4000-8000-000000001003', true, null, 250) $$,
  'set_service_pause: an admin may resume, and set the queue threshold');
select is(
  (select pause_reason from stores where id = 'aa000000-0000-4000-8000-000000000001'),
  null, 'set_service_pause: resuming clears the reason rather than leaving it stale');
select is(
  (select max_queue_depth from stores where id = 'aa000000-0000-4000-8000-000000000001'),
  250, 'set_service_pause: the queue threshold is updated');

select * from finish();
rollback;
