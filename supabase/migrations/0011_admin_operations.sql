-- ============================================================
-- Phase 9, Part A — admin operations backend
-- ============================================================
-- Four capabilities the Console needs that were specified but never
-- built (API_CONTRACTS.md §3 "Administrative / Privileged"), plus one
-- correctness fix that Phase 9's failed-delivery queue would otherwise
-- trigger on every use.
--
-- Nothing here invents a lifecycle state, a money rule, or an authority.
-- Every transition below is already a row in order_transition_rules and
-- already described in ORDER_STATE_MACHINE.md; every authorization rule
-- is already in RBAC_MATRIX.md. What was missing was the function.
--
--   1. process_refund              — FIX (see §1)
--   2. process_admin_cancel_order  — #6 / #9 / #14
--   3. process_assign_staff_role   — the only door into staff_roles
--   4. process_settle_runner_earnings
--   5. process_set_service_pause   — the audited kill-switch path
--
-- Migrations 0001-0010 are untouched.


-- ============================================================
-- 1. process_refund — release the reservation only from `confirmed`
-- ============================================================
-- Measured bug, not a theoretical one. Reproduced on a clean database:
--
--   product P: on_hand 10, reserved 0
--   order A (3 units) placed        -> on_hand 10, reserved 3
--   mark_packed A                   -> on_hand  7, reserved 0   (consumed)
--   A -> assigned -> picked_up -> delivery_failed
--   order B (2 units) placed        -> on_hand  7, reserved 2   (B is live)
--   full refund of A                -> on_hand  7, reserved 0   <-- B's
--                                                                   reservation
--                                                                   destroyed
--
-- B is still `confirmed`, still owes 2 units, and the shelf now claims
-- all 7 are free. That is an oversell, produced by an admin doing the
-- ordinary thing on a failed delivery.
--
-- 0005's comment explains how it got there — "never consumed yet,
-- packing is a later phase" was true when it was written and stopped
-- being true when 0006 landed mark_packed. The whole function is
-- re-created below because plpgsql has no way to patch one statement;
-- the ONLY behavioural change is the guarded release, marked inline.
create or replace function process_refund(
  p_order_id        uuid,
  p_idempotency_key uuid,
  p_amount          integer,
  p_reason          text,
  p_actor_id        uuid,
  p_destination     text default 'wallet'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_existing        refunds;
  v_existing_oid    uuid;
  v_customer_id     uuid;
  v_order_status    order_status;
  v_store_id        uuid;
  v_pay_id          uuid;
  v_pay_amount      integer;
  v_refunded        integer;
  v_pay_status      payment_status;
  v_remaining       integer;
  v_amount          integer;
  v_new_refunded    integer;
  v_refund_id       uuid;
  v_full            boolean;
  v_cancelled       boolean := false;
  v_item            record;
begin
  perform set_config('request.jwt.claims', '{}', true);

  -- ---- Step 1: idempotency (D29 — refunds.idempotency_key UNIQUE). A
  -- replay with the same key returns the original refund unchanged; the
  -- same key with a different logical request is a deterministic conflict.
  select * into v_existing from refunds where idempotency_key = p_idempotency_key;
  if found then
    select order_id into v_existing_oid from payments where id = v_existing.payment_id;
    if v_existing_oid is distinct from p_order_id then
      raise exception 'ORDER_ALREADY_EXISTS: this idempotency key was already used for a refund on a different order'
        using errcode = 'P0001';
    end if;
    if p_amount is not null and p_amount <> v_existing.amount then
      raise exception 'ORDER_ALREADY_EXISTS: this idempotency key was already used for a refund of a different amount'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'alreadyExisted', true,
      'refundId', v_existing.id,
      'amount', v_existing.amount,
      'walletCredited', case when v_existing.gateway_refund_ref is null then v_existing.amount else 0 end,
      'gatewayRefunded', case when v_existing.gateway_refund_ref is null then 0 else v_existing.amount end
    );
  end if;

  if p_destination is distinct from 'wallet' then
    raise exception 'VALIDATION_FAILED: only wallet-destination refunds are supported in this release (D38)'
      using errcode = 'P0001';
  end if;

  -- ---- Step 2: resolve the order, then lock wallet -> payment (D25).
  select customer_id, status, store_id
    into v_customer_id, v_order_status, v_store_id
  from orders where id = p_order_id;
  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  perform 1 from profiles where id = v_customer_id for update;

  select id, amount, refunded_amount, status
    into v_pay_id, v_pay_amount, v_refunded, v_pay_status
  from payments where order_id = p_order_id
  for update;

  -- ---- Step 3: money must actually have been captured at some point. A
  -- 'refunded' payment IS a captured-then-fully-returned one — it falls
  -- through to the remaining-balance check below (remaining = 0 ->
  -- REFUND_EXCEEDS_CAPTURED), a more accurate answer than "not captured".
  if v_pay_status not in ('captured', 'partially_refunded', 'refunded') then
    raise exception 'PAYMENT_FAILED: this order has no captured payment to refund'
      using errcode = 'P0001';
  end if;

  v_remaining := v_pay_amount - v_refunded;
  v_amount := coalesce(p_amount, v_remaining);

  if v_amount <= 0 then
    raise exception 'REFUND_EXCEEDS_CAPTURED: nothing left to refund on this payment'
      using errcode = 'P0001';
  end if;
  if v_amount > v_remaining then
    raise exception 'REFUND_EXCEEDS_CAPTURED: refund of % exceeds the refundable balance of %', v_amount, v_remaining
      using errcode = 'P0001';
  end if;

  v_new_refunded := v_refunded + v_amount;
  v_full := (v_new_refunded = v_pay_amount);

  -- ---- Step 4: the refunds row FIRST — so a concurrent duplicate (same
  -- idempotency_key) hits the UNIQUE constraint here, before any effect,
  -- and returns the winner's row rather than double-refunding (§14).
  begin
    insert into refunds (payment_id, amount, reason, idempotency_key, gateway_refund_ref, actor_id)
    values (v_pay_id, v_amount, p_reason, p_idempotency_key, null, p_actor_id)
    returning id into v_refund_id;
  exception when unique_violation then
    select * into v_existing from refunds where idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'alreadyExisted', true,
      'refundId', v_existing.id,
      'amount', v_existing.amount,
      'walletCredited', v_existing.amount,
      'gatewayRefunded', 0
    );
  end;

  -- ---- Step 5: payments aggregate + status transition
  -- (enforce_payment_transition: captured->partially_refunded,
  -- captured->refunded, partially_refunded->refunded, or the
  -- partially_refunded->partially_refunded top-up — refunded_amount
  -- strictly increasing).
  update payments
  set refunded_amount = v_new_refunded,
      status = case when v_full then 'refunded'::payment_status else 'partially_refunded'::payment_status end,
      updated_at = now()
  where id = v_pay_id;

  -- ---- Step 6: wallet credit (reason='refund' — money WAS captured, D27).
  update profiles set wallet_balance = wallet_balance + v_amount where id = v_customer_id;
  insert into wallet_ledger (customer_id, delta, reason, order_id)
  values (v_customer_id, v_amount, 'refund', p_order_id);

  -- ---- Step 7: a full refund of a still-live order also cancels it.
  if v_full then
    if v_order_status in ('confirmed', 'assigned', 'delivery_failed') then
      -- Release the reservation ONLY from `confirmed`. This is the fix.
      --
      -- The original guard released for all three states, on the premise
      -- (true when 0005 was written, false since 0006) that "packing is a
      -- later phase" so the reservation was necessarily still held. It is
      -- not: `assigned` and `delivery_failed` are reachable only THROUGH
      -- `packed`, and mark_packed already consumed the reservation
      -- (`qty_reserved -= qty` AND `qty_on_hand -= qty`). Releasing again
      -- subtracts a quantity this order no longer holds, so it silently
      -- eats a DIFFERENT live order's reservation — greatest(...,0) hides
      -- the damage from the CHECK constraint instead of preventing it.
      --
      -- ORDER_STATE_MACHINE.md says exactly this for #9 and #14: the
      -- reservation "was already consumed at mark_packed, so this
      -- transition does NOT restore qty_on_hand automatically; a physical
      -- restock is a separate admin inventory correction".
      if v_order_status = 'confirmed' then
        for v_item in select product_id, qty from order_items where order_id = p_order_id loop
          update inventory
          set qty_reserved = greatest(qty_reserved - v_item.qty, 0)
          where store_id = v_store_id and product_id = v_item.product_id;
        end loop;
      end if;
      update orders
      set status = 'cancelled',
          payment_status = 'refunded',
          cancel_reason = coalesce(nullif(p_reason, ''), 'full refund issued')
      where id = p_order_id;  -- trigger #6, actor=admin/system
      v_cancelled := true;
    elsif v_order_status in ('payment_failed', 'cancelled') then
      -- order already terminal and consistent with 'refunded' — nothing
      -- more to do (unreachable in practice: a payment_failed order's
      -- payment is 'failed', so step 3 already raised).
      null;
    else
      -- packed / picked_up / delivered — no legal auto-cancel transition.
      raise exception 'INVALID_ORDER_TRANSITION: a full refund of an order in status % must go through the cancellation flow', v_order_status
        using errcode = 'P0001';
    end if;
  else
    -- partial refund — the order stays where it is; keep the denormalized
    -- orders.payment_status column in step with payments.status.
    update orders set payment_status = 'partially_refunded' where id = p_order_id;
  end if;

  -- ---- Step 8: audit
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'refund.issued', 'order', p_order_id,
          jsonb_build_object('refund_id', v_refund_id, 'amount', v_amount,
                             'destination', 'wallet', 'reason', p_reason,
                             'full', v_full, 'order_cancelled', v_cancelled));

  return jsonb_build_object(
    'alreadyExisted', false,
    'refundId', v_refund_id,
    'amount', v_amount,
    'walletCredited', v_amount,
    'gatewayRefunded', 0,
    'paymentStatus', case when v_full then 'refunded' else 'partially_refunded' end,
    'orderCancelled', v_cancelled
  );
