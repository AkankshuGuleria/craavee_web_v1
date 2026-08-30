-- ============================================================
-- 03 — Order & payment state machine (dossier correctness guarantee #6)
-- Phase 2 prompt §24: enforce_order_transition must reject illegal
-- transitions and enforce the actor graph independently of the client;
-- §24 also requires the D30 order/payment consistency mechanism.
-- Canonical: ORDER_STATE_MACHINE.md §2 / §2.1 / §3.
--
-- Runs in a superuser context (RLS bypassed) on purpose: these are unit
-- tests of the TRIGGER logic. request.jwt.claims is toggled per-test to
-- exercise the actor-role branch, which only runs when a JWT context
-- exists (Edge Functions run as service_role with auth.jwt() = null and
-- are trusted to self-authorize — RBAC_MATRIX.md §4).
-- ============================================================
begin;
create extension if not exists pgtap;
select plan(24);

-- ---- fixtures ----
insert into auth.users (id, phone) values ('c0000000-0000-0000-0000-000000000001', '9890000001');
insert into stores (id, name) values ('50000000-0000-0000-0000-000000000001', 'Store A');
insert into zones (id, store_id, name, delivery_fee)
  values ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Zone A', 1000);
insert into addresses (id, customer_id, zone_id, block, room)
  values ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', 'B', '1');
insert into auth.users (id, phone) values
  ('d0000000-0000-0000-0000-0000000000f1', '9990000301'),
  ('d0000000-0000-0000-0000-0000000000f2', '9990000302');
insert into runners (id, profile_id, store_id) values
  ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000f1', '50000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000f2', '50000000-0000-0000-0000-000000000001');

-- helper: make a fresh order in a given status with a matching payment
create or replace function _mk_order(p_id uuid, p_order_status order_status, p_pay_status payment_status)
returns void language plpgsql as $$
begin
  insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key)
    values (p_id, 'c0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
            'a0000000-0000-0000-0000-000000000001', p_order_status, 4000, 1000, 5000, gen_random_uuid());
  insert into payments (order_id, amount, status) values (p_id, 5000, p_pay_status);
end $$;

-- ============================================================
-- Legal transitions (no JWT -> actor check skipped)
-- ============================================================
select _mk_order('f0000000-0000-0000-0000-000000000001', 'created', 'pending');
select lives_ok(
  $$ update orders set status = 'confirmed' where id = 'f0000000-0000-0000-0000-000000000001' $$,
  'legal: created -> confirmed (system) is allowed');
select isnt(
  (select confirmed_at from orders where id = 'f0000000-0000-0000-0000-000000000001'),
  null, 'transition trigger stamps confirmed_at server-side (ORDER_STATE_MACHINE.md §4.4)');
-- keep this order's (order,payment) pair consistent so a later
-- SET CONSTRAINTS ALL IMMEDIATE (D30 tests) doesn't trip over it
update payments set status = 'captured' where order_id = 'f0000000-0000-0000-0000-000000000001';

select _mk_order('f0000000-0000-0000-0000-000000000002', 'created', 'pending');
select lives_ok(
  $$ update orders set status = 'payment_failed' where id = 'f0000000-0000-0000-0000-000000000002' $$,
  'legal: created -> payment_failed (system / expiry sweep) is allowed');
update payments set status = 'failed' where order_id = 'f0000000-0000-0000-0000-000000000002';

select _mk_order('f0000000-0000-0000-0000-000000000003', 'confirmed', 'captured');
select lives_ok(
  $$ update orders set status = 'packed' where id = 'f0000000-0000-0000-0000-000000000003' $$,
  'legal: confirmed -> packed is allowed');
select isnt(
  (select packed_at from orders where id = 'f0000000-0000-0000-0000-000000000003'),
  null, 'transition trigger stamps packed_at');

-- ============================================================
-- Illegal (from,to) pairs -> INVALID_ORDER_TRANSITION (§3)
-- ============================================================
select _mk_order('f0000000-0000-0000-0000-00000000000a', 'created', 'pending');
select throws_like(
  $$ update orders set status = 'delivered' where id = 'f0000000-0000-0000-0000-00000000000a' $$,
  '%INVALID_ORDER_TRANSITION%', 'illegal: created -> delivered rejected (skips the whole chain)');
select throws_like(
  $$ update orders set status = 'picked_up' where id = 'f0000000-0000-0000-0000-00000000000a' $$,
  '%INVALID_ORDER_TRANSITION%', 'illegal: created -> picked_up rejected');

select _mk_order('f0000000-0000-0000-0000-00000000000b', 'packed', 'captured');
select throws_like(
  $$ update orders set status = 'picked_up' where id = 'f0000000-0000-0000-0000-00000000000b' $$,
  '%INVALID_ORDER_TRANSITION%', 'illegal: packed -> picked_up rejected (claim step cannot be skipped)');

select _mk_order('f0000000-0000-0000-0000-00000000000c', 'delivered', 'captured');
select throws_like(
  $$ update orders set status = 'confirmed' where id = 'f0000000-0000-0000-0000-00000000000c' $$,
  '%INVALID_ORDER_TRANSITION%', 'illegal: delivered -> * rejected (delivered is terminal)');

select _mk_order('f0000000-0000-0000-0000-00000000000d', 'cancelled', 'failed');
select throws_like(
  $$ update orders set status = 'confirmed' where id = 'f0000000-0000-0000-0000-00000000000d' $$,
  '%INVALID_ORDER_TRANSITION%', 'illegal: cancelled -> * rejected (cancelled is terminal)');

