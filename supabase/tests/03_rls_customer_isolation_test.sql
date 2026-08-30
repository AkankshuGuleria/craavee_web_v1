-- RLS: customer isolation
-- RBAC_MATRIX.md §3: "Customer cannot: ... read other customers' data"
-- Phase 2 prompt §23 explicit examples: customer A cannot SELECT customer
-- B's order; customer cannot UPDATE inventory; customer cannot UPDATE
-- order.status.
--
-- ID convention for all test files: aaaaaaaa-0000-4000-8000-0000000000NN
-- where NN is a small hex counter — valid UUID v4-shaped, hex-only, and
-- visually distinguishable by entity: stores 00xx, zones 01xx,
-- customers 10xx, addresses 20xx, products 30xx, inventory (no own id
-- needed), orders 40xx, runners 50xx, staff 60xx.
begin;
create extension if not exists pgtap;
select plan(14);

-- ---- fixtures (service-role / superuser context, bypasses RLS) ----
insert into stores (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Test Store');
insert into zones (id, store_id, name, delivery_fee)
  values ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000001', 'Zone A', 1000);
insert into auth.users (id, phone) values
  ('aaaaaaaa-0000-4000-8000-000000001001', '9990000101'),
  ('aaaaaaaa-0000-4000-8000-000000001002', '9990000102');
insert into addresses (id, customer_id, zone_id, block, room) values
  ('aaaaaaaa-0000-4000-8000-000000002001', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000101', 'Block A', '101'),
  ('aaaaaaaa-0000-4000-8000-000000002002', 'aaaaaaaa-0000-4000-8000-000000001002', 'aaaaaaaa-0000-4000-8000-000000000101', 'Block B', '201');
insert into products (id, store_id, name, mrp, sale_price, category) values
  ('aaaaaaaa-0000-4000-8000-000000003001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Noodles', 50, 40, 'Instant Meals');
insert into inventory (store_id, product_id, qty_on_hand, qty_reserved)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000003001', 10, 0);
insert into orders (id, customer_id, store_id, address_id, subtotal, delivery_fee, payable, idempotency_key) values
  ('aaaaaaaa-0000-4000-8000-000000004001', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 40, 10, 50, gen_random_uuid());
insert into payments (order_id, amount, status)
  values ('aaaaaaaa-0000-4000-8000-000000004001', 50, 'pending');
insert into wallet_ledger (customer_id, delta, reason)
  values ('aaaaaaaa-0000-4000-8000-000000001001', 100, 'promo_credit');

-- ---- as customer C1 ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001001","role":"customer"}';

select is(
  (select count(*)::int from orders where id = 'aaaaaaaa-0000-4000-8000-000000004001'),
  1,
  'customer can see own order'
);

select is(
  (select count(*)::int from orders where customer_id = 'aaaaaaaa-0000-4000-8000-000000001002'),
  0,
  'customer A cannot see customer B''s orders (Phase 2 prompt §23 example)'
);

select is(
  (select count(*)::int from wallet_ledger where customer_id = 'aaaaaaaa-0000-4000-8000-000000001001'),
  1,
  'customer can see own wallet ledger'
);

select is(
  (select status::text from payments_customer_view where order_id = 'aaaaaaaa-0000-4000-8000-000000004001'),
  'pending',
  'customer can see own payment status via payments_customer_view'
);

select is(
  (select count(*)::int from addresses where id = 'aaaaaaaa-0000-4000-8000-000000002002'),
  0,
  'customer A cannot see customer B''s address'
);

-- `authenticated` holds table-level SELECT/UPDATE grants on inventory
-- (needed so admin/packer sessions, which share the same Postgres role,
-- can read/write) — the RLS policies (`inventory_select_packer`,
-- `inventory_update_admin`) are what actually block a customer, by
-- making the USING clause false for every row. A customer's UPDATE
-- therefore succeeds syntactically but affects zero rows (no error), and
-- a customer's SELECT returns zero rows too (not a permission error) —
-- an even stronger guarantee than "can't write" (can't even read raw
-- inventory counts, per RBAC_MATRIX.md §5).
update inventory set qty_on_hand = 999 where product_id = 'aaaaaaaa-0000-4000-8000-000000003001';
select is(
  (select count(*)::int from inventory where product_id = 'aaaaaaaa-0000-4000-8000-000000003001'),
  0,
  'customer cannot UPDATE OR read inventory directly (Phase 2 prompt §23 example) -- RLS filters the row entirely'
);

select is(
  (select count(*)::int from products where store_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1,
  'customer can read the listed catalog'
);

-- staff_roles has ZERO grants to `authenticated` at all (not merely
-- RLS-filtered) — a real permission-denied, matching the design
-- ("no self-service staff registration path", Phase 2 prompt §20).
select throws_ok(
  $$ select count(*) from staff_roles $$,
  '42501',
  null,
  'customer cannot read staff_roles at all (no grant, not just RLS-filtered)'
);

-- direct order.status write attempt: unlike inventory, `authenticated`
-- has NO update grant on `orders` at all (RBAC_MATRIX.md §4/§5: every
-- order write is Edge-Function-only) — so this fails at the privilege
-- layer, before RLS is even consulted, and throws a real permission-
-- denied error rather than silently affecting zero rows.
select throws_ok(
  $$ update orders set status = 'delivered' where id = 'aaaaaaaa-0000-4000-8000-000000004001' $$,
  '42501',
  null,
  'customer cannot directly transition order.status (Phase 2 prompt §23 example) -- no UPDATE grant at all'
);

-- ---- as customer C2 (negative case for order visibility) ----
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001002","role":"customer"}';

select is(
  (select count(*)::int from orders where id = 'aaaaaaaa-0000-4000-8000-000000004001'),
  0,
  'customer B cannot see customer A''s order via direct id lookup either'
);

-- The base `payments` table has no grant to `authenticated` at all
-- (customer-facing reads go through `payments_customer_view`, D29/RBAC_
-- MATRIX.md §5 — see 0003_rls_policies.sql §11) — a real permission
-- error, not an RLS-filtered empty result.
select throws_ok(
  $$ select count(*) from payments $$,
  '42501',
  null,
  'no authenticated session can query the base payments table directly (view-only access)'
);

select is(
  (select count(*)::int from payments_customer_view where order_id = 'aaaaaaaa-0000-4000-8000-000000004001'),
  0,
  'customer B cannot see customer A''s payment row via payments_customer_view'
);

-- ---- as anon (unauthenticated) ----
reset role;
set local role anon;
reset request.jwt.claims;

-- anon has no SELECT grant on orders at all (only `authenticated` does)
-- — a real permission-denied, not an RLS-filtered empty result.
select throws_ok(
  $$ select count(*) from orders $$,
  '42501',
  null,
  'anonymous (unauthenticated) session cannot query orders at all'
);

-- confirm, from a privileged context, that the customer's earlier UPDATE
-- attempt genuinely affected zero rows (not just that the customer can't
-- see the result) — the actual write-blocking guarantee, not merely a
-- read-visibility one.
reset role;
reset request.jwt.claims;
select is(
  (select qty_on_hand from inventory where product_id = 'aaaaaaaa-0000-4000-8000-000000003001'),
  10,
  'inventory value is genuinely unchanged after the customer''s blocked UPDATE attempt'
);

select * from finish();
rollback;