end;
$$;

comment on function process_refund(uuid, uuid, integer, text, uuid, text) is
  'Phase 5 (D38). Admin/system refund. One transaction, wallet destination only. Idempotency-keyed (refunds.idempotency_key UNIQUE — replay returns the original, concurrent duplicate resolves to exactly one). refund <= payments.amount - refunded_amount (REFUND_EXCEEDS_CAPTURED otherwise). A full refund of a still-live order (confirmed/assigned/delivery_failed) moves it to cancelled, since confirmed+refunded is not a valid resting pair (ORDER_STATE_MACHINE.md §2.1). Phase 9 fix: the reservation is released ONLY from confirmed — past mark_packed it has already been consumed, and releasing it again corrupts another live order''s reservation (#9/#14).';


-- ============================================================
-- 2. process_admin_cancel_order — ORDER_STATE_MACHINE #6 / #9 / #14
-- ============================================================
-- API_CONTRACTS.md: "{ orderId, reason }", admin-only, "a thin wrapper
-- around the transitions in ORDER_STATE_MACHINE.md #6/#9/#13/#14 — same
-- validation/audit discipline as every other function".
--
-- Thin is the point. Every one of those rows pairs the cancellation with
-- a FULL REFUND, and process_refund already implements that pairing
-- atomically (money, reservation, order status, audit). So this function
-- does not re-implement any of it: it authorizes, checks the transition
-- is legal for an admin, and delegates. Two ways to cancel an order with
-- two different money behaviours is exactly the kind of divergence that
-- makes a refund model rot.
--
-- The reason is REQUIRED here even though process_refund's is optional:
-- #9 and #14 both say "cancel_reason required (free text, admin-
-- entered)" — an operational cancellation nobody can explain later is
-- not an auditable action.
create or replace function process_admin_cancel_order(
  p_order_id        uuid,
  p_actor_id        uuid,
  p_reason          text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role   text;
  v_status order_status;
  v_result jsonb;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'VALIDATION_FAILED: a cancellation reason is required'
      using errcode = 'P0001';
  end if;

  select sr.role::text into v_role from staff_roles sr where sr.profile_id = p_actor_id;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN: admin role required' using errcode = 'P0001';
  end if;

  select o.status into v_status from orders o where o.id = p_order_id;
  if v_status is null then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  -- Legality is not re-derived here; it is read from the same table the
  -- trigger reads, so a rule change lands in one place.
  if not exists (
    select 1 from order_transition_rules
    where from_status = v_status and to_status = 'cancelled' and actor = 'admin'
  ) then
    raise exception 'INVALID_ORDER_TRANSITION: % -> cancelled is not an admin transition', v_status
      using errcode = 'P0001';
  end if;

  -- p_amount null => full refund, which is what every cancel row
  -- specifies. process_refund performs the cancellation itself.
  v_result := process_refund(p_order_id, p_idempotency_key, null, p_reason, p_actor_id, 'wallet');

  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id, 'order.cancelled', 'order', p_order_id,
    jsonb_build_object('role', 'admin', 'reason', p_reason, 'fromStatus', v_status)
  );

  return jsonb_build_object(
    'orderId',        p_order_id,
    'status',         (select o.status from orders o where o.id = p_order_id),
    'refundedAmount', v_result -> 'refundedAmount',
    'fromStatus',     v_status
  );
