-- ============================================================
-- 02 — Auth & role infrastructure
-- Phase 2 prompt §20 (role system), §21 (handle_new_user), and
-- SECURITY_MODEL.md §1 / DECISION_LOG.md D8 (custom access token hook).
-- The hook is what puts `role` into the JWT from staff_roles server-side
-- — nothing downstream (RLS, the state-machine trigger) is trustworthy
-- if this is wrong, so it gets its own file.
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(14);

insert into stores (id, name) values ('50000000-0000-0000-0000-000000000001', 'Store A');

-- ============================================================
-- handle_new_user — profile creation on auth.users insert (§21)
-- ============================================================
insert into auth.users (id, phone) values ('c0000000-0000-0000-0000-000000000001', '9890000001');

select is(
  (select count(*)::int from profiles where id = 'c0000000-0000-0000-0000-000000000001'),
  1, 'handle_new_user: a profiles row is created on auth.users insert');

select is(
  (select phone from profiles where id = 'c0000000-0000-0000-0000-000000000001'),
  '9890000001', 'handle_new_user: the new profile carries the auth user phone');

select is(
  (select wallet_balance from profiles where id = 'c0000000-0000-0000-0000-000000000001'),
  0, 'handle_new_user: new profile starts with a zero wallet balance');

-- idempotency / no-clobber: the ON CONFLICT DO NOTHING that makes the
-- trigger safe on retries also means a re-insert never overwrites.
update profiles set full_name = 'Real Name' where id = 'c0000000-0000-0000-0000-000000000001';
insert into public.profiles (id, phone) values ('c0000000-0000-0000-0000-000000000001', '0000000000')
  on conflict (id) do nothing;
select is(
  (select full_name from profiles where id = 'c0000000-0000-0000-0000-000000000001'),
  'Real Name', 'handle_new_user ON CONFLICT DO NOTHING: an existing profile is never overwritten on retry (§21)');
select is(
  (select phone from profiles where id = 'c0000000-0000-0000-0000-000000000001'),
  '9890000001', 'handle_new_user ON CONFLICT DO NOTHING: phone is not clobbered on retry');

-- ============================================================
-- custom_access_token_hook — role claim injection (D8)
-- ============================================================
insert into auth.users (id, phone) values
  ('70000000-0000-0000-0000-000000000001', '9990000101'),   -- becomes packer
  ('ad000000-0000-0000-0000-000000000001', '9990000201');   -- becomes admin

-- No staff_roles row yet -> default customer
select is(
  custom_access_token_hook(
    '{"user_id":"c0000000-0000-0000-0000-000000000001","claims":{"sub":"c0000000-0000-0000-0000-000000000001"}}'::jsonb
  ) -> 'claims' ->> 'role',
  'customer',
  'hook: a user with no staff_roles row gets role=customer (D8 default)');

select ok(
  not (custom_access_token_hook(
    '{"user_id":"c0000000-0000-0000-0000-000000000001","claims":{}}'::jsonb
  ) -> 'claims' ? 'store_id'),
  'hook: a customer gets no store_id claim');

-- packer with a store
insert into staff_roles (profile_id, role, store_id)
  values ('70000000-0000-0000-0000-000000000001', 'packer', '50000000-0000-0000-0000-000000000001');

select is(
  custom_access_token_hook(
    '{"user_id":"70000000-0000-0000-0000-000000000001","claims":{}}'::jsonb
  ) -> 'claims' ->> 'role',
  'packer', 'hook: a staff_roles packer row yields role=packer');

select is(
  custom_access_token_hook(
    '{"user_id":"70000000-0000-0000-0000-000000000001","claims":{}}'::jsonb
  ) -> 'claims' ->> 'store_id',
  '50000000-0000-0000-0000-000000000001',
  'hook: a scoped staff role also injects store_id into the JWT');

-- admin with null store_id (all-store scope)
insert into staff_roles (profile_id, role, store_id)
  values ('ad000000-0000-0000-0000-000000000001', 'admin', null);

select is(
  custom_access_token_hook(
    '{"user_id":"ad000000-0000-0000-0000-000000000001","claims":{}}'::jsonb
  ) -> 'claims' ->> 'role',
  'admin', 'hook: an admin staff_roles row yields role=admin');

select ok(
  not (custom_access_token_hook(
    '{"user_id":"ad000000-0000-0000-0000-000000000001","claims":{}}'::jsonb
  ) -> 'claims' ? 'store_id'),
  'hook: an all-store admin (store_id null) gets no store_id claim');

-- hook must preserve pre-existing claims it does not own
select is(
  custom_access_token_hook(
    '{"user_id":"70000000-0000-0000-0000-000000000001","claims":{"aud":"authenticated","email":"x@y.z"}}'::jsonb
  ) -> 'claims' ->> 'email',
  'x@y.z', 'hook: unrelated existing claims are passed through untouched');

-- ============================================================
-- hook privilege lockdown (§20: client cannot invoke it)
-- ============================================================
select ok(
  not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'hook: EXECUTE is revoked from authenticated and anon (SECURITY_MODEL.md §1)');

select ok(
  has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'hook: supabase_auth_admin CAN execute it (so Supabase Auth can actually run the hook)');

select * from finish();
rollback;