select _mk_order('f0000000-0000-0000-0000-00000000000e', 'payment_failed', 'failed');
select throws_like(
  $$ update orders set status = 'confirmed' where id = 'f0000000-0000-0000-0000-00000000000e' $$,
  '%INVALID_ORDER_TRANSITION%', 'illegal: payment_failed -> confirmed rejected (a failed payment never retroactively captures — D23)');

select _mk_order('f0000000-0000-0000-0000-00000000001a', 'assigned', 'captured');
select throws_like(
  $$ update orders set status = 'delivered' where id = 'f0000000-0000-0000-0000-00000000001a' $$,
  '%INVALID_ORDER_TRANSITION%', 'illegal: assigned -> delivered rejected (skips picked_up)');

-- ============================================================
-- Actor-role enforcement (§2 Actor column, §3 last two rows)
-- ============================================================
select _mk_order('f0000000-0000-0000-0000-00000000002a', 'confirmed', 'captured');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"customer"}';
select throws_like(
  $$ update orders set status = 'packed' where id = 'f0000000-0000-0000-0000-00000000002a' $$,
  '%FORBIDDEN%', 'actor: a customer-role JWT cannot drive confirmed -> packed (that is a packer transition)');

set local request.jwt.claims = '{"sub":"x","role":"packer"}';
select lives_ok(
  $$ update orders set status = 'packed' where id = 'f0000000-0000-0000-0000-00000000002a' $$,
  'actor: a packer-role JWT CAN drive confirmed -> packed');

-- the order is now 'packed'; a runner claiming it (packed -> assigned) is
-- the runner's one legal transition here
set local request.jwt.claims = '{"sub":"x","role":"runner"}';
select lives_ok(
  $$ update orders set status = 'assigned', runner_id = 'd0000000-0000-0000-0000-000000000001'
     where id = 'f0000000-0000-0000-0000-00000000002a' $$,
  'actor: a runner-role JWT CAN drive packed -> assigned (claim_job path)');
set local request.jwt.claims to default;

-- ============================================================
-- Self-release: assigned -> packed clears runner_id + assigned_at (§2 #8)
-- ============================================================
select _mk_order('f0000000-0000-0000-0000-00000000003a', 'assigned', 'captured');
update orders set runner_id = 'd0000000-0000-0000-0000-000000000002', assigned_at = now()
  where id = 'f0000000-0000-0000-0000-00000000003a';
select lives_ok(
  $$ update orders set status = 'packed' where id = 'f0000000-0000-0000-0000-00000000003a' $$,
  'legal: assigned -> packed (self-release / timeout) is allowed');
select is(
  (select runner_id from orders where id = 'f0000000-0000-0000-0000-00000000003a'),
  null, 'self-release: runner_id is cleared by the trigger (§2 #8)');
select is(
  (select assigned_at from orders where id = 'f0000000-0000-0000-0000-00000000003a'),
  null, 'self-release: assigned_at is cleared by the trigger');

-- ============================================================
-- Payment state machine (enforce_payment_transition)
-- ============================================================
select _mk_order('f0000000-0000-0000-0000-00000000004a', 'created', 'pending');
select lives_ok(
  $$ update payments set status = 'captured' where order_id = 'f0000000-0000-0000-0000-00000000004a' $$,
  'payment: pending -> captured is legal');
update orders set status = 'confirmed' where id = 'f0000000-0000-0000-0000-00000000004a';

select _mk_order('f0000000-0000-0000-0000-00000000004b', 'created', 'pending');
select throws_like(
  $$ update payments set status = 'refunded' where order_id = 'f0000000-0000-0000-0000-00000000004b' $$,
  '%not a legal transition%', 'payment: pending -> refunded is illegal (must capture first)');

select _mk_order('f0000000-0000-0000-0000-00000000004c', 'confirmed', 'captured');
select throws_like(
  $$ update payments set status = 'failed' where order_id = 'f0000000-0000-0000-0000-00000000004c' $$,
  '%not a legal transition%', 'payment: captured -> failed is illegal');

select _mk_order('f0000000-0000-0000-0000-00000000004d', 'payment_failed', 'failed');
select throws_like(
  $$ update payments set status = 'captured' where order_id = 'f0000000-0000-0000-0000-00000000004d' $$,
  '%not a legal transition%', 'payment: failed -> * is illegal (a failed payment is terminal)');

-- ============================================================
-- D30 order/payment consistency (deferred trigger, forced immediate)
-- ============================================================
select _mk_order('f0000000-0000-0000-0000-00000000005a', 'created', 'pending');
select throws_like(
  $$ update orders set status = 'confirmed' where id = 'f0000000-0000-0000-0000-00000000005a';
     set constraints all immediate; $$,
  '%PAYMENT_ORDER_STATE_MISMATCH%',
  'D30: orders.status=confirmed while payments.status=pending is rejected at constraint-check time');

select _mk_order('f0000000-0000-0000-0000-00000000005b', 'created', 'pending');
select lives_ok(
  $$ update payments set status = 'captured' where order_id = 'f0000000-0000-0000-0000-00000000005b';
     update orders set status = 'confirmed' where id = 'f0000000-0000-0000-0000-00000000005b';
     set constraints all immediate; $$,
  'D30: updating payments->captured and orders->confirmed in one transaction is a valid resting pair');

drop function _mk_order(uuid, order_status, payment_status);
select * from finish();
rollback;
