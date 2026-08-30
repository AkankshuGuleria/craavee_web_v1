-- RLS: runner and packer scoping
-- Phase 2 prompt §23 explicit examples: runner A cannot SELECT runner B's
-- assigned order; runner cannot SELECT wallet ledger; packer can access
-- only operational data required for packing, not customer financial
-- data. RBAC_MATRIX.md §3.
begin;
create extension if not exists pgtap;
select plan(14);

-- ---- fixtures ----
insert into stores (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Test Store');
insert into zones (id, store_id, name, delivery_fee)
  values ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000001', 'Zone A', 1000);
insert into auth.users (id, phone) values
  ('aaaaaaaa-0000-4000-8000-000000001001', '9990000101'),  -- customer
  ('aaaaaaaa-0000-4000-8000-000000005001', '9990000501'),  -- runner 1
  ('aaaaaaaa-0000-4000-8000-000000005002', '9990000502'),  -- runner 2
  ('aaaaaaaa-0000-4000-8000-000000006001', '9990000601');  -- packer
insert into addresses (id, customer_id, zone_id, block, room) values
  ('aaaaaaaa-0000-4000-8000-000000002001', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000101', 'Block A', '101');
insert into products (id, store_id, name, mrp, sale_price, category) values
  ('aaaaaaaa-0000-4000-8000-000000003001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Noodles', 50, 40, 'Instant Meals');
insert into inventory (store_id, product_id, qty_on_hand, qty_reserved)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000003001', 10, 0);
insert into runners (id, profile_id, store_id) values
  ('aaaaaaaa-0000-4000-8000-000000005101', 'aaaaaaaa-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000005102', 'aaaaaaaa-0000-4000-8000-000000005002', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into staff_roles (profile_id, role, store_id) values
  ('aaaaaaaa-0000-4000-8000-000000006001', 'packer', 'aaaaaaaa-0000-4000-8000-000000000001');

-- order O1: packed (claimable by any runner at this store)
insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key) values
  ('aaaaaaaa-0000-4000-8000-000000004001', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 'confirmed', 40, 10, 50, gen_random_uuid());
insert into payments (order_id, amount, status) values ('aaaaaaaa-0000-4000-8000-000000004001', 50, 'captured');
update orders set status = 'packed' where id = 'aaaaaaaa-0000-4000-8000-000000004001';

-- order O2: assigned to runner 1 (not claimable, and not runner 2's own)
insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key) values
  ('aaaaaaaa-0000-4000-8000-000000004002', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 'confirmed', 40, 10, 50, gen_random_uuid());
insert into payments (order_id, amount, status) values ('aaaaaaaa-0000-4000-8000-000000004002', 50, 'captured');
update orders set status = 'packed' where id = 'aaaaaaaa-0000-4000-8000-000000004002';
update orders set status = 'assigned', runner_id = 'aaaaaaaa-0000-4000-8000-000000005101' where id = 'aaaaaaaa-0000-4000-8000-000000004002';

insert into wallet_ledger (customer_id, delta, reason)
  values ('aaaaaaaa-0000-4000-8000-000000001001', 100, 'promo_credit');

-- ================= as runner 1 =================
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000005001","role":"runner","store_id":"aaaaaaaa-0000-4000-8000-000000000001"}';

select is(
  (select count(*)::int from orders where id = 'aaaaaaaa-0000-4000-8000-000000004001'),
  1,
  'runner sees claimable (packed) orders at their own store'
);

select is(
  (select count(*)::int from orders where id = 'aaaaaaaa-0000-4000-8000-000000004002'),
  1,
  'runner sees their own assigned order'
);

-- ================= as runner 2 (isolation) =================
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000005002","role":"runner","store_id":"aaaaaaaa-0000-4000-8000-000000000001"}';

select is(
  (select count(*)::int from orders where id = 'aaaaaaaa-0000-4000-8000-000000004001'),
  1,
  'runner 2 also sees the still-claimable order (visible to all runners at the store)'
);

select is(
  (select count(*)::int from orders where id = 'aaaaaaaa-0000-4000-8000-000000004002'),
  0,
  'runner 2 CANNOT see runner 1''s assigned order (Phase 2 prompt §23 example)'
);

-- `authenticated` DOES hold a table-level SELECT grant on wallet_ledger
-- (needed for customers/admin, who share the same Postgres role) — the
-- `wallet_ledger_select` RLS policy is what blocks a runner, by RLS-
-- filtering to zero rows rather than throwing.
select is(
  (select count(*)::int from wallet_ledger),
  0,
  'runner cannot read wallet_ledger at all (Phase 2 prompt §23 example) -- RLS filters to zero rows'
);

select throws_ok(
  $$ select count(*) from payments $$,
  '42501',
  null,
  'runner cannot read the base payments table (no grant)'
);

select is(
  (select count(*)::int from payments_customer_view),
  0,
  'runner cannot see any row via payments_customer_view either (view''s WHERE only matches customers)'
);

update inventory set qty_on_hand = 0 where product_id = 'aaaaaaaa-0000-4000-8000-000000003001';
select is(
  (select count(*)::int from products where id = 'aaaaaaaa-0000-4000-8000-000000003001'),
  1,
  'runner can read the catalog (needed to see item summaries) but...'
);
reset role;
select is(
  (select qty_on_hand from inventory where product_id = 'aaaaaaaa-0000-4000-8000-000000003001'),
  10,
  '...cannot edit inventory (Phase 2 prompt §23 example) -- unchanged after runner''s blocked UPDATE'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000005002","role":"runner","store_id":"aaaaaaaa-0000-4000-8000-000000000001"}';

-- runners table: can update own is_online, cannot touch profile_id/store_id
update runners set is_online = true where id = 'aaaaaaaa-0000-4000-8000-000000005102';
select is(
  (select is_online from runners where id = 'aaaaaaaa-0000-4000-8000-000000005102'),
  true,
  'runner can toggle their own is_online'
);

-- Cross-runner update: the RLS policy (profile_id = auth.uid()) filters
-- the target row out entirely, so this is 0 rows affected, not an error
-- — the trigger below never even fires because no row matches. Runner 2
-- also can't SELECT runner 1's row (runners_select is similarly scoped),
-- so verification happens from a privileged context, not the runner's
-- own (necessarily blind) view.
update runners set is_online = true where id = 'aaaaaaaa-0000-4000-8000-000000005101';
reset role;
reset request.jwt.claims;
select is(
  (select is_online from runners where id = 'aaaaaaaa-0000-4000-8000-000000005101'),
  false,
  'runner cannot edit another runner''s row (RLS filters it to zero rows, verified from a privileged context since runner 2 cannot even see runner 1''s row to check it)'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000005002","role":"runner","store_id":"aaaaaaaa-0000-4000-8000-000000000001"}';

-- Self-edit beyond is_online: the row DOES match (own row), so the
-- trigger fires and rejects the disallowed column change. Reassigning to
-- a genuinely different profile_id (runner 1's) rather than a same-value
-- no-op, so the trigger's changed-value check actually trips.
select throws_ok(
  $$ update runners set profile_id = 'aaaaaaaa-0000-4000-8000-000000005001' where id = 'aaaaaaaa-0000-4000-8000-000000005102' $$,
  'P0001',
  null,
  'runner self-edit is restricted to is_online (cannot change own profile_id)'
);

-- ================= as packer =================
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000006001","role":"packer","store_id":"aaaaaaaa-0000-4000-8000-000000000001"}';

select is(
  (select count(*)::int from orders where status in ('confirmed', 'packed')),
  1,
  'packer sees only confirmed/packed orders at their store (operational queue) -- excludes the assigned order'
);

select throws_ok(
  $$ select count(*) from payments $$,
  '42501',
  null,
  'packer cannot access payments (customer financial data), matching Phase 2 prompt §23'
);

select * from finish();
rollback;
