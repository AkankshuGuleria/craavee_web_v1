-- ============================================================
-- 00 — Schema smoke test
-- Structural assertions: every table/column/constraint/enum the Phase 2
-- prompt (§11, §35 gate) and DATABASE_SPEC.md require actually exists,
-- and RLS is enabled + FORCED on every spec table (RBAC_MATRIX.md §5:
-- "All tables have FORCE ROW LEVEL SECURITY").
-- ============================================================
begin;
create extension if not exists pgtap;

select plan(82);

-- ---- extensions ----
select has_extension('pgcrypto', 'pgcrypto extension present (gen_random_uuid, crypt)');
select has_extension('citext',   'citext extension present');

-- ---- required tables (Phase 2 prompt §11) ----
select has_table('public'::name, 'profiles'::name,          'table profiles');
select has_table('public'::name, 'staff_roles'::name,       'table staff_roles');
select has_table('public'::name, 'campaigns'::name,         'table campaigns');
select has_table('public'::name, 'stores'::name,            'table stores');
select has_table('public'::name, 'zones'::name,             'table zones');
select has_table('public'::name, 'addresses'::name,         'table addresses');
select has_table('public'::name, 'products'::name,          'table products');
select has_table('public'::name, 'inventory'::name,         'table inventory');
select has_table('public'::name, 'orders'::name,            'table orders');
select has_table('public'::name, 'order_items'::name,       'table order_items');
select has_table('public'::name, 'payments'::name,          'table payments');
select has_table('public'::name, 'webhook_events'::name,    'table webhook_events');
select has_table('public'::name, 'wallet_ledger'::name,     'table wallet_ledger');
select has_table('public'::name, 'runners'::name,           'table runners');
select has_table('public'::name, 'runner_earnings'::name,   'table runner_earnings');
select has_table('public'::name, 'promos'::name,            'table promos');
select has_table('public'::name, 'promo_redemptions'::name, 'table promo_redemptions');
select has_table('public'::name, 'audit_logs'::name,        'table audit_logs');
select has_table('public'::name, 'rate_limit_events'::name, 'table rate_limit_events');
select has_table('public'::name, 'refunds'::name,           'table refunds');

