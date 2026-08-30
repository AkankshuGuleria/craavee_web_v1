-- ============================================================
-- 11 — Order creation + inventory correctness (Phase 4)
--
-- Unit tests of the migration 0004 functions, exercised directly over
-- psql (RLS bypassed on purpose — these test the FUNCTION logic; the
-- Edge Function auth/envelope layer is covered by the integration suite
-- in apps/customer-runner/__tests__/order.integration.test.ts).
--
-- Canonical: API_CONTRACTS.md §3, PHASE_1_1_CORRECTIONS.md §4/§5/§6,
-- ORDER_STATE_MACHINE.md §2/§2.1, DECISION_LOG.md D11/D25/D26/D27/D33,
-- TEST_STRATEGY.md §2 (#1 no duplicate orders, #3 no overselling) and
-- §2.1 (wallet/promo concurrency — the genuinely-parallel versions live
-- in the integration suite; the single-transaction invariants are here).
--
-- Whole file rolls back at the end (pgTAP convention). The deferred
-- check_payment_order_consistency trigger is validated exhaustively in
-- 09_payment_order_consistency_test.sql; here it simply never fires
-- (no COMMIT, no `set constraints immediate`), which is fine.
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(45);

-- ---- fixtures -------------------------------------------------
insert into stores (id, name, is_open, max_queue_depth) values
  ('b1000000-0000-4000-8000-000000000001', 'Phase4 Store', true, 9999);
insert into zones (id, store_id, name, delivery_fee, is_serviceable) values
  ('b1000000-0000-4000-8000-000000000101', 'b1000000-0000-4000-8000-000000000001', 'Serviceable Zone', 1000, true),
  ('b1000000-0000-4000-8000-000000000102', 'b1000000-0000-4000-8000-000000000001', 'Paused Zone', 1500, false);

insert into auth.users (id, phone) values
  ('b1000000-0000-4000-8000-000000001001', '9911000001'),
  ('b1000000-0000-4000-8000-000000001002', '9911000002');

insert into addresses (id, customer_id, zone_id, block, room) values
  ('b1000000-0000-4000-8000-000000002001', 'b1000000-0000-4000-8000-000000001001', 'b1000000-0000-4000-8000-000000000101', 'A', '1'),
  ('b1000000-0000-4000-8000-000000002002', 'b1000000-0000-4000-8000-000000001002', 'b1000000-0000-4000-8000-000000000101', 'B', '2'),
  ('b1000000-0000-4000-8000-000000002003', 'b1000000-0000-4000-8000-000000001001', 'b1000000-0000-4000-8000-000000000102', 'A', '9');

insert into products (id, store_id, name, mrp, sale_price, category, is_listed) values
  ('b1000000-0000-4000-8000-000000003001', 'b1000000-0000-4000-8000-000000000001', 'P1', 6000, 5000, 'Snacks', true),
  ('b1000000-0000-4000-8000-000000003002', 'b1000000-0000-4000-8000-000000000001', 'P2', 3500, 3000, 'Snacks', true),
  ('b1000000-0000-4000-8000-000000003003', 'b1000000-0000-4000-8000-000000000001', 'P3', 12000, 10000, 'Snacks', true),
  ('b1000000-0000-4000-8000-000000003004', 'b1000000-0000-4000-8000-000000000001', 'P4 unlisted', 2000, 1800, 'Snacks', false);

insert into inventory (store_id, product_id, qty_on_hand, qty_reserved) values
  ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000003001', 10, 0),
  ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000003002', 1, 0),
  ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000003003', 5, 0),
  ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000003004', 5, 0);

insert into promos (id, code, type, value, max_uses, uses_count, per_user_limit, valid_from, valid_to) values
  ('b1000000-0000-4000-8000-000000004001', 'P4FLAT',   'flat',          2000, 5,    0, 1, now() - interval '1 day', now() + interval '5 days'),
  ('b1000000-0000-4000-8000-000000004002', 'P4PCT',    'percent',       10,   null, 0, 5, now() - interval '1 day', now() + interval '5 days'),
  ('b1000000-0000-4000-8000-000000004003', 'P4EXP',    'flat',          1000, null, 0, 5, now() - interval '10 days', now() - interval '1 day'),
  ('b1000000-0000-4000-8000-000000004004', 'P4MAX',    'flat',          500,  1,    1, 5, now() - interval '1 day', now() + interval '5 days'),
  ('b1000000-0000-4000-8000-000000004005', 'P4WALLET', 'wallet_credit', 5000, null, 0, 5, now() - interval '1 day', now() + interval '5 days');

-- ============================================================
-- A. Schema: orders.discount + rewritten money-math CHECK (D33)
-- ============================================================
select has_column('orders'::name, 'discount'::name, 'orders.discount column exists (D33)');
select col_type_is('orders'::name, 'discount'::name, 'integer'::text, 'orders.discount is integer paise');
select throws_ok(
  $$ insert into orders (customer_id, store_id, address_id, subtotal, discount, delivery_fee, wallet_applied, payable, idempotency_key)
     values ('b1000000-0000-4000-8000-000000001001','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000002001',
             10000, 2000, 1000, 0, 11000, gen_random_uuid()) $$,
  '23514',
  null,
  'payable_matches_math rejects payable that ignores discount (should be 9000, not 11000)'
);
select lives_ok(
  $$ insert into orders (customer_id, store_id, address_id, subtotal, discount, delivery_fee, wallet_applied, payable, idempotency_key)
     values ('b1000000-0000-4000-8000-000000001001','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000002001',
             10000, 2000, 1000, 0, 9000, gen_random_uuid()) $$,
  'payable_matches_math accepts payable = subtotal - discount + delivery_fee - wallet_applied'
);

-- ============================================================
-- B. Happy path — C1 orders 2x P1 (subtotal 10000, fee 1000, payable 11000)
-- ============================================================
select is(
  create_order_phase_a(
    'b1000000-0000-4000-8000-000000001001', 'b1000000-0000-4000-8000-00000000a001',
    'b1000000-0000-4000-8000-000000002001',
    '[{"productId":"b1000000-0000-4000-8000-000000003001","qty":2}]'::jsonb, null, false
  ) ->> 'status',
  'created',
  'happy path: new order is created'
);
select is((select payable::text from orders where idempotency_key = 'b1000000-0000-4000-8000-00000000a001'),
  '11000', 'happy path: payable = 2*5000 + 1000 delivery');
select is((select subtotal::text from orders where idempotency_key = 'b1000000-0000-4000-8000-00000000a001'),
  '10000', 'happy path: subtotal is gross goods total');
select is(
  (select count(*)::int from payments p join orders o on o.id = p.order_id where o.idempotency_key = 'b1000000-0000-4000-8000-00000000a001'),
  1, 'happy path: exactly one payments row (D29)');
select is(
  (select p.status::text || '/' || p.gateway || '/' || p.amount::text
   from payments p join orders o on o.id = p.order_id where o.idempotency_key = 'b1000000-0000-4000-8000-00000000a001'),
  'pending/razorpay/11000', 'happy path: payment is pending, razorpay gateway, amount = payable');
select is(
  (select i.qty_reserved from inventory i where i.product_id = 'b1000000-0000-4000-8000-000000003001'),
  2, 'happy path: inventory qty_reserved incremented by ordered qty (D11)');
select ok(
  (select reservation_expires_at between now() + interval '14 minutes' and now() + interval '16 minutes'
   from orders where idempotency_key = 'b1000000-0000-4000-8000-00000000a001'),
  'happy path: reservation_expires_at is ~15 minutes out (D27)');
select is(
  (select count(*)::int from audit_logs a join orders o on o.id = a.entity_id
   where o.idempotency_key = 'b1000000-0000-4000-8000-00000000a001' and a.action = 'order.created'),
  1, 'happy path: one order.created audit row (D32)');

-- ============================================================
-- C. Idempotency — guarantee #1 (single-transaction version)
-- ============================================================
select is(
  create_order_phase_a(
    'b1000000-0000-4000-8000-000000001001', 'b1000000-0000-4000-8000-00000000a001',
    'b1000000-0000-4000-8000-000000002001',
    '[{"productId":"b1000000-0000-4000-8000-000000003001","qty":2}]'::jsonb, null, false
  ) ->> 'alreadyExisted',
  'true', 'idempotency: replay with the same key returns the existing order');
select is(
  (select count(*)::int from orders where idempotency_key = 'b1000000-0000-4000-8000-00000000a001'),
  1, 'idempotency: still exactly one order for that key (D23)');
select is(
  (select qty_reserved from inventory where product_id = 'b1000000-0000-4000-8000-000000003001'),
  2, 'idempotency: replay did not reserve stock a second time');

-- ============================================================
-- D. Overselling — guarantee #3. P2 has qty_on_hand=1.
-- ============================================================
select is(
  create_order_phase_a(
    'b1000000-0000-4000-8000-000000001001', 'b1000000-0000-4000-8000-00000000a002',
    'b1000000-0000-4000-8000-000000002001',
    '[{"productId":"b1000000-0000-4000-8000-000000003002","qty":1}]'::jsonb, null, false
  ) ->> 'status',
  'created', 'exact stock: ordering the last unit succeeds');
select is((select qty_reserved from inventory where product_id = 'b1000000-0000-4000-8000-000000003002'),
  1, 'exact stock: qty_reserved now equals qty_on_hand');
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001002', 'b1000000-0000-4000-8000-00000000a003',
       'b1000000-0000-4000-8000-000000002002',
       '[{"productId":"b1000000-0000-4000-8000-000000003002","qty":1}]'::jsonb, null, false) $$,
  '%INSUFFICIENT_STOCK%', 'overselling: a second order for the last unit is rejected');
