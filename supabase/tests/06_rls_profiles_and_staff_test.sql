-- ============================================================
-- 04 — RLS: profiles + staff_roles
-- Phase 2 prompt §22/§23. RBAC_MATRIX.md §5 (profiles, staff_roles).
-- Every policy gets a positive AND a negative test (§23: "Do not test
-- only the happy path").
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(16);  -- corrected Phase 2A: file has 16 assertion calls, not 18 (pre-existing miscount)

-- ---------------- fixtures (superuser / RLS bypassed) ----------------
insert into stores (id, name) values
  ('50000000-0000-0000-0000-000000000001', 'Store A'),
  ('50000000-0000-0000-0000-000000000002', 'Store B');
insert into zones (id, store_id, name, delivery_fee) values
  ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Zone A1', 1000);

insert into auth.users (id, phone) values
  ('c0000000-0000-0000-0000-000000000001', '9890000001'),   -- customer A
  ('c0000000-0000-0000-0000-000000000002', '9890000002'),   -- customer B
  ('70000000-0000-0000-0000-000000000001', '9990000101'),   -- packer @ A
  ('80000000-0000-0000-0000-000000000001', '9990000201'),   -- runner @ A
  ('ad000000-0000-0000-0000-000000000001', '9990000301');   -- admin
update profiles set full_name = 'Customer A' where id = 'c0000000-0000-0000-0000-000000000001';
update profiles set full_name = 'Customer B' where id = 'c0000000-0000-0000-0000-000000000002';

insert into staff_roles (profile_id, role, store_id) values
  ('70000000-0000-0000-0000-000000000001', 'packer', '50000000-0000-0000-0000-000000000001'),
  ('ad000000-0000-0000-0000-000000000001', 'admin', null);
insert into runners (id, profile_id, store_id) values
  ('d0000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');

insert into addresses (id, customer_id, zone_id, block, room) values
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A', '1');

-- a live job (assigned) for runner @ A, belonging to customer A
insert into orders (id, customer_id, store_id, address_id, runner_id, status, subtotal, delivery_fee, payable, idempotency_key)
  values ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
          '50000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          'd0000000-0000-0000-0000-000000000001', 'assigned', 4000, 1000, 5000, gen_random_uuid());
insert into payments (order_id, amount, status) values ('f0000000-0000-0000-0000-000000000001', 5000, 'captured');

-- ================= as CUSTOMER A =================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"customer"}';

select is((select count(*)::int from profiles), 1, 'profiles SELECT+: customer sees exactly one profile row (their own)');
select is((select full_name from profiles), 'Customer A', 'profiles SELECT+: and it is their own row');
select is((select count(*)::int from profiles where id = 'c0000000-0000-0000-0000-000000000002'),
          0, 'profiles SELECT-: customer A cannot see customer B');

select lives_ok($$ update profiles set full_name = 'Renamed A' where id = 'c0000000-0000-0000-0000-000000000001' $$,
  'profiles UPDATE+: customer can update their own full_name');
select is((select full_name from profiles where id = 'c0000000-0000-0000-0000-000000000001'),
          'Renamed A', 'profiles UPDATE+: the rename actually took');

select throws_like($$ update profiles set wallet_balance = 999999 where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '%only update full_name%', 'profiles UPDATE-: customer cannot change wallet_balance (column-restricted, RBAC §5)');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000002","role":"customer"}';
update profiles set full_name = 'Hacked' where id = 'c0000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"customer"}';
select is((select full_name from profiles where id = 'c0000000-0000-0000-0000-000000000001'),
          'Renamed A', 'profiles UPDATE-: customer B''s UPDATE of customer A''s row affects 0 rows');

select throws_ok($$ insert into profiles (id, phone) values (gen_random_uuid(), '9') $$,
  '42501', null, 'profiles INSERT-: no INSERT path for authenticated (rows come only from handle_new_user)');
select throws_ok($$ delete from profiles where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'profiles DELETE-: no DELETE path for authenticated');

-- staff_roles: zero policy AND zero grant for authenticated -> not even readable
select throws_ok($$ select count(*) from staff_roles $$, '42501', null,
  'staff_roles SELECT-: a customer cannot read staff_roles at all (RBAC §5 zero-policy)');
select throws_ok(
  $$ insert into staff_roles (profile_id, role, store_id)
     values ('c0000000-0000-0000-0000-000000000001', 'admin', null) $$,
  '42501', null, 'staff_roles INSERT-: a customer cannot self-assign a staff role (privilege-escalation attempt, §23)');

-- ================= as RUNNER @ A (has a live job for customer A) =================
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-000000000001","role":"runner","store_id":"50000000-0000-0000-0000-000000000001"}';
select is((select count(*)::int from profiles where id = 'c0000000-0000-0000-0000-000000000001'),
          1, 'profiles SELECT+: a runner sees the profile of the customer on their live job (RBAC §5)');
select is((select count(*)::int from profiles where id = 'c0000000-0000-0000-0000-000000000002'),
          0, 'profiles SELECT-: a runner cannot see an unrelated customer''s profile');

-- ================= as ADMIN =================
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-000000000001","role":"admin"}';
select is((select count(*)::int from profiles where id = 'c0000000-0000-0000-0000-000000000002'),
          1, 'profiles SELECT+: admin can see any customer profile');
select throws_ok($$ select count(*) from staff_roles $$, '42501', null,
  'staff_roles SELECT-: even an admin cannot reach staff_roles through PostgREST — the only door is the assign_staff_role EF (RBAC §4)');

-- ================= as ANON =================
-- Phase 2A finding: `anon` has NO grant on `profiles` at all (same
-- least-privilege pattern as orders/runners/wallet_ledger/etc. — there
-- is no legitimate reason for a pre-auth visitor to query profile data,
-- and RBAC_MATRIX.md never lists anon as having any profiles access).
-- The correct expectation is therefore a real permission-denied, not a
-- gracefully-empty result — this assertion originally expected the
-- latter, which is what surfaced the auth_runner_id() SECURITY DEFINER
-- gap (see DECISION_LOG.md / PHASE_2_IMPLEMENTATION_REPORT.md "test
-- failures found and fixes"). Corrected here to match the intended
-- design rather than loosening the grant to fit the old assertion.
set local role anon;
set local request.jwt.claims to default;
select throws_ok(
  $$ select count(*) from profiles $$,
  '42501', null,
  'profiles SELECT-: an unauthenticated session cannot query profiles at all (no grant, matching every other customer-scoped table)'
);

reset role;
select * from finish();
rollback;
