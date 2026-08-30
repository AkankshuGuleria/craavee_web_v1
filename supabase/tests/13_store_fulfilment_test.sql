-- ============================================================
-- 13 — Store fulfilment: packing + stock-out (Phase 6)
--
-- Unit tests of the migration 0006 functions over psql (RLS bypassed on
-- purpose — these test FUNCTION logic; the Edge Function auth/envelope
-- layer and genuine concurrency are covered by the integration suite in
-- apps/customer-runner/__tests__/fulfilment.integration.test.ts).
--
-- Canonical: API_CONTRACTS.md §"Store-Side Reconciliation",
-- ORDER_STATE_MACHINE.md #4 and §2.1 ("Stock-out is not a state
-- transition"), RBAC_MATRIX.md §4/§5, DECISION_LOG.md D25/D38.
--
-- Whole file rolls back at the end (pgTAP convention).
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(57);

-- ---- fixtures -------------------------------------------------
insert into stores (id, name, is_open, max_queue_depth) values
  ('c6000000-0000-4000-8000-000000000001', 'P6 Store A', true, 9999),
  ('c6000000-0000-4000-8000-000000000002', 'P6 Store B', true, 9999);

insert into zones (id, store_id, name, delivery_fee, is_serviceable) values
  ('c6000000-0000-4000-8000-000000000101', 'c6000000-0000-4000-8000-000000000001', 'Zone A', 1000, true),
  ('c6000000-0000-4000-8000-000000000102', 'c6000000-0000-4000-8000-000000000002', 'Zone B', 1000, true);

insert into auth.users (id, phone) values
  ('c6000000-0000-4000-8000-000000001001', '9961000001'),  -- customer
  ('c6000000-0000-4000-8000-000000001002', '9961000002'),  -- packer store A
  ('c6000000-0000-4000-8000-000000001003', '9961000003'),  -- packer store B
  ('c6000000-0000-4000-8000-000000001004', '9961000004'),  -- admin
  ('c6000000-0000-4000-8000-000000001005', '9961000005');  -- runner store A

insert into staff_roles (profile_id, role, store_id) values
  ('c6000000-0000-4000-8000-000000001002', 'packer', 'c6000000-0000-4000-8000-000000000001'),
  ('c6000000-0000-4000-8000-000000001003', 'packer', 'c6000000-0000-4000-8000-000000000002'),
  ('c6000000-0000-4000-8000-000000001004', 'admin',  null),
  ('c6000000-0000-4000-8000-000000001005', 'runner', 'c6000000-0000-4000-8000-000000000001');

insert into addresses (id, customer_id, zone_id, block, room) values
  ('c6000000-0000-4000-8000-000000002001', 'c6000000-0000-4000-8000-000000001001', 'c6000000-0000-4000-8000-000000000101', 'A', '1');

insert into products (id, store_id, name, mrp, sale_price, category, is_listed) values
  ('c6000000-0000-4000-8000-000000003001', 'c6000000-0000-4000-8000-000000000001', 'Prod A', 6000, 5000, 'Snacks', true),
  ('c6000000-0000-4000-8000-000000003002', 'c6000000-0000-4000-8000-000000000001', 'Prod B', 3500, 3000, 'Snacks', true);

insert into inventory (store_id, product_id, qty_on_hand, qty_reserved) values
  ('c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000003001', 10, 3),
  ('c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000003002', 10, 1);

-- Order 1: confirmed, 2x Prod A (5000) + 1x Prod B (3000) = 13000
--          + delivery 1000, fully gateway-funded (payable 14000).
insert into profiles (id, phone, wallet_balance) values
  ('c6000000-0000-4000-8000-000000001001', '9961000001', 0)
on conflict (id) do update set wallet_balance = 0;

insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee,
                    wallet_applied, payable, payment_status, idempotency_key, confirmed_at)
values ('c6000000-0000-4000-8000-000000005001', 'c6000000-0000-4000-8000-000000001001',
        'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000002001',
        'confirmed', 13000, 1000, 0, 14000, 'captured',
        'c6000000-0000-4000-8000-00000000a001', now());

insert into order_items (id, order_id, product_id, qty, unit_price) values
  ('c6000000-0000-4000-8000-000000006001', 'c6000000-0000-4000-8000-000000005001', 'c6000000-0000-4000-8000-000000003001', 2, 5000),
  ('c6000000-0000-4000-8000-000000006002', 'c6000000-0000-4000-8000-000000005001', 'c6000000-0000-4000-8000-000000003002', 1, 3000);

insert into payments (order_id, gateway, amount, status, gateway_order_ref, gateway_payment_ref)
values ('c6000000-0000-4000-8000-000000005001', 'razorpay', 14000, 'captured', 'ord_p6_1', 'pay_p6_1');