select is((select qty_reserved from inventory where product_id = 'b1000000-0000-4000-8000-000000003002'),
  1, 'overselling: the rejected order left no partial reservation behind');
select is(
  (select count(*)::int from orders where idempotency_key = 'b1000000-0000-4000-8000-00000000a003'),
  0, 'overselling: no order row was created for the rejected attempt');

-- ============================================================
-- E. Validation: item / address / zone / store
-- ============================================================
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001001', gen_random_uuid(),
       'b1000000-0000-4000-8000-000000002001',
       '[{"productId":"b1000000-0000-4000-8000-000000003004","qty":1}]'::jsonb, null, false) $$,
  '%ITEM_UNAVAILABLE%', 'unlisted product is rejected');
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001002', gen_random_uuid(),
       'b1000000-0000-4000-8000-000000002001',
       '[{"productId":"b1000000-0000-4000-8000-000000003001","qty":1}]'::jsonb, null, false) $$,
  '%INVALID_ADDRESS%', 'address belonging to another customer is rejected (customer cannot order to someone else''s address)');
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001001', gen_random_uuid(),
       'b1000000-0000-4000-8000-000000002003',
       '[{"productId":"b1000000-0000-4000-8000-000000003001","qty":1}]'::jsonb, null, false) $$,
  '%SERVICE_UNAVAILABLE%', 'address in a non-serviceable zone is rejected');