end;
$$;

comment on function process_admin_cancel_order(uuid, uuid, text, uuid) is
  'Phase 9. ORDER_STATE_MACHINE #6/#9/#14. Admin-only operational cancellation; reason required. Delegates the money and the status change to process_refund (full refund) rather than re-implementing them, so there is exactly one cancellation-with-refund path.';


-- ============================================================
-- 3. process_assign_staff_role — the only door into staff_roles
-- ============================================================
-- RBAC_MATRIX.md §5: staff_roles has NO client-facing RLS policy at all.
-- API_CONTRACTS.md: admin-only, "checked inside the function against the
-- caller's own staff_roles row (service role bypasses RLS, so this check
-- is the function's own responsibility, not delegable to a policy)".
--
-- staff_role_store_required (0001) already enforces "store_id required
-- unless role='admin'" — this function does not restate that rule, it
-- lets the constraint be the authority and reports it as a validation
-- error. Revoking a role is `p_role => null`, which deletes the row and
-- returns the profile to plain `customer`; there is no separate revoke
-- function because "has no staff_roles row" IS the customer state.
create or replace function process_assign_staff_role(
  p_profile_id uuid,
  p_actor_id   uuid,
  p_role       text,
  p_store_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_role text;
  v_existing   text;
begin
  select sr.role::text into v_actor_role from staff_roles sr where sr.profile_id = p_actor_id;
  if v_actor_role is distinct from 'admin' then
    raise exception 'FORBIDDEN: admin role required' using errcode = 'P0001';
  end if;

  if not exists (select 1 from profiles where id = p_profile_id) then
    raise exception 'VALIDATION_FAILED: no such profile' using errcode = 'P0001';
  end if;

  -- An admin removing their own admin rights would lock the door from
  -- the inside; the last admin doing it locks it for everybody.
  if p_profile_id = p_actor_id and p_role is distinct from 'admin' then
    raise exception 'FORBIDDEN: an admin cannot remove their own admin role'
      using errcode = 'P0001';
  end if;

  select sr.role::text into v_existing from staff_roles sr where sr.profile_id = p_profile_id;

  if p_role is null then
    delete from staff_roles where profile_id = p_profile_id;
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (p_actor_id, 'staff_role.revoked', 'profile', p_profile_id,
            jsonb_build_object('previousRole', v_existing));
    return jsonb_build_object('profileId', p_profile_id, 'role', null, 'storeId', null);
  end if;

  if p_role not in ('packer', 'runner', 'admin') then
    raise exception 'VALIDATION_FAILED: unknown role %', p_role using errcode = 'P0001';
  end if;
  if p_store_id is not null and not exists (select 1 from stores where id = p_store_id) then
    raise exception 'VALIDATION_FAILED: no such store' using errcode = 'P0001';
  end if;

  begin
    insert into staff_roles (profile_id, role, store_id, granted_by)
    values (p_profile_id, p_role::user_role, p_store_id, p_actor_id)
    on conflict (profile_id) do update
      set role = excluded.role, store_id = excluded.store_id, granted_by = excluded.granted_by;
  exception when check_violation then
    raise exception 'VALIDATION_FAILED: a store is required for the % role', p_role
      using errcode = 'P0001';
  end;

  -- A runner needs a runners row to be assignable at all: orders.runner_id
  -- is a FK into runners, not profiles (D28). Creating the role without it
  -- would produce a "runner" who can sign in and see nothing.
  if p_role = 'runner' and not exists (select 1 from runners where profile_id = p_profile_id) then
    insert into runners (profile_id, store_id, is_online)
    values (p_profile_id, p_store_id, false);
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'staff_role.assigned', 'profile', p_profile_id,
          jsonb_build_object('role', p_role, 'storeId', p_store_id, 'previousRole', v_existing));

  return jsonb_build_object('profileId', p_profile_id, 'role', p_role, 'storeId', p_store_id);
