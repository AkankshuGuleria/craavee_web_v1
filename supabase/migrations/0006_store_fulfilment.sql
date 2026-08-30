-- 0006_store_fulfilment.sql — Phase 6: Store fulfilment (packing).
--
-- Adds the two store-side reconciliation operations from
-- API_CONTRACTS.md §"Store-Side Reconciliation": mark_packed and
-- mark_stock_out. Both are multi-table transactions over
-- orders + order_items + inventory (+ payments/wallet for a stock-out
-- refund), so both live here as plpgsql and are called by an Edge
-- Function through one RPC — never assembled client-side.
--
-- Governing decisions carried in from earlier phases:
--   * ORDER_STATE_MACHINE.md #4: confirmed -> packed, actor `packer`,
--     inventory effect "consume reservation" (qty_reserved -= qty,
--     qty_on_hand -= qty). The trigger stamps packed_at; nothing here
--     writes that column.
--   * ORDER_STATE_MACHINE.md §2.1 "Stock-out is not a state transition":
--     a stock-out sets the line's fulfilled_qty, reduces the order's
--     money, refunds the difference, and lets the order continue toward
--     packed. There is no `stock_out` order status and none is added.
--   * D25 lock order (deadlock prevention): wallet -> promo -> inventory
--     (ascending product_id). Both functions below follow it; neither
--     introduces a competing sequence.
--   * D38: refunds settle to the wallet.
--
-- Authorization note: both functions resolve the actor's role and store
-- from `staff_roles` THEMSELVES, from a profile id only. The Edge
-- Function passes the JWT-verified caller id and nothing else — it
-- cannot assert a role or a store, and neither can a browser. This is
-- the SECURITY_MODEL.md "database is the final enforcement layer" rule
-- applied to fulfilment.

-- ============================================================
-- 1. Schema: mark a line as stock-out-reconciled
-- ============================================================
-- order_items.fulfilled_qty already exists (0001) with the
-- `fulfilled_qty <= qty` constraint, so no fulfilment-quantity column is
-- invented here (Phase 6 prompt §17: use it if present).
--
-- One column IS genuinely required. fulfilled_qty defaults to 0, and a
-- total stock-out also sets it to 0 — so fulfilled_qty alone cannot
-- distinguish "not yet packed" from "already reconciled to zero".
-- mark_packed needs that distinction (API_CONTRACTS.md: it fills in
-- every row "not already adjusted by a prior mark_stock_out call"), and
-- stock-out idempotency needs it too. stock_out_at is that marker and
-- doubles as the idempotency guard.
alter table order_items
  add column if not exists stock_out_at timestamptz,
  add column if not exists stock_out_by uuid references profiles(id);

comment on column order_items.stock_out_at is
  'Set by mark_stock_out when this line was reconciled against what was actually on the shelf. NULL = never stocked out, so fulfilled_qty is still the default rather than a deliberate zero. Also the idempotency guard: a second stock-out on the same line is a no-op.';

-- The packer queue is "confirmed orders for my store, oldest first"
-- (Phase 6 prompt §6). Without this the queue degrades to a seq scan on
-- orders as volume grows; it is the only index this phase adds.
create index if not exists orders_store_status_placed_idx
  on orders (store_id, status, placed_at);