select lives_ok(
  $$ update stores set is_open = false where id = 'b1000000-0000-4000-8000-000000000001' $$,
  'fixture: close the store');
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001001', gen_random_uuid(),
       'b1000000-0000-4000-8000-000000002001',
       '[{"productId":"b1000000-0000-4000-8000-000000003001","qty":1}]'::jsonb, null, false) $$,
  '%STORE_CLOSED%', 'closed store is rejected');
select lives_ok(
  $$ update stores set is_open = true where id = 'b1000000-0000-4000-8000-000000000001' $$,
  'fixture: reopen the store');

-- ============================================================
-- F. Promo (D26 / D33). C2 orders 1x P3 (subtotal 10000, fee 1000).
-- ============================================================
select is(
  (create_order_phase_a(
    'b1000000-0000-4000-8000-000000001002', 'b1000000-0000-4000-8000-00000000b001',
    'b1000000-0000-4000-8000-000000002002',
    '[{"productId":"b1000000-0000-4000-8000-000000003003","qty":1}]'::jsonb, 'P4FLAT', false
  ) ->> 'discount'),
  '2000', 'promo flat: discount = min(value, subtotal)');
select is(
  (create_order_phase_a(
    'b1000000-0000-4000-8000-000000001002', 'b1000000-0000-4000-8000-00000000b002',
    'b1000000-0000-4000-8000-000000002002',
    '[{"productId":"b1000000-0000-4000-8000-000000003003","qty":1}]'::jsonb, 'P4PCT', false
  ) ->> 'discount'),
  '1000', 'promo percent: discount = floor(subtotal * value / 100)');
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001002', gen_random_uuid(),
       'b1000000-0000-4000-8000-000000002002',
       '[{"productId":"b1000000-0000-4000-8000-000000003003","qty":1}]'::jsonb, 'P4EXP', false) $$,
  '%INVALID_PROMO%', 'promo expired -> INVALID_PROMO');
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001002', gen_random_uuid(),
       'b1000000-0000-4000-8000-000000002002',
       '[{"productId":"b1000000-0000-4000-8000-000000003003","qty":1}]'::jsonb, 'P4MAX', false) $$,
  '%PROMO_LIMIT_REACHED%', 'promo at max_uses -> PROMO_LIMIT_REACHED');
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001002', gen_random_uuid(),
       'b1000000-0000-4000-8000-000000002002',
       '[{"productId":"b1000000-0000-4000-8000-000000003003","qty":1}]'::jsonb, 'P4FLAT', false) $$,
  '%PROMO_LIMIT_REACHED%', 'promo per_user_limit=1: same customer''s second redemption -> PROMO_LIMIT_REACHED');