end;
$$;

comment on function process_assign_staff_role(uuid, uuid, text, uuid) is
  'Phase 9. API_CONTRACTS.md assign_staff_role. The only write path into staff_roles (RBAC §5). Admin-only, checked inside the function. p_role null revokes. Creates the runners row a runner needs to be assignable (D28). Refuses to let an admin strip their own admin role.';


-- ============================================================
-- 4. process_settle_runner_earnings
-- ============================================================
-- API_CONTRACTS.md: "{ runnerId, upToOrderIds? }" -> "{ settledCount,
-- totalAmount }". Dossier §9/§21: the money moves outside the system by
-- manual transfer; this function only records that it happened.
--
-- Already-settled rows are skipped rather than re-stamped, so a double
-- click settles nothing twice and reports 0 — the honest answer.
create or replace function process_settle_runner_earnings(
  p_runner_id uuid,
  p_actor_id  uuid,
  p_order_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role  text;
  v_count int;
  v_total bigint;
begin
  select sr.role::text into v_role from staff_roles sr where sr.profile_id = p_actor_id;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN: admin role required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from runners where id = p_runner_id) then
    raise exception 'VALIDATION_FAILED: no such runner' using errcode = 'P0001';
  end if;

  with settled as (
    update runner_earnings
    set settled_at = now()
    where runner_id = p_runner_id
      and settled_at is null
      and (p_order_ids is null or order_id = any (p_order_ids))
    returning amount
  )
  select count(*), coalesce(sum(amount), 0) into v_count, v_total from settled;

  if v_count > 0 then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (p_actor_id, 'runner_earnings.settled', 'runner', p_runner_id,
            jsonb_build_object('settledCount', v_count, 'totalAmount', v_total));
  end if;

  return jsonb_build_object('runnerId', p_runner_id, 'settledCount', v_count, 'totalAmount', v_total);