-- ============================================================
-- 2. Staff scope resolution
-- ============================================================
-- Resolves a profile to its operational (role, store_id). Admins have a
-- NULL store_id in staff_roles, meaning all-store scope (0001's
-- staff_role_store_required constraint). SECURITY DEFINER because
-- staff_roles is zero-policy for everyone except the Auth Hook
-- (RBAC_MATRIX.md §5) and these callers run as service_role anyway.
create or replace function staff_scope(p_profile_id uuid)
returns table (role user_role, store_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select sr.role, sr.store_id from staff_roles sr where sr.profile_id = p_profile_id
$$;

revoke execute on function staff_scope(uuid) from public, anon, authenticated;
grant  execute on function staff_scope(uuid) to service_role;

-- ============================================================
-- 3. Shared authorization guard for the two fulfilment operations
-- ============================================================
-- Raises FORBIDDEN unless the actor is a packer scoped to this order's
-- store, or an admin (all-store). Returns the resolved role so callers
-- can record it in the audit metadata.
create or replace function assert_fulfilment_actor(p_actor_id uuid, p_store_id uuid)
returns user_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role     user_role;
  v_store_id uuid;
begin
  select role, store_id into v_role, v_store_id from staff_scope(p_actor_id);

  if v_role is null then
    raise exception 'FORBIDDEN: caller has no staff role' using errcode = 'P0001';
  end if;

  if v_role = 'admin' then
    return v_role;   -- all-store scope, RBAC_MATRIX.md §4 admin override
  end if;

  if v_role <> 'packer' then
    raise exception 'FORBIDDEN: role % may not perform store fulfilment actions', v_role
      using errcode = 'P0001';
  end if;

  if v_store_id is distinct from p_store_id then
    raise exception 'FORBIDDEN: this order belongs to another store'
      using errcode = 'P0001';
  end if;

  return v_role;
end;
$$;

revoke execute on function assert_fulfilment_actor(uuid, uuid) from public, anon, authenticated;
grant  execute on function assert_fulfilment_actor(uuid, uuid) to service_role;

-- ============================================================
-- 4. mark_packed
-- ============================================================
-- One transaction (Phase 6 prompt §12): lock the order, validate status
-- and store, fill in fulfilled_qty for every line the packer did NOT
-- stock out, consume those reservations, transition the order, audit.
-- No network I/O — the gateway is never touched here.
--
-- Idempotency (§23): an order already `packed` returns
-- {alreadyPacked:true} rather than raising, so a double tap or a retried
-- request is harmless. Two concurrent calls serialize on the order row
-- lock; the loser sees `packed` and takes the same branch.
create or replace function process_mark_packed(
  p_order_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_status     order_status;
  v_store_id   uuid;
  v_role       user_role;
  v_item       record;
  v_lines      integer := 0;
  v_units      integer := 0;
begin
  -- Edge Functions run as service_role with no JWT context; make that
  -- explicit so enforce_order_transition's actor check takes the
  -- "trusted caller, already authorized" branch rather than reading a
  -- stale claim (same pattern as process_refund).
  perform set_config('request.jwt.claims', '{}', true);

  -- ---- Step 1: lock the order row. Everything below is decided against
  -- this locked snapshot, so a concurrent mark_packed / stock-out / cancel
  -- cannot interleave.
  select status, store_id into v_status, v_store_id
  from orders where id = p_order_id
  for update;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  -- ---- Step 2: authorization, resolved from staff_roles (never from
  -- the request). Runs before any status branch so an unauthorized
  -- caller cannot learn an order's state from the error it gets back.
  v_role := assert_fulfilment_actor(p_actor_id, v_store_id);

  -- ---- Step 3: idempotent replay.
  if v_status = 'packed' then
    return jsonb_build_object('orderId', p_order_id, 'status', 'packed', 'alreadyPacked', true);
  end if;

  if v_status <> 'confirmed' then
    raise exception 'INVALID_ORDER_TRANSITION: % -> packed is not a legal transition', v_status
      using errcode = 'P0001';
  end if;

  -- ---- Step 4: reconcile lines and consume reservations.
  -- Deterministic order (ascending product_id) — D25's inventory lock
  -- sequence, matching create_order_phase_a, so a packing transaction and
  -- an order-creation transaction can never deadlock against each other.
  --
  -- A line already reconciled by mark_stock_out keeps its fulfilled_qty
  -- and had its unfulfilled reservation released at that time; only the
  -- still-fulfilled remainder is consumed here. A line never stocked out
  -- is fulfilled in full.
  for v_item in
    select oi.id, oi.product_id, oi.qty, oi.fulfilled_qty, oi.stock_out_at
    from order_items oi
    where oi.order_id = p_order_id
    order by oi.product_id
  loop
    if v_item.stock_out_at is null then
      update order_items set fulfilled_qty = v_item.qty where id = v_item.id;
      v_item.fulfilled_qty := v_item.qty;
    end if;

    if v_item.fulfilled_qty > 0 then
      -- Consume: the units leave both the reservation and the shelf.
      -- greatest(...,0) is deliberate belt-and-braces; the CHECK
      -- constraints on inventory would reject a negative anyway, which is
      -- the guarantee that matters (§11: qty_reserved must never go < 0).
      update inventory
      set qty_reserved = greatest(qty_reserved - v_item.fulfilled_qty, 0),
          qty_on_hand  = greatest(qty_on_hand  - v_item.fulfilled_qty, 0)
      where store_id = v_store_id and product_id = v_item.product_id;
    end if;

    v_lines := v_lines + 1;
    v_units := v_units + v_item.fulfilled_qty;
  end loop;

  -- ---- Step 5: transition. enforce_order_transition validates
  -- confirmed->packed, checks the (orders.status, payments.status) pair
  -- (§2.1: packed requires captured or partially_refunded) and stamps
  -- packed_at itself.
  update orders set status = 'packed' where id = p_order_id;

  -- ---- Step 6: audit (§22).
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'order.packed', 'order', p_order_id,
          jsonb_build_object('actor_role', v_role, 'store_id', v_store_id,
                             'lines', v_lines, 'units_packed', v_units));

  return jsonb_build_object(
    'orderId', p_order_id,
    'status', 'packed',
    'alreadyPacked', false,
    'linesPacked', v_lines,
    'unitsPacked', v_units
  );
end;
$$;

revoke execute on function process_mark_packed(uuid, uuid) from public, anon, authenticated;
grant  execute on function process_mark_packed(uuid, uuid) to service_role;

comment on function process_mark_packed(uuid, uuid) is
  'mark_packed (API_CONTRACTS.md). One transaction: lock order, authorize from staff_roles, fill fulfilled_qty for lines not stocked out, consume their reservations (qty_reserved/qty_on_hand), transition confirmed->packed, audit. Idempotent on an already-packed order. No network I/O.';

-- ============================================================
-- 5. mark_stock_out
-- ============================================================
-- A fulfilment event, NOT a status change (ORDER_STATE_MACHINE.md §2.1).
-- The order stays `confirmed` and continues toward `packed` with its
-- remaining lines.
--
-- Money model (Phase 6 prompt §16 — "define exactly how the financial
-- state changes"). The customer's consideration is
-- subtotal + delivery_fee, funded by wallet_applied + payable (the
-- gateway share; payments.amount is the gateway share only — 0004
-- step 11). Removing X of line value means:
--
--   orders.subtotal      -= X
--   orders.payable       -= min(X, payable)            } keeps
--   orders.wallet_applied-= X - min(X, payable)        } payable_matches_math
--   wallet credited      += X                          (D38, one net credit)
--
-- Historical prices are never rewritten: order_items.unit_price is
-- untouched and the removed value is derived from it. The reduction is
-- split payable-first so `payable >= 0` and
-- `wallet_applied <= subtotal + delivery_fee` both continue to hold.
--
-- Why this does not simply call process_refund: that function's
-- full-refund branch cancels the order and releases every reservation
-- (0005 step 7). For a stock-out that is wrong — an order can have its
-- entire *gateway* share refunded (when the rest was wallet-funded)
-- while other lines are still perfectly fulfillable, and cancelling it
-- would contradict "the order continues toward packed". So the refund is
-- issued here against the same architecture — the same `refunds` table
-- and its UNIQUE idempotency_key, the same payments.refunded_amount /
-- status transition through enforce_payment_transition, the same
-- wallet_ledger reason 'refund' — without the auto-cancel branch.
create or replace function process_stock_out(
  p_order_id        uuid,
  p_order_item_id   uuid,
  p_available_qty   integer,
  p_delist          boolean,
  p_actor_id        uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_status        order_status;
  v_store_id      uuid;
  v_customer_id   uuid;
  v_subtotal      integer;
  v_delivery_fee  integer;
  v_payable       integer;
  v_wallet_applied integer;
  v_role          user_role;
  v_item          order_items;
  v_unfulfilled   integer;
  v_refund_value  integer;
  v_pay_id        uuid;
  v_pay_amount    integer;
  v_refunded      integer;
  v_pay_status    payment_status;
  v_gateway_share integer;
  v_wallet_share  integer;
  v_new_refunded  integer;
  v_refund_id     uuid;
  v_pay_cut       integer;
  v_wallet_cut    integer;
begin
  perform set_config('request.jwt.claims', '{}', true);

  -- ---- Step 1: lock the order.
  select status, store_id, customer_id, subtotal, delivery_fee, payable, wallet_applied
    into v_status, v_store_id, v_customer_id, v_subtotal, v_delivery_fee, v_payable, v_wallet_applied
  from orders where id = p_order_id
  for update;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  v_role := assert_fulfilment_actor(p_actor_id, v_store_id);

  -- A stock-out is a packing-time discovery: only meaningful while the
  -- order is still awaiting packing.
  if v_status <> 'confirmed' then
    raise exception 'INVALID_ORDER_TRANSITION: a stock-out can only be recorded on a confirmed order, not %', v_status
      using errcode = 'P0001';
  end if;

  -- ---- Step 2: the line, locked.
  select * into v_item from order_items
  where id = p_order_item_id and order_id = p_order_id
  for update;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order item on this order' using errcode = 'P0001';
  end if;

  -- ---- Step 3: idempotency (§18, §23). The first stock-out on a line
  -- stamps stock_out_at; a replay — sequential or concurrent, since the
  -- row is locked above — returns the original outcome and performs no
  -- second refund.
  if v_item.stock_out_at is not null then
    return jsonb_build_object(
      'orderItemId', p_order_item_id,
      'fulfilledQty', v_item.fulfilled_qty,
      'refundAmount', 0,
      'newPayable', v_payable,
      'alreadyStockedOut', true
    );
  end if;

  -- ---- Step 4: validate the declared quantity. Exceeding the ordered
  -- qty is a client bug, not a real state (API_CONTRACTS.md).
  if p_available_qty is null or p_available_qty < 0 or p_available_qty > v_item.qty then
    raise exception 'ITEM_UNAVAILABLE: availableQty % is not within 0..% for this line', p_available_qty, v_item.qty
      using errcode = 'P0001';
  end if;

  v_unfulfilled := v_item.qty - p_available_qty;
  if v_unfulfilled = 0 then
    raise exception 'ITEM_UNAVAILABLE: availableQty equals the ordered quantity — nothing was short'
      using errcode = 'P0001';
  end if;

  -- Server-authoritative (§13/§15): derived from the stored unit_price,
  -- never from anything the caller sent.
  v_refund_value := v_unfulfilled * v_item.unit_price;

  -- ---- Step 5: locks in D25 order — wallet, then payment, then
  -- inventory. Taken before any mutation so this transaction can never
  -- hold an inventory row while waiting on a wallet row.
  perform 1 from profiles where id = v_customer_id for update;

  select id, amount, refunded_amount, status
    into v_pay_id, v_pay_amount, v_refunded, v_pay_status
  from payments where order_id = p_order_id
  for update;

  -- ---- Step 6: split the amount owed across its two funding sources.
  -- Everything lands in the wallet either way (D38); the split exists so
  -- payments.refunded_amount never exceeds what the gateway captured.
  v_gateway_share := least(v_refund_value, greatest(coalesce(v_pay_amount, 0) - coalesce(v_refunded, 0), 0));
  v_wallet_share  := v_refund_value - v_gateway_share;

  if v_gateway_share > 0 then
    if v_pay_status not in ('captured', 'partially_refunded') then
      raise exception 'PAYMENT_FAILED: this order has no captured payment to refund against'
        using errcode = 'P0001';
    end if;

    v_new_refunded := v_refunded + v_gateway_share;

    insert into refunds (payment_id, amount, reason, idempotency_key, gateway_refund_ref, actor_id)
    values (v_pay_id, v_gateway_share, 'stock_out', p_idempotency_key, null, p_actor_id)
    returning id into v_refund_id;

    update payments
    set refunded_amount = v_new_refunded,
        status = case when v_new_refunded = v_pay_amount then 'refunded'::payment_status
                      else 'partially_refunded'::payment_status end,
        updated_at = now()
    where id = v_pay_id;

    -- Keep the denormalized column on orders in step, as 0005 does.
    update orders
    set payment_status = case when v_new_refunded = v_pay_amount then 'refunded'::payment_status
                              else 'partially_refunded'::payment_status end
    where id = p_order_id;
  end if;

  -- ---- Step 7: one net wallet credit for the whole removed value.
  update profiles set wallet_balance = wallet_balance + v_refund_value where id = v_customer_id;
  insert into wallet_ledger (customer_id, delta, reason, order_id)
  values (v_customer_id, v_refund_value, 'refund', p_order_id);

  -- ---- Step 8: release the unfulfilled portion's reservation. The
  -- fulfilled remainder stays reserved until mark_packed consumes it.
  update inventory
  set qty_reserved = greatest(qty_reserved - v_unfulfilled, 0)
  where store_id = v_store_id and product_id = v_item.product_id;

  -- Optional catalogue correction. `delist` defaults to true for a total
  -- miss: the product stops being orderable at this store until someone
  -- restocks it, which is the honest signal when the shelf was empty.
  --
  -- When delist is false the ONLY inventory effect is the reservation
  -- release above. It is deliberately not a shelf recount: p_available_qty
  -- is how many units this one order could be filled with, not how many
  -- exist in the store, and writing it into inventory.qty_on_hand would
  -- destroy stock legitimately reserved by other open orders. A genuine
  -- recount is an inventory correction with its own audit trail, not a
  -- side effect of packing one bag.
  if coalesce(p_delist, p_available_qty = 0) then
    update products set is_listed = false where id = v_item.product_id;
  end if;

  -- ---- Step 9: the line itself.
  update order_items
  set fulfilled_qty = p_available_qty,
      stock_out_at  = now(),
      stock_out_by  = p_actor_id
  where id = p_order_item_id;

  -- ---- Step 10: order money. Reduce subtotal by the removed value and
  -- take it off payable first, then wallet_applied, so
  -- payable_matches_math, payable >= 0 and wallet_not_above_total all
  -- continue to hold (see the header for the derivation).
  v_pay_cut    := least(v_refund_value, v_payable);
  v_wallet_cut := v_refund_value - v_pay_cut;

  update orders
  set subtotal       = v_subtotal - v_refund_value,
      payable        = v_payable - v_pay_cut,
      wallet_applied = v_wallet_applied - v_wallet_cut
  where id = p_order_id;

  -- ---- Step 11: audit (§22). No payment secrets, no raw gateway payload.
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'order.stock_out', 'order', p_order_id,
          jsonb_build_object('actor_role', v_role, 'store_id', v_store_id,
                             'order_item_id', p_order_item_id,
                             'product_id', v_item.product_id,
                             'ordered_qty', v_item.qty,
                             'available_qty', p_available_qty,
                             'refund_amount', v_refund_value,
                             'gateway_share', v_gateway_share,
                             'wallet_share', v_wallet_share,
                             'refund_id', v_refund_id,
                             'delisted', coalesce(p_delist, p_available_qty = 0)));

  return jsonb_build_object(
    'orderItemId', p_order_item_id,
    'fulfilledQty', p_available_qty,
    'refundAmount', v_refund_value,
    'newPayable', v_payable - v_pay_cut,
    'alreadyStockedOut', false
  );
end;
$$;

revoke execute on function process_stock_out(uuid, uuid, integer, boolean, uuid, uuid) from public, anon, authenticated;
grant  execute on function process_stock_out(uuid, uuid, integer, boolean, uuid, uuid) to service_role;

comment on function process_stock_out(uuid, uuid, integer, boolean, uuid, uuid) is
  'mark_stock_out (API_CONTRACTS.md). One transaction: lock order + line, authorize from staff_roles, server-compute the removed value from order_items.unit_price, refund it to the wallet (gateway share through the refunds table, remainder direct), release the unfulfilled reservation, delist or correct the shelf count, reduce orders.subtotal/payable/wallet_applied coherently, audit. orders.status is NOT changed — stock-out is not a state transition. Idempotent per line via order_items.stock_out_at.';