select is(
  (select uses_count from promos where code = 'P4FLAT'),
  (select count(*)::int from promo_redemptions where promo_id = 'b1000000-0000-4000-8000-000000004001'),
  'promo: uses_count stays equal to the promo_redemptions row count (cached-aggregate + ledger, D26)');

-- ============================================================
-- G. Wallet (D25 / D33)
-- ============================================================
update profiles set wallet_balance = 100000 where id = 'b1000000-0000-4000-8000-000000001001';
insert into wallet_ledger (customer_id, delta, reason) values ('b1000000-0000-4000-8000-000000001001', 100000, 'manual_adjustment');

-- partial: order subtotal 10000 + fee 1000 = 11000, balance 100000 -> wallet covers all, payable 0
select is(
  create_order_phase_a(
    'b1000000-0000-4000-8000-000000001001', 'b1000000-0000-4000-8000-00000000c001',
    'b1000000-0000-4000-8000-000000002001',
    '[{"productId":"b1000000-0000-4000-8000-000000003003","qty":1}]'::jsonb, null, true
  ) ->> 'status',
  'confirmed', 'wallet fully covers -> order goes straight to confirmed (payable 0, no gateway)');
select is(
  (select p.status::text from payments p join orders o on o.id = p.order_id where o.idempotency_key = 'b1000000-0000-4000-8000-00000000c001'),
  'captured', 'wallet-covered order: payment row is captured');
select is(
  (select wallet_balance from profiles where id = 'b1000000-0000-4000-8000-000000001001'),
  (select coalesce(sum(delta),0)::int from wallet_ledger where customer_id = 'b1000000-0000-4000-8000-000000001001'),
  'wallet: profiles.wallet_balance stays equal to SUM(wallet_ledger.delta) (D10)');
select throws_like(
  $$ select create_order_phase_a(
       'b1000000-0000-4000-8000-000000001002', gen_random_uuid(),
       'b1000000-0000-4000-8000-000000002002',
       '[{"productId":"b1000000-0000-4000-8000-000000003001","qty":1}]'::jsonb, null, true) $$,
  '%INSUFFICIENT_BALANCE%', 'useWallet with a zero balance -> INSUFFICIENT_BALANCE');
select ok(
  (select wallet_balance from profiles where id = 'b1000000-0000-4000-8000-000000001001') >= 0
  and (select bool_and(wallet_balance >= 0) from profiles),
  'wallet: no wallet_balance is ever negative');