-- ---- enums (D6) ----
select has_type('public'::name, 'user_role'::name,            'enum user_role');
select has_type('public'::name, 'order_status'::name,         'enum order_status');
select has_type('public'::name, 'payment_status'::name,       'enum payment_status');
select has_type('public'::name, 'wallet_ledger_reason'::name, 'enum wallet_ledger_reason');
select is(
  (select string_agg(e.enumlabel::text, ',' order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status'),
  'created,confirmed,packed,assigned,picked_up,delivered,payment_failed,cancelled,delivery_failed',
  'order_status has exactly the 9 ORDER_STATE_MACHINE.md §1 states in order'
);
select is(
  (select string_agg(e.enumlabel::text, ',' order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'payment_status'),
  'pending,captured,failed,refunded,partially_refunded',
  'payment_status has exactly the 5 states'
);

-- ---- money columns are integer paise, never float/numeric (Phase 2 §12) ----
select col_type_is('public'::name, 'orders'::name,        'subtotal'::name,        'integer', 'orders.subtotal is integer paise');
select col_type_is('public'::name, 'orders'::name,        'payable'::name,         'integer', 'orders.payable is integer paise');
select col_type_is('public'::name, 'orders'::name,        'wallet_applied'::name,  'integer', 'orders.wallet_applied is integer paise');
select col_type_is('public'::name, 'orders'::name,        'delivery_fee'::name,    'integer', 'orders.delivery_fee is integer paise');
select col_type_is('public'::name, 'payments'::name,      'amount'::name,          'integer', 'payments.amount is integer paise');
select col_type_is('public'::name, 'payments'::name,      'refunded_amount'::name, 'integer', 'payments.refunded_amount is integer paise');
select col_type_is('public'::name, 'products'::name,      'mrp'::name,             'integer', 'products.mrp is integer paise');
select col_type_is('public'::name, 'products'::name,      'sale_price'::name,      'integer', 'products.sale_price is integer paise');
select col_type_is('public'::name, 'profiles'::name,      'wallet_balance'::name,  'integer', 'profiles.wallet_balance is integer paise');
select col_type_is('public'::name, 'wallet_ledger'::name, 'delta'::name,           'integer', 'wallet_ledger.delta is integer paise');
select col_type_is('public'::name, 'refunds'::name,       'amount'::name,          'integer', 'refunds.amount is integer paise');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and data_type in ('numeric','double precision','real','money')
      and (column_name ~ '(price|amount|balance|fee|payable|subtotal|delta|mrp|value)')),
  0, 'zero money-shaped columns use numeric/float/money'
);

-- ---- key columns ----
select has_column('public'::name, 'orders'::name, 'idempotency_key'::name,        'orders.idempotency_key');
select has_column('public'::name, 'orders'::name, 'reservation_expires_at'::name, 'orders.reservation_expires_at (D27)');
select has_column('public'::name, 'orders'::name, 'delivery_code_hash'::name,     'orders.delivery_code_hash (D14)');
select has_column('public'::name, 'orders'::name, 'runner_id'::name,              'orders.runner_id');
select has_column('public'::name, 'inventory'::name, 'qty_on_hand'::name,         'inventory.qty_on_hand');
select has_column('public'::name, 'inventory'::name, 'qty_reserved'::name,        'inventory.qty_reserved');
select has_column('public'::name, 'profiles'::name, 'wallet_balance'::name,       'profiles.wallet_balance (cached, D10)');
select has_column('public'::name, 'payments'::name, 'gateway_intent_requested_at'::name, 'payments.gateway_intent_requested_at (D24 claim marker)');

select col_not_null('public'::name, 'orders'::name, 'idempotency_key'::name, 'orders.idempotency_key NOT NULL (D23)');

-- ---- uniqueness (idempotency + one-row invariants) ----
select col_is_unique('public'::name, 'orders'::name,      ARRAY['idempotency_key']::name[], 'orders.idempotency_key UNIQUE (D23, correctness guarantee #1)');
select col_is_unique('public'::name, 'payments'::name,    ARRAY['order_id']::name[],        'payments.order_id UNIQUE — strict 1:1 with orders (D29)');
select col_is_unique('public'::name, 'refunds'::name,     ARRAY['idempotency_key']::name[], 'refunds.idempotency_key UNIQUE (D29)');
select col_is_unique('public'::name, 'staff_roles'::name, ARRAY['profile_id']::name[],      'staff_roles.profile_id UNIQUE — one role per profile');
select col_is_unique('public'::name, 'runners'::name,     ARRAY['profile_id']::name[],      'runners.profile_id UNIQUE (RBAC §3: one runner cannot map to multiple runner records)');
select col_is_unique('public'::name, 'profiles'::name,    ARRAY['phone']::name[],           'profiles.phone UNIQUE');
select col_is_unique('public'::name, 'inventory'::name,   ARRAY['store_id'::name,'product_id'::name], 'inventory (store_id, product_id) UNIQUE');
select col_is_unique('public'::name, 'webhook_events'::name, ARRAY['gateway'::name,'gateway_event_id'::name], 'webhook_events (gateway, gateway_event_id) UNIQUE — transport dedup (guarantee #2)');

-- ---- orders.runner_id references runners.id, NOT profiles.id (D28) ----
select is(
  (select confrelid::regclass::text
     from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'f'
      and conkey = (select array_agg(attnum) from pg_attribute
                    where attrelid = 'public.orders'::regclass and attname = 'runner_id')),
  'runners',
  'orders.runner_id FK targets runners, not profiles (D28)'
);

-- ---- one-live-job-per-runner partial unique index (D13/D28) ----
select is(
  (select count(*)::int from pg_indexes
    where tablename = 'orders' and indexdef ilike '%unique%'
      and indexdef ilike '%runner_id%'
      and indexdef ilike '%where%'
      and indexdef ilike '%assigned%' and indexdef ilike '%picked_up%'),
  1,
  'partial UNIQUE index on orders(runner_id) WHERE status in (assigned, picked_up) exists'
);

-- ---- reservation-expiry partial index (D27) ----
select is(
  (select count(*)::int from pg_indexes
    where tablename = 'orders' and indexdef ilike '%reservation_expires_at%' and indexdef ilike '%where%'),
  1, 'partial index on orders(reservation_expires_at) WHERE status = created exists'
);

-- ---- runner_earnings: one row per order, unsettled index ----
select is(
  (select count(*)::int from pg_indexes where tablename = 'runner_earnings' and indexdef ilike '%unique%' and indexdef ilike '%order_id%'),
  1, 'runner_earnings has a UNIQUE index on order_id (one earnings row per order)');
select is(
  (select count(*)::int from pg_indexes where tablename = 'runner_earnings' and indexdef ilike '%settled_at is null%'),
  1, 'runner_earnings has a partial index for unsettled earnings');

-- ---- CHECK constraints present ----
select has_check('public'::name, 'orders'::name,        'orders has CHECK constraints (payable math etc.)');
select has_check('public'::name, 'inventory'::name,     'inventory has CHECK constraints (reserved <= on_hand)');
select has_check('public'::name, 'payments'::name,      'payments has CHECK constraints (refunded <= amount)');
select has_check('public'::name, 'wallet_ledger'::name, 'wallet_ledger has a CHECK constraint (delta <> 0)');
select has_check('public'::name, 'products'::name,      'products has CHECK constraints (sale_price <= mrp)');
select has_check('public'::name, 'promos'::name,        'promos has CHECK constraints (uses_count <= max_uses)');

-- ---- triggers / functions ----
select has_function('public'::name, 'handle_new_user'::name,             'handle_new_user() exists');
select has_function('public'::name, 'custom_access_token_hook'::name,    ARRAY['jsonb']::name[], 'custom_access_token_hook(jsonb) exists');
select has_function('public'::name, 'enforce_order_transition'::name,    'enforce_order_transition() exists');
select has_function('public'::name, 'enforce_payment_transition'::name,  'enforce_payment_transition() exists');
select has_function('public'::name, 'check_payment_order_consistency'::name, 'check_payment_order_consistency() exists');
select has_trigger('public'::name, 'orders'::name,   'trg_enforce_order_transition'::name,   'orders has the state-machine trigger');
select has_trigger('public'::name, 'payments'::name, 'trg_enforce_payment_transition'::name, 'payments has the payment-state trigger');
select has_trigger('auth'::name,   'users'::name,    'on_auth_user_created'::name,           'auth.users has the profile-creation trigger');

-- ---- RLS enabled AND forced on every spec table ----
select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
     from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and c.relname = any (array[
        'profiles','staff_roles','campaigns','stores','zones','addresses','products','inventory',
        'orders','order_items','payments','webhook_events','wallet_ledger','runners','runner_earnings',
        'promos','promo_redemptions','audit_logs','rate_limit_events','refunds'])),
  'every spec table has RLS ENABLED and FORCED (RBAC_MATRIX.md §5)'
);