-- ============================================================
-- A. Schema
-- ============================================================
select has_column('public'::name, 'order_items'::name, 'stock_out_at'::name,
  'order_items.stock_out_at exists — distinguishes "not packed yet" from "reconciled to zero"');
select has_column('public'::name, 'order_items'::name, 'stock_out_by'::name,
  'order_items.stock_out_by exists');
select has_index('public'::name, 'orders'::name, 'orders_store_status_placed_idx'::name,
  'packer-queue index (store_id, status, placed_at) exists');

-- ============================================================
-- B. Authorization (RBAC_MATRIX.md §4) — before any state branch
-- ============================================================
select throws_ok(
  $$ select process_mark_packed('c6000000-0000-4000-8000-000000005001', 'c6000000-0000-4000-8000-000000001001') $$,
  'P0001', null, 'mark_packed-: a customer (no staff role) is FORBIDDEN');

select throws_ok(
  $$ select process_mark_packed('c6000000-0000-4000-8000-000000005001', 'c6000000-0000-4000-8000-000000001003') $$,
  'P0001', null, 'mark_packed-: a packer from another store is FORBIDDEN');

select throws_ok(
  $$ select process_mark_packed('c6000000-0000-4000-8000-000000005001', 'c6000000-0000-4000-8000-000000001005') $$,
  'P0001', null, 'mark_packed-: a runner may not pack');

select throws_ok(
  $$ select process_stock_out('c6000000-0000-4000-8000-000000005001','c6000000-0000-4000-8000-000000006001',0,true,'c6000000-0000-4000-8000-000000001003','c6000000-0000-4000-8000-0000000000b1') $$,
  'P0001', null, 'stock_out-: a packer from another store is FORBIDDEN');

