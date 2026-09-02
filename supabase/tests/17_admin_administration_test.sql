-- ============================================================
-- 17 — Phase 9B administration
-- ============================================================
-- The headline is §B: a catalog price change must never reach an order
-- that has already been placed. It is written as a regression test
-- because the guarantee is structural (order_items.unit_price is a
-- snapshot) and structural guarantees are exactly the ones a later
-- "helpful" view that joins live prices would silently break.
--
-- §A covers the inventory correction path, including the invariant that
-- an admin cannot count the shelf below what live orders have claimed.
--
-- Whole file rolls back at the end (pgTAP convention).
begin;
create extension if not exists pgtap;
select plan(32);

-- ---------- fixtures ----------
insert into stores (id, name, is_open, max_queue_depth)
values ('bb000000-0000-4000-8000-000000000001', '9B Test Store', true, 9999),
       ('bb000000-0000-4000-8000-000000000002', '9B Other Store', true, 9999);

insert into zones (id, store_id, name, delivery_fee, is_serviceable)
values ('bb000000-0000-4000-8000-000000000101', 'bb000000-0000-4000-8000-000000000001', '9B Zone', 1000, true);

insert into auth.users (id, phone) values
  ('bb000000-0000-4000-8000-000000001001', '919710000001'),  -- customer
  ('bb000000-0000-4000-8000-000000001002', '919710000002'),  -- all-store admin
  ('bb000000-0000-4000-8000-000000001003', '919710000003'),  -- packer
  ('bb000000-0000-4000-8000-000000001004', '919710000004');  -- store-scoped admin (other store)

insert into staff_roles (profile_id, role, store_id) values
  ('bb000000-0000-4000-8000-000000001002', 'admin', null),
  ('bb000000-0000-4000-8000-000000001003', 'packer', 'bb000000-0000-4000-8000-000000000001'),
  ('bb000000-0000-4000-8000-000000001004', 'admin', 'bb000000-0000-4000-8000-000000000002');

insert into addresses (id, customer_id, zone_id, block, floor, room)
values ('bb000000-0000-4000-8000-000000003001', 'bb000000-0000-4000-8000-000000001001',
        'bb000000-0000-4000-8000-000000000101', 'B', '1', '1');

insert into products (id, store_id, name, mrp, sale_price, category, is_listed)
values ('bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000000001',
        '9B Widget', 10000, 8000, 'Snacks', true);

insert into inventory (store_id, product_id, qty_on_hand, qty_reserved)
values ('bb000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000004001', 20, 0);


-- ============================================================
-- A. process_admin_adjust_inventory
-- ============================================================
select throws_like(
  $$ select process_admin_adjust_inventory('bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000001003', 5, 'nope') $$,
  '%FORBIDDEN%', 'inventory: a packer cannot correct stock');
select throws_like(
  $$ select process_admin_adjust_inventory('bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000001001', 5, 'nope') $$,
  '%FORBIDDEN%', 'inventory: a customer cannot correct stock');
select throws_like(
  $$ select process_admin_adjust_inventory('bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000001004', 5, 'wrong store') $$,
  '%FORBIDDEN%', 'inventory: a store-scoped admin cannot reach another store''s shelf');
select throws_like(
  $$ select process_admin_adjust_inventory('bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000001002', 5, '   ') $$,
  '%VALIDATION_FAILED%', 'inventory: a blank reason is refused');
select throws_like(
  $$ select process_admin_adjust_inventory('bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000001002', -1, 'negative') $$,
  '%VALIDATION_FAILED%', 'inventory: a negative count is refused');

select lives_ok(
  $$ select process_admin_adjust_inventory('bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000001002', 25, 'stock count') $$,
  'inventory: an admin may correct on-hand');
select is(
  (select qty_on_hand from inventory where store_id = 'bb000000-0000-4000-8000-000000000001'
     and product_id = 'bb000000-0000-4000-8000-000000004001'),
  25, 'inventory: on-hand is updated');
select is(
  (select qty_reserved from inventory where store_id = 'bb000000-0000-4000-8000-000000000001'
     and product_id = 'bb000000-0000-4000-8000-000000004001'),
  0, 'inventory: reserved is NOT touched by a correction');
select is(
  (select count(*)::int from audit_logs where action = 'inventory.adjusted'
     and entity_id = 'bb000000-0000-4000-8000-000000004001'),
  1, 'inventory: the correction is audited');
select is(
  (select (metadata ->> 'delta')::int from audit_logs where action = 'inventory.adjusted'
     and entity_id = 'bb000000-0000-4000-8000-000000004001'),
  5, 'inventory: the audit records the delta, not just the new value');

-- The invariant: an admin cannot count away stock that live orders hold.
insert into orders (id, customer_id, store_id, address_id, status, payment_status,
                    subtotal, discount, delivery_fee, wallet_applied, payable, idempotency_key)
values ('bb000000-0000-4000-8000-000000005001', 'bb000000-0000-4000-8000-000000001001',
        'bb000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000003001',
        'created', 'pending', 32000, 0, 1000, 0, 33000, 'bb000000-0000-4000-8000-0000000000a1');