-- ---- policy-absence invariants (RBAC §5 "zero policies" tables) ----
-- staff_roles: no CLIENT-facing policy (customer/packer/runner/admin
-- sessions all connect as `authenticated` and must see nothing —
-- RBAC_MATRIX.md §5, the only write door is assign_staff_role). The one
-- policy that DOES exist (Phase 4, migration 0004) is scoped to
-- `supabase_auth_admin` only — the Custom Access Token Hook's execution
-- role — so it can read staff_roles to inject the JWT `role` claim
-- despite the table's FORCE RLS. No `authenticated`/`anon` grant, so no
-- client is affected.
select is(
  (select count(*)::int from pg_policies
    where tablename = 'staff_roles'
      and (roles && array['authenticated','anon','public']::name[])),
  0, 'staff_roles has NO client-facing RLS policy — only door in is assign_staff_role EF (RBAC §4)'
);
select is(
  (select string_agg(policyname || ':' || array_to_string(roles, ','), '; ' order by policyname)
     from pg_policies where tablename = 'staff_roles'),
  'staff_roles_auth_hook_read:supabase_auth_admin',
  'staff_roles has exactly one policy: the supabase_auth_admin-only Auth Hook read (migration 0004)'
);
select is(
  (select count(*)::int from pg_policies
    where tablename in ('webhook_events','rate_limit_events','promo_redemptions')
      and cmd in ('INSERT','UPDATE','DELETE','ALL')),
  0, 'webhook_events / rate_limit_events / promo_redemptions have no authenticated write policies'
);
select is(
  (select count(*)::int from pg_policies where tablename = 'orders' and cmd in ('INSERT','UPDATE','DELETE','ALL')),
  0, 'orders has NO direct write policy for any role — every write is EF/service-role (RBAC §5)'
);

-- ---- staff_role_store_required CHECK (packer/runner must have store_id) ----
select throws_ok(
  $$ insert into staff_roles (profile_id, role) values (gen_random_uuid(), 'packer') $$,
  '23514',
  null,
  'staff_roles: packer without store_id violates staff_role_store_required CHECK'
);

select * from finish();
rollback;