end;
$$;

comment on function process_settle_runner_earnings(uuid, uuid, uuid[]) is
  'Phase 9. API_CONTRACTS.md settle_runner_earnings. Admin-only. Marks unsettled runner_earnings rows settled after a manual transfer; already-settled rows are skipped, so a replay settles nothing and reports 0.';


-- ============================================================
-- 5. process_set_service_pause — the audited kill switch
-- ============================================================
-- The kill switch itself is NOT new. ENGINEERING_SPECIFICATION.md §11
-- already specifies stores.is_open / pause_reason / max_queue_depth, and
-- create_order (0004, step 4) already refuses with STORE_CLOSED inside
-- the SAME TRANSACTION that reads the flag — so a checkout racing a
-- pause is decided by Postgres, not by a disabled button. Enforcement
-- was never the missing piece.
--
-- What was missing is the audit. RBAC_MATRIX.md routes store config
-- through plain admin RLS, but audit_logs is service-role-INSERT only,
-- so a browser writing stores directly can never leave a record of who
-- paused the shop and why. Pausing the business is exactly the class of
-- action the audit log exists for. This function is therefore the
-- smallest thing that closes that gap: same write, same authority, one
-- transaction, with the audit row the RLS path cannot produce.
create or replace function process_set_service_pause(
  p_store_id        uuid,
  p_actor_id        uuid,
  p_is_open         boolean,
  p_pause_reason    text,
  p_max_queue_depth integer
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role   text;
  v_before record;
  v_reason text;
begin
  select sr.role::text into v_role from staff_roles sr where sr.profile_id = p_actor_id;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN: admin role required' using errcode = 'P0001';
  end if;

  select id, is_open, pause_reason, max_queue_depth into v_before
  from stores where id = p_store_id for update;
  if v_before.id is null then
    raise exception 'VALIDATION_FAILED: no such store' using errcode = 'P0001';
  end if;

  if p_max_queue_depth is not null and p_max_queue_depth < 1 then
    raise exception 'VALIDATION_FAILED: max_queue_depth must be at least 1'
      using errcode = 'P0001';
  end if;

  -- Pausing without a reason is how a shop stays shut on Monday because
  -- nobody remembers who closed it on Friday.
  if not p_is_open and coalesce(btrim(p_pause_reason), '') = '' then
    raise exception 'VALIDATION_FAILED: a pause reason is required to close the store'
      using errcode = 'P0001';
  end if;

  v_reason := case when p_is_open then null else btrim(p_pause_reason) end;

  update stores
  set is_open         = p_is_open,
      pause_reason    = v_reason,
      max_queue_depth = coalesce(p_max_queue_depth, max_queue_depth)
  where id = p_store_id;

  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id,
    case when p_is_open then 'service.resumed' else 'service.paused' end,
    'store', p_store_id,
    jsonb_build_object(
      'isOpen',        p_is_open,
      'reason',        v_reason,
      'wasOpen',       v_before.is_open,
      'maxQueueDepth', coalesce(p_max_queue_depth, v_before.max_queue_depth)
    )
  );

  return jsonb_build_object(
    'storeId',       p_store_id,
    'isOpen',        p_is_open,
    'pauseReason',   v_reason,
    'maxQueueDepth', coalesce(p_max_queue_depth, v_before.max_queue_depth),
    'changed',       (v_before.is_open is distinct from p_is_open)
  );
end;
$$;

comment on function process_set_service_pause(uuid, uuid, boolean, text, integer) is
  'Phase 9. Admin-only service pause/resume + queue threshold, with the audit row the plain-RLS stores write cannot produce. Enforcement itself already lives in create_order (0004 step 4), transactionally — this only flips the flag and records who did it.';


-- ============================================================
-- 6. Execute grants — service role only
-- ============================================================
-- Same discipline as every other process_* function: the Edge Function
-- is the only caller, and no client role can reach these directly.
revoke execute on function process_admin_cancel_order(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function process_assign_staff_role(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function process_settle_runner_earnings(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke execute on function process_set_service_pause(uuid, uuid, boolean, text, integer) from public, anon, authenticated;
grant  execute on function process_admin_cancel_order(uuid, uuid, text, uuid) to service_role;
grant  execute on function process_assign_staff_role(uuid, uuid, text, uuid) to service_role;
grant  execute on function process_settle_runner_earnings(uuid, uuid, uuid[]) to service_role;
grant  execute on function process_set_service_pause(uuid, uuid, boolean, text, integer) to service_role;
