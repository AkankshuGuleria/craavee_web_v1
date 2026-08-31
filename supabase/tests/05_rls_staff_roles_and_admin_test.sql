-- RLS: staff_roles cannot be client-written; admin allowed behavior
-- matches RBAC_MATRIX.md §2. Phase 2 prompt §23: "unauthorized user
-- tries to manipulate staff_roles → denied", "admin allowed behavior →
-- permitted according to matrix".
begin;
create extension if not exists pgtap;
select plan(10);

insert into stores (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Test Store');
insert into auth.users (id, phone) values
  ('aaaaaaaa-0000-4000-8000-000000001001', '919990000101'),  -- customer
  ('aaaaaaaa-0000-4000-8000-000000007001', '919990000701'),  -- admin
  ('aaaaaaaa-0000-4000-8000-000000006001', '919990000601');  -- packer target for role assignment
insert into staff_roles (profile_id, role, store_id) values
  ('aaaaaaaa-0000-4000-8000-000000007001', 'admin', null);
insert into products (id, store_id, name, mrp, sale_price, category, is_listed) values
  ('aaaaaaaa-0000-4000-8000-000000003001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Noodles', 50, 40, 'Instant Meals', false);

-- ================= as customer (unauthorized actor) =================
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001001","role":"customer"}';

select throws_ok(
  $$ select count(*) from staff_roles $$,
  '42501', null,
  'customer cannot read staff_roles (no grant at all)'
);

select throws_ok(
  $$ insert into staff_roles (profile_id, role, store_id) values ('aaaaaaaa-0000-4000-8000-000000006001', 'admin', null) $$,
  '42501', null,
  'unauthorized user cannot INSERT into staff_roles (Phase 2 prompt §23 example) -- no self-service staff registration path'
);

-- ================= as admin =================
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000007001","role":"admin"}';

-- RBAC_MATRIX.md §5 is explicit: staff_roles has NO policy for
-- `authenticated` at all, not even for admin -- reads happen via the
-- Auth Hook (supabase_auth_admin) or an admin-only Edge Function using
-- the service role internally, never a direct client query. This is a
-- stricter guarantee than "admin can read directly, others can't".
select throws_ok(
  $$ select count(*) from staff_roles $$,
  '42501', null,
  'even admin cannot read staff_roles directly -- no client (not even admin) has a policy on this table, per RBAC_MATRIX.md §5'
);

-- Admin still has no direct write grant on staff_roles (D8: the only
-- door in is assign_staff_role, a service-role Edge Function — even
-- admin sessions go through it, not a direct table write, so that the
-- function's own actor check per RBAC_MATRIX.md §4 is never bypassable).
select throws_ok(
  $$ insert into staff_roles (profile_id, role, store_id) values ('aaaaaaaa-0000-4000-8000-000000006001', 'packer', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null,
  'even admin cannot write staff_roles directly -- assign_staff_role EF is the only door (Phase 1.1 D-series design)'
);

-- Admin CAN see and edit unlisted products (unlike a customer)
select is(
  (select count(*)::int from products where id = 'aaaaaaaa-0000-4000-8000-000000003001'),
  1,
  'admin can see unlisted products (RBAC_MATRIX.md §5)'
);

update products set is_listed = true where id = 'aaaaaaaa-0000-4000-8000-000000003001';
select is(
  (select is_listed from products where id = 'aaaaaaaa-0000-4000-8000-000000003001'),
  true,
  'admin can edit catalog/pricing directly (RBAC_MATRIX.md §4: simple RLS write, no EF needed)'
);

-- Admin can read the full payments row set (via the admin view) once a
-- payment exists -- smoke check the view is reachable for admin (row
-- content itself is covered by test file 01).
select lives_ok(
  $$ select count(*) from payments_admin_view $$,
  'admin can query payments_admin_view without error'
);

-- Admin cannot write orders directly either (RBAC_MATRIX.md §5: "even
-- admin overrides go through an Edge Function") -- no INSERT/UPDATE
-- grant on orders exists for `authenticated` at all, admin included.
select throws_ok(
  $$ update orders set status = 'cancelled' where store_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '42501', null,
  'even admin cannot directly UPDATE orders.status -- Edge-Function-only, no exceptions (RBAC_MATRIX.md §5)'
);

select throws_ok(
  $$ insert into orders (customer_id, store_id, address_id, subtotal, delivery_fee, payable, idempotency_key)
     values ('aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(), 10, 0, 10, gen_random_uuid()) $$,
  '42501', null,
  'even admin cannot directly INSERT orders -- create_order EF is the only door'
);

-- Admin CAN manage store config directly (RLS simple write, RBAC_MATRIX §4)
update stores set is_open = false, pause_reason = 'test pause' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is(
  (select pause_reason from stores where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'test pause',
  'admin can directly manage store config (open/closed, pause reason)'
);

select * from finish();
rollback;