-- wallet_credit promo: credits the wallet, does NOT discount this order
update profiles set wallet_balance = 50000 where id = 'b1000000-0000-4000-8000-000000001002';
insert into wallet_ledger (customer_id, delta, reason) values ('b1000000-0000-4000-8000-000000001002', 50000, 'manual_adjustment');
select is(
  (create_order_phase_a(
    'b1000000-0000-4000-8000-000000001002', 'b1000000-0000-4000-8000-00000000c002',
    'b1000000-0000-4000-8000-000000002002',
    '[{"productId":"b1000000-0000-4000-8000-000000003001","qty":1}]'::jsonb, 'P4WALLET', false
  ) ->> 'discount'),
  '0', 'promo wallet_credit: no order discount');
select is(
  (select count(*)::int from wallet_ledger wl join orders o on o.id = wl.order_id
   where o.idempotency_key = 'b1000000-0000-4000-8000-00000000c002' and wl.reason = 'promo_credit' and wl.delta = 5000),
  1, 'promo wallet_credit: a +value promo_credit wallet_ledger row is written for the order');

-- ============================================================
-- H. Reservation expiry sweep (D27 / PHASE_1_1_CORRECTIONS.md §4.4)
-- ============================================================
-- Drop C1's balance to 5000, keeping the ledger consistent, so the next
-- order is only PARTIALLY wallet-funded: payable > 0, status stays
-- 'created', and there is a real wallet debit for the sweep to reverse.
insert into wallet_ledger (customer_id, delta, reason)
select 'b1000000-0000-4000-8000-000000001001',
       5000 - coalesce(sum(delta), 0)::int,
       'manual_adjustment'
from wallet_ledger where customer_id = 'b1000000-0000-4000-8000-000000001001';
update profiles set wallet_balance = 5000 where id = 'b1000000-0000-4000-8000-000000001001';

-- 3x P1 = 15000 + 1000 fee = 16000; wallet covers 5000; payable 11000; status 'created'
select create_order_phase_a(
  'b1000000-0000-4000-8000-000000001001', 'b1000000-0000-4000-8000-00000000d001',
  'b1000000-0000-4000-8000-000000002001',
  '[{"productId":"b1000000-0000-4000-8000-000000003001","qty":3}]'::jsonb, null, true
);
-- capture pre-sweep state
create temp table _pre as
  select (select qty_reserved from inventory where product_id = 'b1000000-0000-4000-8000-000000003001') as resv,
         (select wallet_balance from profiles where id = 'b1000000-0000-4000-8000-000000001001') as bal,
         (select wallet_applied from orders where idempotency_key = 'b1000000-0000-4000-8000-00000000d001') as applied;
update orders set reservation_expires_at = now() - interval '1 minute'
  where idempotency_key = 'b1000000-0000-4000-8000-00000000d001';

select ok(expire_stale_reservations() >= 1, 'sweep: at least one stale reservation swept');
select is(
  (select status::text from orders where idempotency_key = 'b1000000-0000-4000-8000-00000000d001'),
  'payment_failed', 'sweep: expired order -> payment_failed (transition #2b)');
select is(
  (select p.status::text from payments p join orders o on o.id = p.order_id
   where o.idempotency_key = 'b1000000-0000-4000-8000-00000000d001'),
  'failed', 'sweep: expired order''s payment -> failed');
select is(
  (select qty_reserved from inventory where product_id = 'b1000000-0000-4000-8000-000000003001'),
  (select resv - 3 from _pre),
  'sweep: the order''s 3 reserved units are released back to inventory');
select is(
  (select wallet_balance from profiles where id = 'b1000000-0000-4000-8000-000000001001'),
  (select bal + applied from _pre),
  'sweep: the wallet debit is reversed (balance restored)');
select is(
  (select count(*)::int from wallet_ledger wl join orders o on o.id = wl.order_id
   where o.idempotency_key = 'b1000000-0000-4000-8000-00000000d001' and wl.reason = 'reservation_reversal'),
  1, 'sweep: wallet reversal is logged with reason=reservation_reversal, NOT refund (D27)');

select * from finish();
rollback;