select throws_ok(
  $$ select process_mark_packed('c6000000-0000-4000-8000-00000000ffff', 'c6000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'mark_packed-: unknown order raises rather than silently succeeding');

-- ============================================================
-- C. Stock-out: server-computed refund, reservation, money coherence
-- ============================================================
-- Stock out 1 of the 2 Prod A units (partial). Removed value = 1 * 5000.
select is(
  (select (process_stock_out('c6000000-0000-4000-8000-000000005001',
                             'c6000000-0000-4000-8000-000000006001',
                             1, false,
                             'c6000000-0000-4000-8000-000000001002',
                             'c6000000-0000-4000-8000-0000000000c1') ->> 'refundAmount')::int),
  5000, 'stock_out: refund is computed server-side as unfulfilled x unit_price (1 x 5000)');

select is((select fulfilled_qty from order_items where id = 'c6000000-0000-4000-8000-000000006001'),
  1, 'stock_out: fulfilled_qty set to the available quantity');
select isnt((select stock_out_at from order_items where id = 'c6000000-0000-4000-8000-000000006001'),
  null, 'stock_out: stock_out_at stamped');
select is((select stock_out_by from order_items where id = 'c6000000-0000-4000-8000-000000006001'),
  'c6000000-0000-4000-8000-000000001002'::uuid, 'stock_out: actor recorded on the line');

select is((select unit_price from order_items where id = 'c6000000-0000-4000-8000-000000006001'),
  5000, 'stock_out: historical unit_price is NEVER rewritten (§16)');
select is((select qty from order_items where id = 'c6000000-0000-4000-8000-000000006001'),
  2, 'stock_out: ordered qty is preserved — only fulfilled_qty moves');

select is((select subtotal from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  8000, 'stock_out: orders.subtotal reduced by the removed value (13000 - 5000)');
select is((select payable from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  9000, 'stock_out: orders.payable reduced (14000 - 5000)');
select is((select subtotal + delivery_fee - wallet_applied from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  (select payable from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  'stock_out: payable_matches_math still holds after the reduction');

select is((select wallet_balance from profiles where id = 'c6000000-0000-4000-8000-000000001001'),
  5000, 'stock_out: the whole removed value is credited to the wallet (D38)');
select is((select count(*)::int from wallet_ledger where order_id = 'c6000000-0000-4000-8000-000000005001' and reason = 'refund'),
  1, 'stock_out: exactly one refund ledger row');

select is((select refunded_amount from payments where order_id = 'c6000000-0000-4000-8000-000000005001'),
  5000, 'stock_out: payments.refunded_amount tracks the gateway share');
select is((select status from payments where order_id = 'c6000000-0000-4000-8000-000000005001'),
  'partially_refunded'::payment_status, 'stock_out: payments.status -> partially_refunded');
select is((select payment_status from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  'partially_refunded'::payment_status, 'stock_out: denormalized orders.payment_status kept in step');
select is((select count(*)::int from refunds r join payments p on p.id = r.payment_id
           where p.order_id = 'c6000000-0000-4000-8000-000000005001'),
  1, 'stock_out: one refunds row created through the Phase 5 refund model');

select is((select status from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  'confirmed'::order_status, 'stock_out: order status UNCHANGED — stock-out is not a state transition');

select is((select qty_reserved from inventory
           where store_id='c6000000-0000-4000-8000-000000000001' and product_id='c6000000-0000-4000-8000-000000003001'),
  2, 'stock_out: only the unfulfilled unit is released (3 - 1), the fulfilled one stays reserved');

-- ============================================================
-- D. Stock-out idempotency (§18/§23)
-- ============================================================
select is(
  (select (process_stock_out('c6000000-0000-4000-8000-000000005001',
                             'c6000000-0000-4000-8000-000000006001',
                             0, true,
                             'c6000000-0000-4000-8000-000000001002',
                             'c6000000-0000-4000-8000-0000000000c2') ->> 'alreadyStockedOut')::boolean),
  true, 'stock_out: a second call on the same line is a no-op, not a second refund');

select is((select wallet_balance from profiles where id = 'c6000000-0000-4000-8000-000000001001'),
  5000, 'stock_out idempotency: wallet not credited twice');
select is((select refunded_amount from payments where order_id = 'c6000000-0000-4000-8000-000000005001'),
  5000, 'stock_out idempotency: refunded_amount not increased twice');
select is((select count(*)::int from refunds r join payments p on p.id = r.payment_id
           where p.order_id = 'c6000000-0000-4000-8000-000000005001'),
  1, 'stock_out idempotency: still exactly one refunds row');
select is((select subtotal from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  8000, 'stock_out idempotency: order money not reduced twice');

-- ============================================================
-- E. Stock-out validation
-- ============================================================
select throws_ok(
  $$ select process_stock_out('c6000000-0000-4000-8000-000000005001','c6000000-0000-4000-8000-000000006002',5,false,'c6000000-0000-4000-8000-000000001002','c6000000-0000-4000-8000-0000000000c3') $$,
  'P0001', null, 'stock_out-: availableQty above the ordered qty is ITEM_UNAVAILABLE (cannot refund more than ordered)');

select throws_ok(
  $$ select process_stock_out('c6000000-0000-4000-8000-000000005001','c6000000-0000-4000-8000-000000006002',1,false,'c6000000-0000-4000-8000-000000001002','c6000000-0000-4000-8000-0000000000c4') $$,
  'P0001', null, 'stock_out-: availableQty equal to ordered qty is rejected — nothing was short');

select throws_ok(
  $$ select process_stock_out('c6000000-0000-4000-8000-000000005001','c6000000-0000-4000-8000-000000006002',-1,false,'c6000000-0000-4000-8000-000000001002','c6000000-0000-4000-8000-0000000000c5') $$,
  'P0001', null, 'stock_out-: a negative availableQty is rejected');

-- ============================================================
-- F. mark_packed: reservation consumption
-- ============================================================
select is(
  (select (process_mark_packed('c6000000-0000-4000-8000-000000005001','c6000000-0000-4000-8000-000000001002') ->> 'status')),
  'packed', 'mark_packed: a confirmed order becomes packed');

select is((select status from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  'packed'::order_status, 'mark_packed: orders.status is packed');
select isnt((select packed_at from orders where id = 'c6000000-0000-4000-8000-000000005001'),
  null, 'mark_packed: packed_at stamped by the trigger, not by the function');

-- Prod A: reserved was 2 after the stock-out release, fulfilled 1 -> reserved 1, on_hand 10-1=9
select is((select qty_reserved from inventory
           where store_id='c6000000-0000-4000-8000-000000000001' and product_id='c6000000-0000-4000-8000-000000003001'),
  1, 'mark_packed: the fulfilled unit leaves qty_reserved');
select is((select qty_on_hand from inventory
           where store_id='c6000000-0000-4000-8000-000000000001' and product_id='c6000000-0000-4000-8000-000000003001'),
  9, 'mark_packed: the fulfilled unit leaves qty_on_hand (reservation consumed, not just released)');

-- Prod B: never stocked out -> fulfilled_qty filled to qty, reserved 1-1=0, on_hand 10-1=9
select is((select fulfilled_qty from order_items where id = 'c6000000-0000-4000-8000-000000006002'),
  1, 'mark_packed: a line never stocked out is fulfilled in full');
select is((select qty_reserved from inventory
           where store_id='c6000000-0000-4000-8000-000000000001' and product_id='c6000000-0000-4000-8000-000000003002'),
  0, 'mark_packed: its reservation is consumed');
select is((select qty_on_hand from inventory
           where store_id='c6000000-0000-4000-8000-000000000001' and product_id='c6000000-0000-4000-8000-000000003002'),
  9, 'mark_packed: its stock leaves the shelf');

select is((select fulfilled_qty from order_items where id = 'c6000000-0000-4000-8000-000000006001'),
  1, 'mark_packed: a stocked-out line KEEPS its reconciled fulfilled_qty (not overwritten to qty)');

select ok((select bool_and(qty_reserved >= 0 and qty_on_hand >= 0) from inventory),
  'mark_packed: no inventory row is ever negative (§11)');

-- ============================================================
-- G. mark_packed idempotency + illegal transitions
-- ============================================================
select is(
  (select (process_mark_packed('c6000000-0000-4000-8000-000000005001','c6000000-0000-4000-8000-000000001002') ->> 'alreadyPacked')::boolean),
  true, 'mark_packed: packing an already-packed order is a harmless no-op');

select is((select qty_on_hand from inventory
           where store_id='c6000000-0000-4000-8000-000000000001' and product_id='c6000000-0000-4000-8000-000000003002'),
  9, 'mark_packed idempotency: stock is NOT consumed a second time');

select throws_ok(
  $$ select process_stock_out('c6000000-0000-4000-8000-000000005001','c6000000-0000-4000-8000-000000006002',0,true,'c6000000-0000-4000-8000-000000001002','c6000000-0000-4000-8000-0000000000c6') $$,
  'P0001', null, 'stock_out-: rejected once the order is already packed');

-- ============================================================
-- H. Illegal source states + admin override
-- ============================================================
insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee,
                    wallet_applied, payable, payment_status, idempotency_key)
values ('c6000000-0000-4000-8000-000000005002', 'c6000000-0000-4000-8000-000000001001',
        'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000002001',
        'created', 5000, 1000, 0, 6000, 'pending',
        'c6000000-0000-4000-8000-00000000a002');

select throws_ok(
  $$ select process_mark_packed('c6000000-0000-4000-8000-000000005002','c6000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'mark_packed-: a created (unpaid) order cannot be packed');

update orders set status = 'cancelled', payment_status = 'failed'
where id = 'c6000000-0000-4000-8000-000000005002';

select throws_ok(
  $$ select process_mark_packed('c6000000-0000-4000-8000-000000005002','c6000000-0000-4000-8000-000000001002') $$,
  'P0001', null, 'mark_packed-: a cancelled order cannot be packed');

-- Admin override (RBAC_MATRIX.md §4): all-store scope, no store match needed.
insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee,
                    wallet_applied, payable, payment_status, idempotency_key, confirmed_at)
values ('c6000000-0000-4000-8000-000000005003', 'c6000000-0000-4000-8000-000000001001',
        'c6000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000002001',
        'confirmed', 3000, 1000, 0, 4000, 'captured',
        'c6000000-0000-4000-8000-00000000a003', now());
insert into payments (order_id, gateway, amount, status, gateway_order_ref, gateway_payment_ref)
values ('c6000000-0000-4000-8000-000000005003', 'razorpay', 4000, 'captured', 'ord_p6_3', 'pay_p6_3');

select is(
  (select (process_mark_packed('c6000000-0000-4000-8000-000000005003','c6000000-0000-4000-8000-000000001004') ->> 'status')),
  'packed', 'admin override: an admin may pack an order in any store (RBAC_MATRIX.md §4)');

-- ============================================================
-- I. Audit (§22)
-- ============================================================
select is((select count(*)::int from audit_logs
           where entity_id = 'c6000000-0000-4000-8000-000000005001' and action = 'order.packed'),
  1, 'audit: exactly one order.packed event');
select is((select count(*)::int from audit_logs
           where entity_id = 'c6000000-0000-4000-8000-000000005001' and action = 'order.stock_out'),
  1, 'audit: exactly one order.stock_out event');
select is((select actor_id from audit_logs
           where entity_id = 'c6000000-0000-4000-8000-000000005001' and action = 'order.packed'),
  'c6000000-0000-4000-8000-000000001002'::uuid, 'audit: records the acting packer');
select is((select (metadata ->> 'refund_amount')::int from audit_logs
           where entity_id = 'c6000000-0000-4000-8000-000000005001' and action = 'order.stock_out'),
  5000, 'audit: stock-out metadata carries the server-computed refund amount');

-- ============================================================
-- J. Privilege surface (§20)
-- ============================================================
select ok(not has_function_privilege('authenticated', 'process_mark_packed(uuid,uuid)', 'EXECUTE'),
  'grants-: authenticated cannot execute process_mark_packed directly');
select ok(not has_function_privilege('anon', 'process_mark_packed(uuid,uuid)', 'EXECUTE'),
  'grants-: anon cannot execute process_mark_packed directly');
select ok(not has_function_privilege('authenticated', 'process_stock_out(uuid,uuid,integer,boolean,uuid,uuid)', 'EXECUTE'),
  'grants-: authenticated cannot execute process_stock_out directly');
select ok(has_function_privilege('service_role', 'process_mark_packed(uuid,uuid)', 'EXECUTE'),
  'grants: service_role (the Edge Function) can');

select * from finish();
rollback;
