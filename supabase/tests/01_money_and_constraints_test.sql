-- ============================================================
-- 01 — Money & data-integrity constraints
-- Phase 2 prompt §12 (money = integer paise, protected by constraints),
-- §13 (inventory reserved <= on_hand), §14 (payable/wallet arithmetic),
-- §15 (refunded <= amount), §16 (delta <> 0), §17 (uses <= max_uses).
-- Every assertion drives the DB directly (service-role / superuser
-- context) — this file is about CHECK/UNIQUE enforcement, not RLS.
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(24);

-- ---- fixtures ----
insert into auth.users (id, phone) values
  ('c0000000-0000-0000-0000-000000000001', '919890000001');
insert into stores (id, name) values ('50000000-0000-0000-0000-000000000001', 'Test Store');
insert into zones (id, store_id, name, delivery_fee)
  values ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Zone A', 1000);
insert into addresses (id, customer_id, zone_id, block, room)
  values ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', 'Block A', '101');
insert into products (id, store_id, name, mrp, sale_price, category)
  values ('b0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Noodles', 5000, 4000, 'Instant');
insert into inventory (id, store_id, product_id, qty_on_hand, qty_reserved)
  values ('e0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-000000000001', 10, 3);

-- ============================================================
-- products — sale_price <= mrp, non-negative money (§12)
-- ============================================================
select throws_ok(
  $$ insert into products (store_id, name, mrp, sale_price, category)
     values ('50000000-0000-0000-0000-000000000001', 'Bad', 4000, 5000, 'X') $$,
  '23514', null, 'products: sale_price > mrp rejected (sale_price_not_above_mrp)');

select throws_ok(
  $$ insert into products (store_id, name, mrp, sale_price, category)
     values ('50000000-0000-0000-0000-000000000001', 'Bad', -1, 0, 'X') $$,
  '23514', null, 'products: negative mrp rejected');

select lives_ok(
  $$ insert into products (store_id, name, mrp, sale_price, category)
     values ('50000000-0000-0000-0000-000000000001', 'OK', 4000, 4000, 'X') $$,
  'products: sale_price == mrp is allowed');

