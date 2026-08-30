-- Craavee v2.0 — Phase 5: real payments + webhook + refunds
--
-- Source of truth: docs/engineering/API_CONTRACTS.md §3 (payment_webhook,
-- refund), docs/engineering/PHASE_1_1_CORRECTIONS.md §4.2 (compensation),
-- §8 (payment invariants), §9 (payment/order consistency), §10 (late
-- webhook), docs/engineering/ORDER_STATE_MACHINE.md §2/§2.1,
-- docs/engineering/SECURITY_MODEL.md §4 (webhook redaction, D32),
-- docs/engineering/DECISION_LOG.md D12/D24/D29/D30 and the new D36/D37/D38
-- (this phase — see docs/engineering/DECISION_LOG.md).
--
-- Everything here is service-role only. No RLS write policy for any client
-- role is added (RBAC_MATRIX.md §5). The Phase 5 Edge Functions
-- (payment_webhook, refund) call these functions via supabase.rpc(); a
-- single SQL function invocation is one transaction, so each of
-- process_payment_webhook / process_refund is fully atomic. NO gateway
-- network call happens inside any of them — the gateway HTTP call for
-- creating a payment intent is Phase B of create_order (D24, unchanged);
-- webhook handling and wallet-destination refunds involve no outbound
-- network call at all.
--
-- ============================================================
-- D36 — late-capture reconciliation records money without transitioning
--       payments.status out of the terminal 'failed' state.
--
-- PHASE_1_1_CORRECTIONS.md §9 sketched a `payment_failed + refunded`
-- resting pair for a capture that clears after the reservation already
-- expired. But migration 0002's enforce_payment_transition (and its
-- pgTAP guard, 07_order_state_machine_curated_test.sql line ~168) makes a
-- `failed` payment strictly terminal — `failed -> *` is illegal, by
-- design, so that a genuinely failed payment can never look captured
-- later. Phase 5 keeps that invariant intact (Phase 5 prompt §6/§21 —
-- "all transitions must comply with enforce_payment_transition", "never
-- weaken a test"). The late capture is instead recorded WITHOUT moving
-- payments.status:
--   * refunds row (reason='late_capture_reconciliation', actor_id=null)
--   * payments.refunded_amount bumped to the captured amount (keeps the
--     D29 cached-aggregate == SUM(refunds.amount) invariant true)
--   * payments.raw_event = the redacted capture payload
--   * payments.gateway_payment_ref set (uniqueness still enforced)
--   * wallet_ledger credit (reason='refund') + profiles.wallet_balance +=
--   * audit_logs row, actor_id=null, flagged for review
--   * the caller (payment_webhook handler) raises a Sentry alert
-- orders.status is never touched — the customer never receives an order
-- that was already safely expired/cancelled (Phase 5 prompt §12). The
-- resting pair stays the valid `payment_failed + failed`.
-- ============================================================

-- ============================================================
-- 1. process_payment_webhook — API_CONTRACTS.md §3 payment_webhook.
--    ONE transaction. Signature verification + payload parsing +
--    redaction happen in the Edge Function BEFORE this is called; this
--    function receives already-normalized, already-redacted values and
--    is the sole writer of payments/orders state for a webhook event.
--
--    p_gateway       : 'razorpay' (the D37 selected gateway) | 'cashfree'
--    p_event_id      : gateway's own event id (x-razorpay-event-id header,
--                      or a deterministic id derived from the payload) —
--                      the (gateway, gateway_event_id) UNIQUE key is the
--                      transport-level idempotency mechanism (D-none:
--                      dossier guarantee #2).
--    p_order_ref     : gateway order reference — the ONLY key used to find
--                      the internal payment (no client-supplied order id
--                      is ever trusted — Phase 5 prompt §7).
--    p_payment_ref   : gateway payment reference (nullable for a failure).
--    p_outcome       : 'captured' | 'failed'.
--    p_amount        : gateway-reported amount in paise.
--    p_currency      : gateway-reported currency ('INR').
--    p_payload       : REDACTED event payload (D32) — stored verbatim into
--                      webhook_events.payload and payments.raw_event.
--
--    Returns { action, ... } — the Edge Function turns this into the
--    always-200 { ok: true } ack and decides which Sentry alerts to
--    raise. action ∈ duplicate | unknown_order | amount_mismatch |
--    currency_mismatch | confirmed | payment_failed |
--    late_capture_reconciled | noop.
-- ============================================================
create or replace function process_payment_webhook(
  p_gateway     text,
  p_event_id    text,
  p_order_ref   text,
  p_payment_ref text,
  p_outcome     text,
  p_amount      integer,
  p_currency    text,
  p_payload     jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_inserted        integer;
  v_pay_id          uuid;
  v_order_id        uuid;
  v_order_status    order_status;
  v_pay_status      payment_status;
  v_amount          integer;
  v_refunded        integer;
  v_store_id        uuid;
  v_customer_id     uuid;
  v_wallet_applied  integer;
  v_item            record;
begin
  -- Belt-and-suspenders: run in a no-JWT-context state so the actor-
  -- guarded triggers treat this trusted service-role RPC like the
  -- superuser/pgTAP path (same as create_order_phase_a, migration 0004).
  perform set_config('request.jwt.claims', '{}', true);

  -- ---- Step 1: transport-level dedup (dossier guarantee #2). The
  -- (gateway, gateway_event_id) UNIQUE constraint IS the idempotency
  -- mechanism — a duplicate event is a true no-op that never touches
  -- payments/orders.
  insert into webhook_events (gateway, gateway_event_id, payload)
  values (p_gateway, p_event_id, p_payload)
  on conflict (gateway, gateway_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('action', 'duplicate');
  end if;

  -- ---- Step 2: server-side lookup — the gateway ORDER reference is the
  -- only key trusted to find the internal payment.
  select p.id, p.order_id, p.status, p.amount, p.refunded_amount,
         o.status, o.store_id, o.customer_id, o.wallet_applied
    into v_pay_id, v_order_id, v_pay_status, v_amount, v_refunded,
         v_order_status, v_store_id, v_customer_id, v_wallet_applied
  from payments p
  join orders o on o.id = p.order_id
  where p.gateway = p_gateway and p.gateway_order_ref = p_order_ref
  for update of p;

  if v_order_id is null then
    -- No internal payment for this gateway order ref. Still ack (the row
    -- in webhook_events makes a redelivery a no-op); record for a human.
    update webhook_events set processed_at = now()
      where gateway = p_gateway and gateway_event_id = p_event_id;
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'payment.webhook_unknown_order', 'payment', gen_random_uuid(),
            jsonb_build_object('gateway', p_gateway, 'gateway_order_ref', p_order_ref,
                               'event_id', p_event_id, 'outcome', p_outcome));
    return jsonb_build_object('action', 'unknown_order');
  end if;

  -- Serialize against expire_stale_reservations (which locks candidate
  -- orders FOR UPDATE SKIP LOCKED): take the order row lock too.
  select status into v_order_status from orders where id = v_order_id for update;

  -- ---- Step 3: currency + amount verification (Phase 5 prompt §10). A
  -- mismatch is NEVER marked captured — recorded and alerted instead.
  if p_currency is not null and upper(p_currency) <> 'INR' then
    update webhook_events set processed_at = now()
      where gateway = p_gateway and gateway_event_id = p_event_id;
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'payment.currency_mismatch', 'order', v_order_id,
            jsonb_build_object('expected', 'INR', 'reported', p_currency, 'event_id', p_event_id));
    return jsonb_build_object('action', 'currency_mismatch', 'expected', 'INR', 'reported', p_currency);
  end if;

  if p_outcome = 'captured' and p_amount is distinct from v_amount then
    update webhook_events set processed_at = now()
      where gateway = p_gateway and gateway_event_id = p_event_id;
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'payment.amount_mismatch', 'order', v_order_id,
            jsonb_build_object('expected', v_amount, 'reported', p_amount,
                               'gateway_order_ref', p_order_ref, 'event_id', p_event_id));
    return jsonb_build_object('action', 'amount_mismatch', 'expected', v_amount, 'reported', p_amount);
  end if;

  -- ---- Step 4: branch on outcome + the order's current state (D30).

  -- ===== FAILURE =====
  if p_outcome = 'failed' then
    if v_order_status = 'created' and v_pay_status = 'pending' then
      -- transition #2a: release reservation, reverse any wallet debit
      -- (reservation_reversal — nothing was captured, D27), fail both.
      for v_item in select product_id, qty from order_items where order_id = v_order_id loop
        update inventory
        set qty_reserved = greatest(qty_reserved - v_item.qty, 0)
        where store_id = v_store_id and product_id = v_item.product_id;
      end loop;

      if v_wallet_applied > 0 then
        update profiles set wallet_balance = wallet_balance + v_wallet_applied
          where id = v_customer_id;
        insert into wallet_ledger (customer_id, delta, reason, order_id)
        values (v_customer_id, v_wallet_applied, 'reservation_reversal', v_order_id);
      end if;

      update payments
      set status = 'failed',
          gateway_payment_ref = coalesce(p_payment_ref, gateway_payment_ref),
          raw_event = p_payload,
          updated_at = now()
      where id = v_pay_id;
      update orders set status = 'payment_failed', payment_status = 'failed'
        where id = v_order_id;  -- trigger #2a, actor=system

      update webhook_events set processed_at = now()
        where gateway = p_gateway and gateway_event_id = p_event_id;
      insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (null, 'order.payment_failed', 'order', v_order_id,
              jsonb_build_object('via', 'webhook', 'wallet_reversed', v_wallet_applied));
      return jsonb_build_object('action', 'payment_failed');
    end if;

    -- A failure event for an order that is no longer awaiting payment
    -- (already confirmed, or already terminal) — a genuine no-op.
    update webhook_events set processed_at = now()
      where gateway = p_gateway and gateway_event_id = p_event_id;
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'payment.webhook_noop', 'order', v_order_id,
            jsonb_build_object('outcome', 'failed', 'order_status', v_order_status,
                               'payment_status', v_pay_status, 'event_id', p_event_id));
    return jsonb_build_object('action', 'noop');
  end if;

  -- ===== CAPTURE, ordinary case =====
  if v_order_status = 'created' and v_pay_status = 'pending' then
    update payments
    set status = 'captured',
        gateway_payment_ref = p_payment_ref,
        raw_event = p_payload,
        updated_at = now()
    where id = v_pay_id;
    update orders set status = 'confirmed', payment_status = 'captured'
      where id = v_order_id;  -- trigger #1, actor=system

    update webhook_events set processed_at = now()
      where gateway = p_gateway and gateway_event_id = p_event_id;
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'order.confirmed', 'order', v_order_id,
            jsonb_build_object('via', 'webhook', 'amount', v_amount));
    return jsonb_build_object('action', 'confirmed');
  end if;

  -- ===== CAPTURE for an already-terminal order — LATE CAPTURE (D36) =====
  if v_order_status in ('payment_failed', 'cancelled')
     and v_pay_status = 'failed'
     and v_refunded = 0 then
    insert into refunds (payment_id, amount, reason, idempotency_key, gateway_refund_ref, actor_id)
    values (v_pay_id, v_amount, 'late_capture_reconciliation', gen_random_uuid(), null, null);

    update payments
    set refunded_amount = refunded_amount + v_amount,
        gateway_payment_ref = coalesce(p_payment_ref, gateway_payment_ref),
        raw_event = p_payload,
        updated_at = now()
    where id = v_pay_id;

    update profiles set wallet_balance = wallet_balance + v_amount where id = v_customer_id;
    insert into wallet_ledger (customer_id, delta, reason, order_id)
    values (v_customer_id, v_amount, 'refund', v_order_id);

    update webhook_events set processed_at = now()
      where gateway = p_gateway and gateway_event_id = p_event_id;
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'payment.late_capture_reconciled', 'order', v_order_id,
            jsonb_build_object('captured', v_amount, 'wallet_credited', v_amount,
                               'order_status', v_order_status, 'event_id', p_event_id));
    return jsonb_build_object('action', 'late_capture_reconciled', 'amount', v_amount);
  end if;

  -- ===== CAPTURE, everything else — a no-op =====
  -- (already-captured payment: a second distinct event id such as
  -- order.paid following payment.captured; or a late capture we have
  -- already reconciled — v_refunded > 0.)
  update webhook_events set processed_at = now()
    where gateway = p_gateway and gateway_event_id = p_event_id;
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'payment.webhook_noop', 'order', v_order_id,
          jsonb_build_object('outcome', 'captured', 'order_status', v_order_status,
                             'payment_status', v_pay_status, 'refunded_amount', v_refunded,
                             'event_id', p_event_id));
  return jsonb_build_object('action', 'noop');