insert into order_items (order_id, product_id, qty, unit_price)
values ('bb000000-0000-4000-8000-000000005001', 'bb000000-0000-4000-8000-000000004001', 4, 8000);
update inventory set qty_reserved = 4
 where store_id = 'bb000000-0000-4000-8000-000000000001'
   and product_id = 'bb000000-0000-4000-8000-000000004001';

select throws_like(
  $$ select process_admin_adjust_inventory('bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000001002', 3, 'count below reserved') $$,
  '%VALIDATION_FAILED%',
  'inventory: on-hand cannot go below what live orders have reserved');
select is(
  (select qty_on_hand from inventory where store_id = 'bb000000-0000-4000-8000-000000000001'
     and product_id = 'bb000000-0000-4000-8000-000000004001'),
  25, 'inventory: the refused correction changed nothing');
select lives_ok(
  $$ select process_admin_adjust_inventory('bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000004001', 'bb000000-0000-4000-8000-000000001002', 4, 'exactly the reserved count') $$,
  'inventory: correcting down TO the reserved count is allowed');


-- ============================================================
-- B. THE REGRESSION: a price change never reaches a placed order
-- ============================================================
-- Snapshot the order's money before touching the catalog.
select is(
  (select unit_price from order_items where order_id = 'bb000000-0000-4000-8000-000000005001'),
  8000, 'catalog: the order was placed at 8000 paise');
select is(
  (select payable from orders where id = 'bb000000-0000-4000-8000-000000005001'),
  33000, 'catalog: the order''s payable is 33000 paise');

-- Double the price.
select lives_ok(
  $$ select process_admin_upsert_product('bb000000-0000-4000-8000-000000004001',
       'bb000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000001002',
       '9B Widget', null, 'Snacks', null, 20000, 16000, true) $$,
  'catalog: an admin may change the price');
select is(
  (select sale_price from products where id = 'bb000000-0000-4000-8000-000000004001'),
  16000, 'catalog: the catalog price is now 16000');

select is(
  (select unit_price from order_items where order_id = 'bb000000-0000-4000-8000-000000005001'),
  8000, 'REGRESSION: the placed order still shows the price it was charged');
select is(
  (select payable from orders where id = 'bb000000-0000-4000-8000-000000005001'),
  33000, 'REGRESSION: the placed order''s payable is unchanged by a catalog edit');
select is(
  (select subtotal from orders where id = 'bb000000-0000-4000-8000-000000005001'),
  32000, 'REGRESSION: the placed order''s subtotal is unchanged too');
select is(
  (select (metadata ->> 'priceFrom')::int from audit_logs
    where action = 'product.updated' and entity_id = 'bb000000-0000-4000-8000-000000004001'),
  8000, 'catalog: the audit records the price it changed FROM');
select is(
  (select (metadata ->> 'priceTo')::int from audit_logs
    where action = 'product.updated' and entity_id = 'bb000000-0000-4000-8000-000000004001'),
  16000, 'catalog: and the price it changed TO');


-- ============================================================
-- C. process_admin_upsert_product — authorization and validation
-- ============================================================
select throws_like(
  $$ select process_admin_upsert_product(null, 'bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000001003', 'Sneaky', null, 'Snacks', null, 100, 100, true) $$,
  '%FORBIDDEN%', 'catalog: a packer cannot create a product');
select throws_like(
  $$ select process_admin_upsert_product(null, 'bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000001004', 'Wrong store', null, 'Snacks', null, 100, 100, true) $$,
  '%FORBIDDEN%', 'catalog: a store-scoped admin cannot create in another store');
select throws_like(
  $$ select process_admin_upsert_product(null, 'bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000001002', '  ', null, 'Snacks', null, 100, 100, true) $$,
  '%VALIDATION_FAILED%', 'catalog: a blank name is refused');
select throws_like(
  $$ select process_admin_upsert_product(null, 'bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000001002', 'Overpriced', null, 'Snacks', null, 5000, 9000, true) $$,
  '%VALIDATION_FAILED%', 'catalog: a sale price above MRP is refused');

select lives_ok(
  $$ select process_admin_upsert_product(null, 'bb000000-0000-4000-8000-000000000001',
       'bb000000-0000-4000-8000-000000001002', 'Brand New', 'Acme', 'Snacks', '500 ml', 9000, 7500, true) $$,
  'catalog: an admin may create a product');
select is(
  (select count(*)::int from products where name = 'Brand New'
     and store_id = 'bb000000-0000-4000-8000-000000000001'),
  1, 'catalog: the product exists');
select is(
  (select i.qty_on_hand from inventory i join products p on p.id = i.product_id where p.name = 'Brand New'),
  0, 'catalog: a new product gets a zero-stock inventory row, so it is not silently unorderable');
select is(
  (select count(*)::int from audit_logs a join products p on p.id = a.entity_id
    where a.action = 'product.created' and p.name = 'Brand New'),
  1, 'catalog: creation is audited');


-- ============================================================
-- D. audit_logs stays append-only for every client role
-- ============================================================
-- RBAC §5: SELECT for admin, and no insert/update/delete policy at all.
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.audit_logs'::regclass and polcmd <> 'r'),
  0, 'audit: no INSERT/UPDATE/DELETE policy exists for any client role');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_name = 'audit_logs' and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'audit: `authenticated` has no write grant on audit_logs either');

select * from finish();
rollback;
