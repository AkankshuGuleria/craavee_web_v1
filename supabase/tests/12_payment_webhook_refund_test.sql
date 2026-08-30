-- ============================================================
-- 12 — payment_webhook + refund (Phase 5)
--
-- Unit tests of the migration 0005 functions (process_payment_webhook,
-- process_refund), exercised directly over psql (RLS bypassed on purpose
-- — these test the FUNCTION logic; the Edge Function signature-
-- verification / auth / envelope layer is covered by the integration
-- suite in apps/customer-runner/__tests__/payment.integration.test.ts).
--
-- Canonical: API_CONTRACTS.md §3 (payment_webhook, refund),
-- PHASE_1_1_CORRECTIONS.md §8/§9/§10, ORDER_STATE_MACHINE.md §2/§2.1,
-- DECISION_LOG.md D29/D30/D36/D38, TEST_STRATEGY.md §2 (#2 no duplicate
-- captures) and §2.1 (#7 late webhook, #8 duplicate refund, #9 consistency).
--
-- Whole file rolls back at the end (pgTAP convention). The deferred
-- check_payment_order_consistency trigger is exhaustively covered in
-- 09_payment_order_consistency_test.sql; a few resting pairs here are
-- force-checked with `set constraints all immediate`.
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(50);

-- ---- fixtures ------------------------------------------------
insert into stores (id, name, is_open, max_queue_depth) values
  ('c5000000-0000-4000-8000-000000000001', 'Phase5 Store', true, 9999);
insert into zones (id, store_id, name, delivery_fee, is_serviceable) values
  ('c5000000-0000-4000-8000-000000000101', 'c5000000-0000-4000-8000-000000000001', 'P5 Zone', 1000, true);
insert into auth.users (id, phone) values
  ('c5000000-0000-4000-8000-000000001001', '9995550001'),
  ('c5000000-0000-4000-8000-000000001002', '9995550002');
insert into addresses (id, customer_id, zone_id, block, room) values
  ('c5000000-0000-4000-8000-000000002001', 'c5000000-0000-4000-8000-000000001001', 'c5000000-0000-4000-8000-000000000101', 'B', '1'),
  ('c5000000-0000-4000-8000-000000002002', 'c5000000-0000-4000-8000-000000001002', 'c5000000-0000-4000-8000-000000000101', 'B', '2');
insert into products (id, store_id, name, mrp, sale_price, category, is_listed) values
  ('c5000000-0000-4000-8000-000000000201', 'c5000000-0000-4000-8000-000000000001', 'P5-A', 6000, 5000, 'X', true);
insert into inventory (store_id, product_id, qty_on_hand, qty_reserved) values
  ('c5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000201', 100, 0);

-- profiles rows are auto-created by handle_new_user; give them a balance.
update profiles set wallet_balance = 0 where id in
  ('c5000000-0000-4000-8000-000000001001', 'c5000000-0000-4000-8000-000000001002');

-- helper: a fresh 'created' order with one reserved line + a pending
-- razorpay payment carrying a given gateway_order_ref.
create or replace function _mk_pending_order(
  p_oid uuid, p_customer uuid, p_addr uuid, p_ref text,
  p_amount integer, p_wallet integer default 0
) returns void language plpgsql as $$
begin
  update inventory set qty_reserved = qty_reserved + 1
    where store_id = 'c5000000-0000-4000-8000-000000000001'
      and product_id = 'c5000000-0000-4000-8000-000000000201';
  insert into orders (id, customer_id, store_id, address_id, status,
    subtotal, discount, delivery_fee, wallet_applied, payable, payment_status, idempotency_key)
  values (p_oid, p_customer, 'c5000000-0000-4000-8000-000000000001', p_addr, 'created',
    5000, 0, 1000, p_wallet, p_amount, 'pending', gen_random_uuid());
  insert into order_items (order_id, product_id, qty, unit_price)
  values (p_oid, 'c5000000-0000-4000-8000-000000000201', 1, 5000);
  insert into payments (order_id, gateway, gateway_order_ref, amount, status)
  values (p_oid, 'razorpay', p_ref, p_amount, 'pending');
  if p_wallet > 0 then
    update profiles set wallet_balance = wallet_balance + p_wallet where id = p_customer;
    insert into wallet_ledger (customer_id, delta, reason, order_id)
    values (p_customer, -p_wallet, 'checkout_redemption', p_oid);
  end if;
end;
$$;

-- ============================================================
-- A. process_payment_webhook — ordinary capture
-- ============================================================
select _mk_pending_order('c5000000-0000-4000-8000-00000000a001',
  'c5000000-0000-4000-8000-000000001001', 'c5000000-0000-4000-8000-000000002001',
  'order_rzp_A', 6000);

select is(
  (select process_payment_webhook('razorpay', 'evt_A1', 'order_rzp_A', 'pay_A1', 'captured', 6000, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'confirmed', 'capture on a created/pending order -> action confirmed');

select is((select status::text from orders where id = 'c5000000-0000-4000-8000-00000000a001'),
  'confirmed', 'ordinary capture: orders.status -> confirmed');
select is((select status::text from payments where order_id = 'c5000000-0000-4000-8000-00000000a001'),
  'captured', 'ordinary capture: payments.status -> captured');
select is((select gateway_payment_ref from payments where order_id = 'c5000000-0000-4000-8000-00000000a001'),
  'pay_A1', 'ordinary capture: gateway_payment_ref persisted');
select is((select raw_event->>'redacted' from payments where order_id = 'c5000000-0000-4000-8000-00000000a001'),
  'true', 'ordinary capture: redacted raw_event stored');
select isnt((select processed_at from webhook_events where gateway='razorpay' and gateway_event_id='evt_A1'),
  null, 'ordinary capture: webhook_events.processed_at set');

-- resting pair is valid under an immediate consistency check
select lives_ok($$ set constraints all immediate; set constraints all deferred $$,
  'confirmed + captured is a valid resting pair (D30)');

-- ============================================================
-- B. duplicate webhook — dossier guarantee #2
-- ============================================================
select is(
  (select process_payment_webhook('razorpay', 'evt_A1', 'order_rzp_A', 'pay_A1', 'captured', 6000, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'duplicate', 'identical event id -> action duplicate (no-op)');
select is((select count(*)::int from webhook_events where gateway='razorpay' and gateway_event_id='evt_A1'),
  1, 'duplicate webhook: exactly one webhook_events row');
select is((select refunded_amount from payments where order_id = 'c5000000-0000-4000-8000-00000000a001'),
  0, 'duplicate webhook: no second payment effect');

-- a DIFFERENT event id for an already-captured payment (e.g. order.paid
-- after payment.captured) -> a genuine no-op, not an error
select is(
  (select process_payment_webhook('razorpay', 'evt_A2', 'order_rzp_A', 'pay_A1', 'captured', 6000, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'noop', 'a distinct capture event for an already-captured payment -> noop');
select is((select status::text from payments where order_id = 'c5000000-0000-4000-8000-00000000a001'),
  'captured', 'noop capture event: payment still captured, unchanged');

-- ============================================================
-- C. failure webhook on a created/pending order (transition #2a)
-- ============================================================
select _mk_pending_order('c5000000-0000-4000-8000-00000000b001',
  'c5000000-0000-4000-8000-000000001001', 'c5000000-0000-4000-8000-000000002001',
  'order_rzp_B', 4000, 2000);

select is(
  (select process_payment_webhook('razorpay', 'evt_B1', 'order_rzp_B', null, 'failed', 0, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'payment_failed', 'failure event on created/pending -> action payment_failed');
select is((select status::text from orders where id = 'c5000000-0000-4000-8000-00000000b001'),
  'payment_failed', 'failure webhook: orders.status -> payment_failed');
select is((select status::text from payments where order_id = 'c5000000-0000-4000-8000-00000000b001'),
  'failed', 'failure webhook: payments.status -> failed');
select is(
  (select qty_reserved from inventory
    where store_id='c5000000-0000-4000-8000-000000000001' and product_id='c5000000-0000-4000-8000-000000000201'),
  1, 'failure webhook: the B order line reservation is released (only the A line remains)');
select is(
  (select delta from wallet_ledger
    where order_id='c5000000-0000-4000-8000-00000000b001' and reason='reservation_reversal'),
  2000, 'failure webhook: wallet debit reversed as reservation_reversal');

-- a failure event for an order that already confirmed -> no-op
select is(
  (select process_payment_webhook('razorpay', 'evt_A3', 'order_rzp_A', null, 'failed', 0, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'noop', 'failure event for an already-confirmed order -> noop');
select is((select status::text from orders where id = 'c5000000-0000-4000-8000-00000000a001'),
  'confirmed', 'stray failure event does not disturb a confirmed order');

-- ============================================================
-- D. amount / currency verification (Phase 5 prompt §10)
-- ============================================================
select _mk_pending_order('c5000000-0000-4000-8000-00000000c001',
  'c5000000-0000-4000-8000-000000001002', 'c5000000-0000-4000-8000-000000002002',
  'order_rzp_C', 6000);

select is(
  (select process_payment_webhook('razorpay', 'evt_C1', 'order_rzp_C', 'pay_C1', 'captured', 5999, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'amount_mismatch', 'captured amount != payments.amount -> action amount_mismatch');
select is((select status::text from payments where order_id = 'c5000000-0000-4000-8000-00000000c001'),
  'pending', 'amount mismatch: payment is NOT marked captured');
select is(
  (select count(*)::int from audit_logs
    where entity_id='c5000000-0000-4000-8000-00000000c001' and action='payment.amount_mismatch'),
  1, 'amount mismatch: an operational audit row is written');

select is(
  (select process_payment_webhook('razorpay', 'evt_C2', 'order_rzp_C', 'pay_C1', 'captured', 6000, 'USD',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'currency_mismatch', 'non-INR currency -> action currency_mismatch');
select is((select status::text from payments where order_id = 'c5000000-0000-4000-8000-00000000c001'),
  'pending', 'currency mismatch: payment is NOT marked captured');

-- ============================================================
-- E. unknown gateway order reference
-- ============================================================
select is(
  (select process_payment_webhook('razorpay', 'evt_X1', 'order_rzp_DOES_NOT_EXIST', 'pay_X', 'captured', 100, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'unknown_order', 'a webhook for an unknown gateway order ref -> action unknown_order (still acked)');

-- ============================================================
-- F. late capture after reservation expiry (D36, TEST_STRATEGY §2.1#7)
-- ============================================================
select _mk_pending_order('c5000000-0000-4000-8000-00000000d001',
  'c5000000-0000-4000-8000-000000001001', 'c5000000-0000-4000-8000-000000002001',
  'order_rzp_D', 6000);
-- force the sweep path: expire + run it
update orders set reservation_expires_at = now() - interval '1 minute'
  where id = 'c5000000-0000-4000-8000-00000000d001';
select expire_stale_reservations();

select is((select status::text from orders where id = 'c5000000-0000-4000-8000-00000000d001'),
  'payment_failed', 'pre-condition: the sweep moved the order to payment_failed');

select is(
  (select process_payment_webhook('razorpay', 'evt_D1', 'order_rzp_D', 'pay_D1', 'captured', 6000, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'late_capture_reconciled', 'late capture for an expired order -> action late_capture_reconciled');
select is((select status::text from orders where id = 'c5000000-0000-4000-8000-00000000d001'),
  'payment_failed', 'late capture: orders.status stays payment_failed (never resurrected)');
select is((select status::text from payments where order_id = 'c5000000-0000-4000-8000-00000000d001'),
  'failed', 'late capture: payments.status stays terminal failed (D36 — enforce_payment_transition intact)');
select is((select refunded_amount from payments where order_id = 'c5000000-0000-4000-8000-00000000d001'),
  6000, 'late capture: payments.refunded_amount == captured amount (D29 aggregate stays consistent)');
select is(
  (select count(*)::int from refunds r join payments p on p.id = r.payment_id
    where p.order_id = 'c5000000-0000-4000-8000-00000000d001' and r.reason = 'late_capture_reconciliation'),
  1, 'late capture: exactly one late_capture_reconciliation refund row');
select is(
  (select delta from wallet_ledger
    where order_id='c5000000-0000-4000-8000-00000000d001' and reason='refund'),
  6000, 'late capture: wallet credited for the full captured amount');

-- redelivered late-capture event (distinct id) must NOT refund twice
select is(
  (select process_payment_webhook('razorpay', 'evt_D2', 'order_rzp_D', 'pay_D1', 'captured', 6000, 'INR',
    '{"redacted":true}'::jsonb) ->> 'action'),
  'noop', 'redelivered late-capture event -> noop (already reconciled)');
select is(
  (select count(*)::int from refunds r join payments p on p.id = r.payment_id
    where p.order_id = 'c5000000-0000-4000-8000-00000000d001'),
  1, 'redelivered late-capture event: still exactly one refund row');

-- ============================================================
-- G. process_refund — partial, then full-with-cancel
-- ============================================================
select _mk_pending_order('c5000000-0000-4000-8000-00000000e001',
  'c5000000-0000-4000-8000-000000001002', 'c5000000-0000-4000-8000-000000002002',
  'order_rzp_E', 6000);
select process_payment_webhook('razorpay', 'evt_E1', 'order_rzp_E', 'pay_E1', 'captured', 6000, 'INR', '{"r":1}'::jsonb);

select is(
  (select process_refund('c5000000-0000-4000-8000-00000000e001', gen_random_uuid(), 2000, 'partial goodwill',
    'c5000000-0000-4000-8000-000000001002', 'wallet') ->> 'paymentStatus'),
  'partially_refunded', 'partial refund -> paymentStatus partially_refunded');
select is((select refunded_amount from payments where order_id = 'c5000000-0000-4000-8000-00000000e001'),
  2000, 'partial refund: refunded_amount == the partial amount');
select is((select status::text from orders where id = 'c5000000-0000-4000-8000-00000000e001'),
  'confirmed', 'partial refund: the order stays confirmed');
select is(
  (select sum(delta)::int from wallet_ledger
    where order_id='c5000000-0000-4000-8000-00000000e001' and reason='refund'),
  2000, 'partial refund: wallet credited for the partial amount');

-- now refund the remaining 4000 -> full -> order cancelled
select is(
  (select process_refund('c5000000-0000-4000-8000-00000000e001', gen_random_uuid(), null, 'customer changed mind',
    'c5000000-0000-4000-8000-000000001002', 'wallet') ->> 'orderCancelled'),
  'true', 'topping the refund up to the full captured amount cancels the order');
select is((select status::text from payments where order_id = 'c5000000-0000-4000-8000-00000000e001'),
  'refunded', 'full refund: payments.status -> refunded');
select is((select status::text from orders where id = 'c5000000-0000-4000-8000-00000000e001'),
  'cancelled', 'full refund of a live order: orders.status -> cancelled (D38)');
select lives_ok($$ set constraints all immediate; set constraints all deferred $$,
  'cancelled + refunded is a valid resting pair after a full refund');

-- ============================================================
-- H. refund guardrails
-- ============================================================
-- over-refund
select _mk_pending_order('c5000000-0000-4000-8000-00000000f001',
  'c5000000-0000-4000-8000-000000001001', 'c5000000-0000-4000-8000-000000002001',
  'order_rzp_F', 6000);
select process_payment_webhook('razorpay', 'evt_F1', 'order_rzp_F', 'pay_F1', 'captured', 6000, 'INR', '{"r":1}'::jsonb);
select throws_ok(
  $$ select process_refund('c5000000-0000-4000-8000-00000000f001', gen_random_uuid(), 6001, 'too much',
       'c5000000-0000-4000-8000-000000001001', 'wallet') $$,
  'P0001', null, 'a refund exceeding the captured amount -> REFUND_EXCEEDS_CAPTURED');

-- refund on a never-captured payment
select _mk_pending_order('c5000000-0000-4000-8000-00000000f002',
  'c5000000-0000-4000-8000-000000001001', 'c5000000-0000-4000-8000-000000002001',
  'order_rzp_F2', 6000);
select throws_ok(
  $$ select process_refund('c5000000-0000-4000-8000-00000000f002', gen_random_uuid(), 100, 'nope',
       'c5000000-0000-4000-8000-000000001001', 'wallet') $$,
  'P0001', null, 'a refund against a pending (never-captured) payment -> PAYMENT_FAILED');

-- refund after a full refund
select throws_ok(
  $$ select process_refund('c5000000-0000-4000-8000-00000000e001', gen_random_uuid(), 100, 'again',
       'c5000000-0000-4000-8000-000000001002', 'wallet') $$,
  'P0001', null, 'a refund after the payment is fully refunded -> REFUND_EXCEEDS_CAPTURED');

-- ============================================================
-- I. refund idempotency (D29, TEST_STRATEGY §2.1#8)
-- ============================================================
select _mk_pending_order('c5000000-0000-4000-8000-00000000f003',
  'c5000000-0000-4000-8000-000000001001', 'c5000000-0000-4000-8000-000000002001',
  'order_rzp_F3', 6000);
select process_payment_webhook('razorpay', 'evt_F3', 'order_rzp_F3', 'pay_F3', 'captured', 6000, 'INR', '{"r":1}'::jsonb);

create temp table _refund_key (k uuid);
insert into _refund_key values (gen_random_uuid());

select is(
  (select (process_refund('c5000000-0000-4000-8000-00000000f003', (select k from _refund_key), 1500, 'r',
    'c5000000-0000-4000-8000-000000001001', 'wallet') ->> 'alreadyExisted')),
  'false', 'first refund with a fresh key -> alreadyExisted false');
select is(
  (select (process_refund('c5000000-0000-4000-8000-00000000f003', (select k from _refund_key), 1500, 'r',
    'c5000000-0000-4000-8000-000000001001', 'wallet') ->> 'alreadyExisted')),
  'true', 'replaying the same refund key -> alreadyExisted true (the original refund)');
select is((select refunded_amount from payments where order_id = 'c5000000-0000-4000-8000-00000000f003'),
  1500, 'refund idempotency: refunded_amount incremented exactly once');
select is((select count(*)::int from refunds where idempotency_key = (select k from _refund_key)),
  1, 'refund idempotency: exactly one refunds row for the key');
select throws_ok(
  $$ select process_refund('c5000000-0000-4000-8000-00000000f003', (select k from _refund_key), 9999, 'r',
       'c5000000-0000-4000-8000-000000001001', 'wallet') $$,
  'P0001', null, 'the same refund key with a different amount -> ORDER_ALREADY_EXISTS conflict');

drop function _mk_pending_order(uuid, uuid, uuid, text, integer, integer);
select * from finish();
rollback;