-- ============================================================
-- inventory — qty_reserved <= qty_on_hand (§13), non-negative
-- ============================================================
select throws_ok(
  $$ update inventory set qty_reserved = 11
     where id = 'e0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'inventory: qty_reserved > qty_on_hand rejected (reserved_not_above_on_hand)');

select throws_ok(
  $$ update inventory set qty_on_hand = 2
     where id = 'e0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'inventory: lowering qty_on_hand below qty_reserved rejected — the D-spec backstop even on the admin manual-count path (RBAC §4)');

select throws_ok(
  $$ update inventory set qty_reserved = -1
     where id = 'e0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'inventory: negative qty_reserved rejected');

select throws_ok(
  $$ insert into inventory (store_id, product_id, qty_on_hand)
     values ('50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 5) $$,
  '23505', null, 'inventory: duplicate (store_id, product_id) rejected');

-- ============================================================
-- orders — payable arithmetic + wallet arithmetic (§14)
-- ============================================================
select throws_ok(
  $$ insert into orders (customer_id, store_id, address_id, subtotal, delivery_fee, wallet_applied, payable, idempotency_key)
     values ('c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
             4000, 1000, 0, 9999, gen_random_uuid()) $$,
  '23514', null, 'orders: payable != subtotal + delivery_fee - wallet_applied rejected (payable_matches_math)');

select throws_ok(
  $$ insert into orders (customer_id, store_id, address_id, subtotal, delivery_fee, wallet_applied, payable, idempotency_key)
     values ('c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
             4000, 1000, 6000, -1000, gen_random_uuid()) $$,
  '23514', null, 'orders: wallet_applied exceeding subtotal + delivery_fee rejected (wallet_not_above_total / payable >= 0)');

select throws_ok(
  $$ insert into orders (customer_id, store_id, address_id, subtotal, delivery_fee, payable, idempotency_key)
     values ('c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
             -1, 0, -1, gen_random_uuid()) $$,
  '23514', null, 'orders: negative subtotal rejected');

select lives_ok(
  $$ insert into orders (id, customer_id, store_id, address_id, subtotal, delivery_fee, wallet_applied, payable, idempotency_key)
     values ('f0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-000000000001', 4000, 1000, 500, 4500, 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'orders: a correctly-balanced order (4000 + 1000 - 500 = 4500) is accepted');

select throws_ok(
  $$ insert into orders (customer_id, store_id, address_id, subtotal, delivery_fee, payable, idempotency_key)
     values ('c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
             100, 0, 100, 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '23505', null, 'orders: duplicate idempotency_key rejected (correctness guarantee #1, D23)');

-- orders needs a payments row for the consistency trigger; add it (deferred, fine)
insert into payments (order_id, amount, status)
  values ('f0000000-0000-0000-0000-000000000001', 4500, 'pending');

-- ============================================================
-- order_items — qty > 0, fulfilled_qty <= qty
-- ============================================================
select throws_ok(
  $$ insert into order_items (order_id, product_id, qty, unit_price)
     values ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001', 0, 4000) $$,
  '23514', null, 'order_items: qty = 0 rejected');

select throws_ok(
  $$ insert into order_items (order_id, product_id, qty, unit_price, fulfilled_qty)
     values ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001', 2, 4000, 3) $$,
  '23514', null, 'order_items: fulfilled_qty > qty rejected');

-- ============================================================
-- payments — refunded_amount <= amount (§15), non-negative
-- ============================================================
select throws_ok(
  $$ update payments set refunded_amount = 5000 where order_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'payments: refunded_amount > amount rejected (refunded_not_above_amount)');

select throws_ok(
  $$ insert into payments (order_id, amount) values ('f0000000-0000-0000-0000-000000000001', 100) $$,
  '23505', null, 'payments: second row for the same order_id rejected — strict 1:1 (D29)');

-- ============================================================
-- refunds — amount > 0, idempotency_key UNIQUE (D29)
-- ============================================================
select throws_ok(
  $$ insert into refunds (payment_id, amount, reason, idempotency_key)
     select id, 0, 'x', gen_random_uuid() from payments where order_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'refunds: amount = 0 rejected (amount > 0)');

-- ============================================================
-- wallet_ledger — delta <> 0 (§16)
-- ============================================================
select throws_ok(
  $$ insert into wallet_ledger (customer_id, delta, reason)
     values ('c0000000-0000-0000-0000-000000000001', 0, 'manual_adjustment') $$,
  '23514', null, 'wallet_ledger: delta = 0 rejected (delta_not_zero)');

select lives_ok(
  $$ insert into wallet_ledger (customer_id, delta, reason)
     values ('c0000000-0000-0000-0000-000000000001', -250, 'checkout_redemption') $$,
  'wallet_ledger: a negative delta (a debit) is allowed — the ledger is signed');

-- ============================================================
-- profiles — wallet_balance >= 0
-- (done under an admin claim so the full_name-only self-edit trigger,
--  which fires for every non-admin context including this no-JWT
--  superuser one, doesn't mask the CHECK we're actually testing)
-- ============================================================
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"admin"}';
select throws_ok(
  $$ update profiles set wallet_balance = -1 where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'profiles: negative wallet_balance rejected');
set local request.jwt.claims to default;

-- ============================================================
-- promos — uses_count <= max_uses (§17), non-negative value
-- ============================================================
select throws_ok(
  $$ insert into promos (code, type, value, max_uses, uses_count, valid_from)
     values ('OVERUSED', 'flat', 5000, 5, 6, now()) $$,
  '23514', null, 'promos: uses_count > max_uses rejected (uses_not_above_max)');

select lives_ok(
  $$ insert into promos (code, type, value, max_uses, valid_from)
     values ('WELCOME', 'flat', 5000, 100, now()) $$,
  'promos: a valid promo row is accepted');

select throws_ok(
  $$ insert into promos (code, type, value, valid_from) values ('DUPE', 'flat', 1, now()),
                                                               ('DUPE', 'percent', 10, now()) $$,
  '23505', null, 'promos: duplicate code rejected');

-- ============================================================
-- zones — delivery_fee >= 0
-- ============================================================
select throws_ok(
  $$ insert into zones (store_id, name, delivery_fee)
     values ('50000000-0000-0000-0000-000000000001', 'Bad Zone', -100) $$,
  '23514', null, 'zones: negative delivery_fee rejected');

select * from finish();
rollback;
