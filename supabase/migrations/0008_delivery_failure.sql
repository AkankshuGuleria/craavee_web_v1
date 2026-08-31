-- ============================================================
-- Phase 8, Part A — delivery failure
-- ============================================================
-- Closes the operational hole Phase 7 reported rather than papered
-- over: a runner who has PICKED UP an order and cannot deliver had no
-- path at all. `picked_up` exits only to `delivered` or
-- `delivery_failed` (ORDER_STATE_MACHINE.md §2), and release_job cannot
-- help because `picked_up -> packed` is not a legal transition.
--
-- Nothing here is invented. Transition #12 is already in the state
-- machine, both actor rules are already in order_transition_rules
-- (0002 §108-109), the (delivery_failed, captured|partially_refunded)
-- payment pairs are already in payment_order_consistency_rules
-- (0002 §287-288), and the request shape already exists as
-- markDeliveryFailedRequestSchema. This migration adds the one missing
-- piece: the function that performs it.
--
-- Row #12, read literally:
--   Actor              runner (own job) or admin
--   Trigger            customer unreachable / wrong address / safety
--   Timestamp written  -- none
--   Inventory effect   none
--   Wallet/payment     "none yet (see #13/#14 for resolution)"
--   Audit              order.delivery_failed, reason logged
--
-- So: NO refund here. That is deliberate and specified. A delivery
-- failure is not itself a financial event - the admin decides the
-- outcome afterwards via #13 (reassign, already implemented in 0007) or
-- #14 (cancel + full refund). Refunding automatically would refund
-- orders that are about to be delivered successfully on a second
-- attempt.
--
-- The runner stays on the order. #12 does not clear runner_id (unlike
-- #8, which the trigger clears explicitly), so the order remains
-- attributable to whoever attempted it until an admin acts. It is NOT
-- returned to the claim queue - `delivery_failed` is not claimable, and
-- claim_job only ever selects `packed` rows.


-- ============================================================
-- 1. mark_delivery_failed  (#12: picked_up -> delivery_failed)
-- ============================================================
-- Idempotent replay: an order already `delivery_failed` returns
-- {alreadyFailed:true} rather than raising, so a double tap from a
-- runner standing at a wrong door is harmless. Two concurrent calls
-- serialize on the order row lock and exactly one performs the effect.
create or replace function process_mark_delivery_failed(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason   text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_store_id  uuid;
  v_status    order_status;
  v_order_run uuid;
  v_role      user_role;
  v_runner    uuid;
begin
  -- Edge Functions run as service_role with no JWT context; make that
  -- explicit so enforce_order_transition takes its "trusted caller,
  -- already authorized" branch (same pattern as every other process_*).
  perform set_config('request.jwt.claims', '{}', true);

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION_FAILED: a reason is required' using errcode = 'P0001';
  end if;

  select store_id, status, runner_id into v_store_id, v_status, v_order_run
  from orders where id = p_order_id for update;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  -- Authorization first, so an unauthorized caller cannot learn the
  -- order's state from the error it gets back.
  select ar.role, ar.runner_id into v_role, v_runner
  from assert_runner_actor(p_actor_id, v_store_id) ar;

  -- Ownership, not just role: a runner acting on another runner's order
  -- is rejected even though their role is correct (D28).
  if v_role = 'runner' and v_order_run is distinct from v_runner then
    raise exception 'FORBIDDEN: not the assigned runner' using errcode = 'P0001';
  end if;

  if v_status = 'delivery_failed' then
    return jsonb_build_object('orderId', p_order_id, 'status', 'delivery_failed', 'alreadyFailed', true);
  end if;

  if v_status <> 'picked_up' then
    raise exception 'INVALID_ORDER_TRANSITION: % -> delivery_failed is not a legal transition', v_status
      using errcode = 'P0001';
  end if;

  update orders set status = 'delivery_failed' where id = p_order_id;

  -- The delivery code must stop working. The attempt is over, and an
  -- order that is later reassigned gets a fresh code from
  -- process_admin_reassign - so leaving the old one live would let the
  -- failed runner complete a delivery they no longer own.
  delete from order_delivery_codes where order_id = p_order_id;
  update orders set delivery_code_hash = null where id = p_order_id;

  -- Row #12: "reason logged". audit_logs is where the state machine puts
  -- it; orders gains no column, and audit_logs_select is admin-only so
  -- the reason is visible to the Console and to nobody else.
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'order.delivery_failed', 'order', p_order_id,
          jsonb_build_object('runnerId', v_order_run, 'role', v_role,
                             'reason', left(btrim(p_reason), 500)));

  return jsonb_build_object('orderId', p_order_id, 'status', 'delivery_failed');
end;
$$;

revoke execute on function process_mark_delivery_failed(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function process_mark_delivery_failed(uuid, uuid, text) to service_role;
