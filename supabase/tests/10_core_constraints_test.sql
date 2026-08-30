-- Core correctness constraints: money, inventory, wallet, promo,
-- idempotency, one-live-job-per-runner. DATABASE_SPEC.md throughout,
-- DECISION_LOG.md D7 (money), D11 (inventory), D13/D28 (runner claim),
-- D23 (idempotency), D26 (promo), D29 (refund).
begin;
create extension if not exists pgtap;
select plan(14);

insert into stores (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Test Store');
insert into zones (id, store_id, name, delivery_fee)
  values ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000001', 'Zone A', 1000);
insert into auth.users (id, phone) values
  ('aaaaaaaa-0000-4000-8000-000000001001', '9990000101'),
  ('aaaaaaaa-0000-4000-8000-000000005001', '9990000501'),
  ('aaaaaaaa-0000-4000-8000-000000005002', '9990000502');
insert into addresses (id, customer_id, zone_id, block, room) values
  ('aaaaaaaa-0000-4000-8000-000000002001', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000101', 'Block A', '101');
insert into products (id, store_id, name, mrp, sale_price, category) values
  ('aaaaaaaa-0000-4000-8000-000000003001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Noodles', 50, 40, 'Instant Meals');
insert into runners (id, profile_id, store_id) values
  ('aaaaaaaa-0000-4000-8000-000000005101', 'aaaaaaaa-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000005102', 'aaaaaaaa-0000-4000-8000-000000005002', 'aaaaaaaa-0000-4000-8000-000000000001');

-- ---- Money: integer columns, no float/numeric/decimal ----
select is(
  (select data_type from information_schema.columns where table_name = 'orders' and column_name = 'payable'),
  'integer',
  'orders.payable is integer (paise), not float/numeric/decimal -- D7'
);
select is(
  (select data_type from information_schema.columns where table_name = 'payments' and column_name = 'amount'),
  'integer',
  'payments.amount is integer (paise) -- D7'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and data_type in ('numeric', 'double precision', 'real')
      and column_name in ('amount', 'payable', 'subtotal', 'discount', 'delivery_fee', 'wallet_applied', 'refunded_amount', 'delta', 'wallet_balance', 'mrp', 'sale_price', 'value')),
  0,
  'no money-bearing column anywhere uses float/numeric/decimal -- D7 sweep across all tables'
);

-- ---- Inventory reservation ----
insert into inventory (store_id, product_id, qty_on_hand, qty_reserved)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000003001', 5, 3);
select throws_ok(
  $$ update inventory set qty_reserved = 6 where product_id = 'aaaaaaaa-0000-4000-8000-000000003001' $$,
  '23514', null,
  'qty_reserved cannot exceed qty_on_hand -- reserved_not_above_on_hand CHECK (D11)'
);
select throws_ok(
  $$ update inventory set qty_on_hand = -1 where product_id = 'aaaaaaaa-0000-4000-8000-000000003001' $$,
  '23514', null,
  'qty_on_hand cannot go negative'
);
select throws_ok(
  $$ insert into inventory (store_id, product_id, qty_on_hand) values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000003001', 1) $$,
  '23505', null,
  'only one inventory row per (store_id, product_id) -- UNIQUE constraint'
);

-- ---- Wallet balance cannot go negative ----
insert into wallet_ledger (customer_id, delta, reason) values ('aaaaaaaa-0000-4000-8000-000000001001', 50, 'promo_credit');
update profiles set wallet_balance = 50 where id = 'aaaaaaaa-0000-4000-8000-000000001001';
select throws_ok(
  $$ update profiles set wallet_balance = -10 where id = 'aaaaaaaa-0000-4000-8000-000000001001' $$,
  '23514', null,
  'profiles.wallet_balance cannot go negative -- CHECK constraint (D10/D25 backstop)'
);
select throws_ok(
  $$ insert into wallet_ledger (customer_id, delta, reason) values ('aaaaaaaa-0000-4000-8000-000000001001', 0, 'manual_adjustment') $$,
  '23514', null,
  'wallet_ledger.delta cannot be zero -- delta_not_zero CHECK'
);

-- ---- One live job per runner (D13, D28 -- runner_id -> runners.id) ----
insert into orders (id, customer_id, store_id, address_id, status, runner_id, subtotal, delivery_fee, payable, idempotency_key) values
  ('aaaaaaaa-0000-4000-8000-000000004001', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 'assigned', 'aaaaaaaa-0000-4000-8000-000000005101', 40, 10, 50, gen_random_uuid());
insert into payments (order_id, amount, status) values ('aaaaaaaa-0000-4000-8000-000000004001', 50, 'captured');
select throws_ok(
  format($f$ insert into orders (id, customer_id, store_id, address_id, status, runner_id, subtotal, delivery_fee, payable, idempotency_key)
    values (%L, 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 'assigned', 'aaaaaaaa-0000-4000-8000-000000005101', 40, 10, 50, gen_random_uuid()) $f$, gen_random_uuid()),
  '23505', null,
  'a runner cannot have two orders in assigned/picked_up simultaneously -- idx_orders_one_live_job_per_runner (D13/D28)'
);

-- Different runner, same store, same target status -- must succeed (the
-- constraint is per-runner, not a global single-active-order lock).
insert into orders (id, customer_id, store_id, address_id, status, runner_id, subtotal, delivery_fee, payable, idempotency_key) values
  ('aaaaaaaa-0000-4000-8000-000000004002', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 'assigned', 'aaaaaaaa-0000-4000-8000-000000005102', 40, 10, 50, gen_random_uuid());
insert into payments (order_id, amount, status) values ('aaaaaaaa-0000-4000-8000-000000004002', 50, 'captured');
select is(
  (select count(*)::int from orders where runner_id = 'aaaaaaaa-0000-4000-8000-000000005102' and status = 'assigned'),
  1,
  'a DIFFERENT runner can independently hold a live job at the same time'
);

-- ---- Idempotency key uniqueness (dossier guarantee #1, D23) ----
select throws_ok(
  format($f$ insert into orders (customer_id, store_id, address_id, subtotal, delivery_fee, payable, idempotency_key)
    select customer_id, store_id, address_id, subtotal, delivery_fee, payable, idempotency_key from orders where id = %L $f$, 'aaaaaaaa-0000-4000-8000-000000004001'),
  '23505', null,
  'idempotency_key is UNIQUE NOT NULL -- dossier correctness guarantee #1 (D23)'
);

-- ---- Refund invariant (D29) ----
update payments set refunded_amount = 50 where order_id = 'aaaaaaaa-0000-4000-8000-000000004001';
select throws_ok(
  $$ update payments set refunded_amount = 51 where order_id = 'aaaaaaaa-0000-4000-8000-000000004001' $$,
  '23514', null,
  'refunded_amount cannot exceed amount -- refunded_not_above_amount CHECK (D29)'
);

-- ---- Promo uses_count invariant (D26) ----
insert into promos (id, code, type, value, max_uses, uses_count, valid_from) values
  ('aaaaaaaa-0000-4000-8000-000000008001', 'LAUNCH10', 'flat', 1000, 5, 5, now());
select throws_ok(
  $$ update promos set uses_count = 6 where id = 'aaaaaaaa-0000-4000-8000-000000008001' $$,
  '23514', null,
  'promos.uses_count cannot exceed max_uses -- uses_not_above_max CHECK (D26)'
);

-- ---- payable arithmetic (D-original) ----
select throws_ok(
  format($f$ insert into orders (customer_id, store_id, address_id, subtotal, delivery_fee, wallet_applied, payable, idempotency_key)
    values ('aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 100, 10, 0, %s, gen_random_uuid()) $f$, 999),
  '23514', null,
  'payable must equal subtotal + delivery_fee - wallet_applied -- payable_matches_math CHECK'
);

select * from finish();
rollback;