end;
$$;

comment on function process_payment_webhook(text, text, text, text, text, integer, text, jsonb) is
  'Phase 5 (D36). Sole DB writer for a payment gateway webhook event. Signature verification + parsing + D32 redaction happen in the Edge Function first. One transaction: webhook_events dedup, server-side payment lookup by gateway_order_ref, amount/currency verification, then confirm / fail / late-capture-reconcile per ORDER_STATE_MACHINE.md §2.1. Never trusts a client-supplied order id. A late capture for an already-terminal order is recorded + auto-refunded to wallet WITHOUT moving payments.status out of terminal ''failed'' (enforce_payment_transition keeps ''failed'' terminal).';

-- ============================================================
-- 2. process_refund — API_CONTRACTS.md §3 refund. ONE transaction.
--    Phase 5 implements the WALLET destination only (dossier §18: refunds
--    to wallet keep money inside the system; gateway-instrument refunds
--    are a later-phase support tool that also needs a PaymentGatewayAdapter
--    interface extension this phase is told not to make — D38).
--
--    Lock order: profiles (wallet) then payments (D25).
--
--    p_amount null => full refund of the remaining captured amount.
--    A full refund of a still-live order also CANCELS it (D38 / the
--    project owner's Phase 5 decision) — every full-refund transition in
--    ORDER_STATE_MACHINE.md §2 (#5/#6/#9/#14) is paired with
--    orders.status -> 'cancelled', because `confirmed + refunded` is not
--    a valid resting pair (§2.1).
-- ============================================================
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
      -- release the still-held reservation (never consumed yet — packing
      -- is a later phase; ORDER_STATE_MACHINE.md #5 "release reservation").
      for v_item in select product_id, qty from order_items where order_id = p_order_id loop
        update inventory
        set qty_reserved = greatest(qty_reserved - v_item.qty, 0)
        where store_id = v_store_id and product_id = v_item.product_id;
      end loop;
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
  'Phase 5 (D38). Admin/system refund. One transaction, wallet destination only. Idempotency-keyed (refunds.idempotency_key UNIQUE — replay returns the original, concurrent duplicate resolves to exactly one). refund <= payments.amount - refunded_amount (REFUND_EXCEEDS_CAPTURED otherwise). A full refund of a still-live order (confirmed/assigned/delivery_failed) also releases the reservation and moves the order to cancelled, since confirmed+refunded is not a valid resting pair (ORDER_STATE_MACHINE.md §2.1).';

-- ============================================================
-- 3. Grants — service role only (RBAC_MATRIX.md §5, the Edge-Function-
--    only write path). No client role can execute either function.
-- ============================================================
revoke execute on function process_payment_webhook(text, text, text, text, text, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function process_refund(uuid, uuid, integer, text, uuid, text) from public, anon, authenticated;
grant  execute on function process_payment_webhook(text, text, text, text, text, integer, text, jsonb) to service_role;
grant  execute on function process_refund(uuid, uuid, integer, text, uuid, text) to service_role;
