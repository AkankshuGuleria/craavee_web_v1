-- Craavee v2.0 — Phase 4: order creation + inventory correctness
--
-- Source of truth: docs/engineering/API_CONTRACTS.md §3 (create_order),
-- docs/engineering/PHASE_1_1_CORRECTIONS.md §4 (three-phase design), §5
-- (wallet concurrency), §6 (promo concurrency), §4.4 (reservation
-- expiry); docs/engineering/DATABASE_SPEC.md §7/§14; docs/engineering/
-- ORDER_STATE_MACHINE.md §2/§2.1; docs/engineering/DECISION_LOG.md
-- D11/D24/D25/D26/D27/D29/D30, and the new D33 (this phase — the
-- orders.discount column + promo-type → effect mapping).
--
-- Everything here is service-role only. No RLS write policy for any
-- client role is added (RBAC_MATRIX.md §5: every order/payment/wallet/
-- promo write goes through an Edge Function running as the service role).
-- The Edge Functions in supabase/functions/ call these functions via
-- supabase.rpc(); a single SQL function invocation is one transaction, so
-- create_order_phase_a's locking + reservation + wallet debit + promo
-- redemption + row inserts all commit or roll back atomically — Phase A
-- of PHASE_1_1_CORRECTIONS.md §4.1. The gateway call (Phase B) happens in
-- TypeScript, outside any transaction, per D24.

-- ============================================================
-- 0. Service-role trigger path fix (Phase 4 finding).
--
-- 0002/0003's actor-guarded triggers were written on the assumption that
-- "Edge Functions invoked with the service role run outside a JWT
-- context (auth.jwt() is null)". That is NOT true when an Edge Function
-- calls a function via supabase-js `.rpc()` with the service key —
-- PostgREST still populates `request.jwt.claims` with the service token,
-- so `auth.jwt() ->> 'role'` returns `'service_role'`, and the guards
-- `auth_role() is not null` / the enforce_order_transition actor lookup
-- (which has no `'service_role'` row) then WRONGLY fire against the
-- trusted Edge Function write path. Undetected before Phase 4 because it
-- is the first Edge Function that writes `orders`/`profiles` via a
-- service-role RPC (Phase 2/2A's pgTAP runs as the `postgres` superuser
-- with no JWT context at all; Phase 3's Edge-Function-free reads never
-- exercised it).
--
-- Fix: teach the three actor-guarded triggers that `'service_role'` is
-- the trusted, self-authorizing layer — exactly the intent 0002's own
-- comment already states — by treating it the same as "no JWT context".
-- `auth_role()` / every RLS policy is otherwise unchanged.
-- ============================================================

create or replace function enforce_order_transition()
returns trigger
language plpgsql
as $$
declare
  jwt_role text;
  rule_exists boolean;
  actor_allowed boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  select exists (
    select 1 from order_transition_rules
    where from_status = old.status and to_status = new.status
  ) into rule_exists;

  if not rule_exists then
    raise exception 'INVALID_ORDER_TRANSITION: % -> % is not a legal transition', old.status, new.status
      using errcode = 'P0001';
  end if;

  begin
    jwt_role := auth.jwt() ->> 'role';
  exception when others then
    jwt_role := null;
  end;

  -- The actor check defends the DIRECT-CLIENT PostgREST path only. A
  -- service-role caller (an Edge Function's RPC) is trusted to have done
  -- its own authorization (RBAC_MATRIX.md §4) — treat it like no JWT
  -- context, same as the superuser/pgTAP path. Phase 4 fix.
  if jwt_role is not null and jwt_role <> 'service_role' then
    select exists (
      select 1 from order_transition_rules
      where from_status = old.status and to_status = new.status and actor = jwt_role
    ) into actor_allowed;

    if not actor_allowed then
      raise exception 'FORBIDDEN: role % may not perform % -> %', jwt_role, old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;

  case new.status
    when 'confirmed'  then new.confirmed_at := now();
    when 'packed'     then new.packed_at := now();
    when 'assigned'   then new.assigned_at := now();
    when 'picked_up'  then new.picked_up_at := now();
    when 'delivered'  then new.delivered_at := now();
    when 'cancelled'  then new.cancelled_at := now();
    else null;
  end case;

  if old.status = 'assigned' and new.status = 'packed' then
    new.assigned_at := null;
    new.runner_id := null;
  end if;

  return new;
end;
$$;

-- ---- staff_roles: the Auth Hook could never actually read it (Phase 4
-- finding, latent since Phase 2). custom_access_token_hook (0002) is
-- SECURITY INVOKER, so it runs as `supabase_auth_admin`; that role has a
-- table-level `GRANT SELECT` on staff_roles (0002) but staff_roles also
-- has FORCE ROW LEVEL SECURITY with ZERO policies (0003, RBAC_MATRIX.md
-- §5), so every read returned ZERO rows and the hook always fell through
-- to its `role = 'customer'` else-branch — for staff too. Undetected
-- because Phase 3 only ever asserted the customer branch; found here
-- building the first test that signs in as a non-customer.
--
-- Fix: one RLS policy letting exactly `supabase_auth_admin` (the Auth
-- Hook's execution role, nobody else) SELECT staff_roles. This is the
-- hosted-safe fix — it does not depend on the hook being SECURITY
-- DEFINER or on `postgres` being a BYPASSRLS superuser.
drop policy if exists staff_roles_auth_hook_read on staff_roles;
create policy staff_roles_auth_hook_read on staff_roles
  for select to supabase_auth_admin
  using (true);

-- The two self-edit guard triggers fire on a WHEN clause; recreate them
-- so `'service_role'` (the Edge Function write path) is excluded too.
drop trigger if exists trg_profiles_self_edit on profiles;
create trigger trg_profiles_self_edit
  before update on profiles
  for each row
  when (auth_role() is not null and auth_role() not in ('admin', 'service_role'))
  execute function reject_profiles_self_edit_beyond_name();

drop trigger if exists trg_runners_self_edit on runners;
create trigger trg_runners_self_edit
  before update on runners
  for each row
  when (auth_role() is not null and auth_role() not in ('admin', 'service_role'))
  execute function reject_runners_self_edit_beyond_online();

-- ============================================================
-- 1. orders.discount (D33) — promo discount is now first-class.
--    subtotal stays GROSS (= sum(order_items.unit_price * qty)); the two
--    money-math CHECK constraints are rewritten to subtract discount.
-- ============================================================
alter table orders
  add column discount integer not null default 0 check (discount >= 0);

-- Idempotency payload guard (D23 / Phase 4 prompt §14-§15). The client
-- generates one idempotencyKey per checkout ATTEMPT and reuses it for a
-- retry of the SAME checkout. A replay of that key with a MATERIALLY
-- DIFFERENT request (different address, items, promo, or wallet choice)
-- is a client bug — create_order returns a deterministic
-- ORDER_ALREADY_EXISTS conflict rather than silently returning an order
-- the caller did not actually ask for. The hash is computed by the Edge
-- Function over the normalized request (customer + address + sorted
-- items + promo + wallet flag).
alter table orders
  add column idempotency_request_hash text;
comment on column orders.idempotency_request_hash is 'D23 / Phase 4. SHA-256 (hex) of the normalized create_order request, set at insert. A replay of the same idempotency_key with a different hash is rejected with ORDER_ALREADY_EXISTS — see create_order_phase_a.';
comment on column orders.discount is 'D33 (Phase 4). Promo discount applied at checkout, in paise. subtotal is the pre-discount goods total (= sum of order_items.unit_price*qty); payable = subtotal - discount + delivery_fee - wallet_applied. A promo of type wallet_credit contributes 0 here — it is a wallet_ledger credit instead (see create_order_phase_a).';

alter table orders drop constraint payable_matches_math;
alter table orders add constraint payable_matches_math
  check (payable = subtotal - discount + delivery_fee - wallet_applied);

alter table orders drop constraint wallet_not_above_total;
alter table orders add constraint wallet_not_above_total
  check (wallet_applied <= subtotal - discount + delivery_fee);

alter table orders add constraint discount_not_above_subtotal
  check (discount <= subtotal);

-- ============================================================
-- 2. Promo evaluation helpers — the validity rules and the discount math
--    are each defined exactly once here, then used by BOTH
--    validate_promo_preview (advisory, no lock) and create_order_phase_a
--    (authoritative, under the promos row lock).
-- ============================================================

-- Returns '' when the promo is redeemable by this customer right now,
-- otherwise a machine reason: 'not_started' | 'expired' | 'max_uses' |
-- 'per_user'. Reads promo_redemptions with a plain COUNT(*) — that count
-- is only trustworthy for the caller that holds the promos row lock
-- (create_order_phase_a); validate_promo_preview accepts the small race
-- because it is explicitly advisory (API_CONTRACTS.md §3 validate_promo:
-- "the authoritative re-validation still happens inside create_order").
create or replace function promo_redeemability(p_promo public.promos, p_customer_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  used_by_customer integer;
begin
  if now() < p_promo.valid_from then
    return 'not_started';
  end if;
  if p_promo.valid_to is not null and now() > p_promo.valid_to then
    return 'expired';
  end if;
  if p_promo.max_uses is not null and p_promo.uses_count >= p_promo.max_uses then
    return 'max_uses';
  end if;

  select count(*) into used_by_customer
  from promo_redemptions
  where promo_id = p_promo.id and customer_id = p_customer_id;

  if used_by_customer >= p_promo.per_user_limit then
    return 'per_user';
  end if;

  return '';
end;
$$;

-- The immediate order discount a promo produces (D33):
--   flat          -> min(value, subtotal)
--   percent       -> floor(subtotal * value / 100), capped at subtotal
--   wallet_credit -> 0 (redeeming it credits the wallet instead — that
--                    credit is applied by create_order_phase_a, not here)
create or replace function promo_order_discount(p_type text, p_value integer, p_subtotal integer)
returns integer
language sql
immutable
as $$
  select case p_type
    when 'flat'    then least(p_value, p_subtotal)
    when 'percent' then least((p_subtotal * p_value) / 100, p_subtotal)
    else 0
  end;
$$;

-- ============================================================
-- 3. validate_promo Edge Function backend — advisory preview only.
--    API_CONTRACTS.md §3 validate_promo: response { valid, discountAmount?, reason? }.
-- ============================================================
create or replace function validate_promo_preview(
  p_code text,
  p_customer_id uuid,
  p_subtotal integer
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_promo promos;
  v_reason text;
  v_discount integer;
begin
  select * into v_promo from promos where code = p_code;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'INVALID_PROMO');
  end if;

  v_reason := promo_redeemability(v_promo, p_customer_id);
  if v_reason <> '' then
    return jsonb_build_object(
      'valid', false,
      'reason', case when v_reason in ('max_uses', 'per_user') then 'PROMO_LIMIT_REACHED' else 'INVALID_PROMO' end
    );
  end if;

  v_discount := promo_order_discount(v_promo.type, v_promo.value, p_subtotal);
  return jsonb_build_object(
    'valid', true,
    'discountAmount', v_discount,
    'promoType', v_promo.type
  );
end;
$$;

comment on function validate_promo_preview(text, uuid, integer) is 'Backend for the validate_promo Edge Function (API_CONTRACTS.md §3). Advisory only — never trusted; create_order_phase_a re-checks the same rules under the promos row lock. For a wallet_credit promo, discountAmount is 0 (the value lands in the wallet on redemption, not as an order discount).';

-- ============================================================
-- 4. create_order Phase A (PHASE_1_1_CORRECTIONS.md §4.1 steps 1-14).
--    ONE transaction. No network I/O. Lock order: wallet -> promo ->
--    inventory (ascending product_id), D25.
--
--    p_items: jsonb array of { "productId": uuid, "qty": int }.
--    Returns a jsonb summary the Edge Function turns into the
--    CreateOrderResponse envelope. Business-rule violations are raised as
--    'CODE: human detail' with SQLSTATE P0001 — the Edge Function splits
--    on the first ': ' to recover the canonical ErrorCode (same
--    convention the existing enforce_order_transition trigger uses).
-- ============================================================
create or replace function create_order_phase_a(
  p_customer_id uuid,
  p_idempotency_key uuid,
  p_address_id uuid,
  p_items jsonb,
  p_promo_code text default null,
  p_use_wallet boolean default false,
  p_request_hash text default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_existing        orders;
  v_existing_pay    payments;
  v_zone            zones;
  v_store           stores;
  v_queue_depth     integer;
  v_items           jsonb;          -- normalized: productId merged, qty summed, sorted by productId
  v_line            jsonb;
  v_product         products;
  v_inv             inventory;
  v_subtotal        integer := 0;
  v_delivery_fee    integer;
  v_discount        integer := 0;
  v_wallet_balance  integer := 0;
  v_wallet_applied  integer := 0;
  v_payable         integer;
  v_promo           promos;
  v_promo_reason    text;
  v_order_id        uuid;
  v_order_status    order_status := 'created';
  v_payment_status  payment_status := 'pending';
  v_gateway         text;
  v_product_ids     uuid[];
begin
  -- ---- Step 0: begin the transaction in a no-JWT-context state so the
  -- actor-guarded triggers (enforce_order_transition, the self-edit
  -- guards) treat this trusted service-role RPC like the pgTAP/superuser
  -- path, not like a 'service_role'-actor client write. Section 0's
  -- trigger fix already handles 'service_role' explicitly; this is the
  -- belt-and-suspenders half.
  perform set_config('request.jwt.claims', '{}', true);

  -- ---- Step 1: idempotency. Phase A never re-runs for an existing key.
  select * into v_existing from orders where idempotency_key = p_idempotency_key;
  if found then
    if p_request_hash is not null and v_existing.idempotency_request_hash is not null
       and p_request_hash <> v_existing.idempotency_request_hash then
      raise exception 'ORDER_ALREADY_EXISTS: this idempotency key was already used for a different order'
        using errcode = 'P0001';
    end if;
    select * into v_existing_pay from payments where order_id = v_existing.id;
    return jsonb_build_object(
      'alreadyExisted', true,
      'orderId', v_existing.id,
      'status', v_existing.status::text,
      'paymentStatus', coalesce(v_existing_pay.status::text, 'pending'),
      'subtotal', v_existing.subtotal,
      'discount', v_existing.discount,
      'deliveryFee', v_existing.delivery_fee,
      'walletApplied', v_existing.wallet_applied,
      'payable', v_existing.payable,
      'gateway', v_existing_pay.gateway,
      'gatewayOrderRef', v_existing_pay.gateway_order_ref,
      'gatewayIntentRequestedAt', v_existing_pay.gateway_intent_requested_at
    );
  end if;

  -- ---- Step 2: input normalization. Merge duplicate lines by productId,
  -- sum qty, sort ascending by productId (deterministic inventory lock
  -- order, PHASE_1_1_CORRECTIONS.md §4.1 step 5c / D25).
  select coalesce(jsonb_agg(jsonb_build_object('productId', pid, 'qty', q) order by pid), '[]'::jsonb)
    into v_items
  from (
    select (elem ->> 'productId')::uuid as pid, sum((elem ->> 'qty')::int) as q
    from jsonb_array_elements(p_items) as elem
    group by (elem ->> 'productId')::uuid
  ) merged;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'ITEM_UNAVAILABLE: no items supplied' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(v_items) loop
    if (v_line ->> 'qty')::int < 1 or (v_line ->> 'qty')::int > 20 then
      raise exception 'ITEM_UNAVAILABLE: quantity out of range (1-20) for product %', v_line ->> 'productId'
        using errcode = 'P0001';
    end if;
  end loop;

  select array_agg((elem ->> 'productId')::uuid order by (elem ->> 'productId')::uuid)
    into v_product_ids
  from jsonb_array_elements(v_items) as elem;

  -- ---- Step 3: address ownership + zone serviceability.
  select z.* into v_zone
  from addresses a
  join zones z on z.id = a.zone_id
  where a.id = p_address_id and a.customer_id = p_customer_id;

  if not found then
    raise exception 'INVALID_ADDRESS: address does not exist or does not belong to this customer'
      using errcode = 'P0001';
  end if;
  if not v_zone.is_serviceable then
    raise exception 'SERVICE_UNAVAILABLE: zone % is not currently serviceable', v_zone.name
      using errcode = 'P0001';
  end if;

  -- ---- Step 4: store open + queue depth. The store is DERIVED from the
  -- address/zone — never taken from the client (Phase 4 prompt §5/§6).
  select * into v_store from stores where id = v_zone.store_id;
  if not found then
    raise exception 'SERVICE_UNAVAILABLE: store for this zone does not exist' using errcode = 'P0001';
  end if;
  if not v_store.is_open then
    raise exception 'STORE_CLOSED: %', coalesce(v_store.pause_reason, 'the store is closed')
      using errcode = 'P0001';
  end if;

  select count(*) into v_queue_depth
  from orders
  where store_id = v_store.id
    and status not in ('delivered', 'cancelled', 'payment_failed', 'delivery_failed');
  if v_queue_depth >= v_store.max_queue_depth then
    raise exception 'SERVICE_UNAVAILABLE: the store is at capacity, please try again shortly'
      using errcode = 'P0001';
  end if;

  -- ---- Step 5: every requested product exists, is listed, belongs to
  -- the derived store. (Inventory rows for that store are checked after
  -- the lock, step 8.)
  for v_line in select * from jsonb_array_elements(v_items) loop
    select * into v_product from products where id = (v_line ->> 'productId')::uuid;
    if not found or not v_product.is_listed or v_product.store_id <> v_store.id then
      raise exception 'ITEM_UNAVAILABLE: product % is not available at this store', v_line ->> 'productId'
        using errcode = 'P0001';
    end if;
  end loop;

  -- ============================================================
  -- Step 6: LOCK ACQUISITION — fixed order, D25 (deadlock prevention):
  --   (a) wallet / profiles row   (only if useWallet)
  --   (b) promo row               (only if a code was supplied)
  --   (c) inventory rows          (always, ascending product_id)
  -- Every Edge Function that could take more than one of these locks
  -- follows this same sequence — see DATABASE_SPEC.md §14.
  -- ============================================================

  -- (a) wallet
  if p_use_wallet then
    select wallet_balance into v_wallet_balance
    from profiles where id = p_customer_id
    for update;
  end if;

  -- (b) promo
  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    select * into v_promo from promos where code = p_promo_code for update;
    if not found then
      raise exception 'INVALID_PROMO: promo code % is not valid', p_promo_code using errcode = 'P0001';
    end if;
  end if;

  -- (c) inventory — lock ALL target rows in one statement, ordered.
  perform 1
  from inventory
  where store_id = v_store.id and product_id = any(v_product_ids)
  order by product_id
  for update;

  -- ---- Step 7: authoritative pricing — server-side, from the locked
  -- product rows. The client's items array carries productId + qty ONLY;
  -- no price, subtotal, delivery fee, discount, or payable is ever read
  -- from it (Phase 4 prompt §12, SECURITY_MODEL.md §2).
  for v_line in select * from jsonb_array_elements(v_items) loop
    select * into v_product from products where id = (v_line ->> 'productId')::uuid;
    v_subtotal := v_subtotal + v_product.sale_price * (v_line ->> 'qty')::int;
  end loop;

  v_delivery_fee := v_zone.delivery_fee;

  -- ---- Step 8: availability against the LOCKED inventory rows, then
  -- reserve. If ANY line is short, the whole order fails atomically —
  -- no partial reservation is ever left behind (Phase 4 prompt §10).
  for v_line in select * from jsonb_array_elements(v_items) loop
    select * into v_inv
    from inventory
    where store_id = v_store.id and product_id = (v_line ->> 'productId')::uuid;

    if not found then
      raise exception 'ITEM_UNAVAILABLE: no inventory row for product % at this store', v_line ->> 'productId'
        using errcode = 'P0001';
    end if;
    if (v_inv.qty_on_hand - v_inv.qty_reserved) < (v_line ->> 'qty')::int then
      raise exception 'INSUFFICIENT_STOCK: only % of product % available',
        (v_inv.qty_on_hand - v_inv.qty_reserved), v_line ->> 'productId'
        using errcode = 'P0001';
    end if;

    update inventory
    set qty_reserved = qty_reserved + (v_line ->> 'qty')::int
    where id = v_inv.id;
  end loop;

  -- ---- Step 9: promo validation against the LOCKED promos row (D26).
  if v_promo.id is not null then
    v_promo_reason := promo_redeemability(v_promo, p_customer_id);
    if v_promo_reason = 'not_started' then
      raise exception 'INVALID_PROMO: promo % is not active yet', v_promo.code using errcode = 'P0001';
    elsif v_promo_reason = 'expired' then
      raise exception 'INVALID_PROMO: promo % has expired', v_promo.code using errcode = 'P0001';
    elsif v_promo_reason = 'max_uses' then
      raise exception 'PROMO_LIMIT_REACHED: promo % has reached its usage limit', v_promo.code using errcode = 'P0001';
    elsif v_promo_reason = 'per_user' then
      raise exception 'PROMO_LIMIT_REACHED: you have already used promo %', v_promo.code using errcode = 'P0001';
    end if;

    v_discount := promo_order_discount(v_promo.type, v_promo.value, v_subtotal);
  end if;

  -- ---- Step 10: wallet application against the LOCKED balance (D25).
  -- useWallet=true -> apply as much as the order needs, up to the locked
  -- balance. INSUFFICIENT_BALANCE only when the customer asked to use the
  -- wallet and there is nothing in it (typically a stale client after a
  -- concurrent spend) — D33 / Phase 4 report.
  if p_use_wallet then
    if v_wallet_balance <= 0 then
      raise exception 'INSUFFICIENT_BALANCE: wallet balance is zero' using errcode = 'P0001';
    end if;
    v_wallet_applied := least(v_wallet_balance, v_subtotal - v_discount + v_delivery_fee);
  end if;

  v_payable := v_subtotal - v_discount + v_delivery_fee - v_wallet_applied;

  -- ---- Step 11: order + order_items + exactly one payments row (D29).
  if v_payable = 0 then
    v_payment_status := 'captured';   -- wallet fully covered it
    v_gateway := null;
  else
    v_payment_status := 'pending';
    v_gateway := 'razorpay';          -- the configured adapter (D12); the
                                      -- MOCK adapter stands in for it this
                                      -- phase (PHASE_PLAN.md Phase 4).
  end if;

  begin
    insert into orders (
      customer_id, store_id, address_id, status,
      subtotal, discount, delivery_fee, wallet_applied, payable, payment_status,
      idempotency_key, idempotency_request_hash
    ) values (
      p_customer_id, v_store.id, p_address_id, 'created',
      v_subtotal, v_discount, v_delivery_fee, v_wallet_applied, v_payable, v_payment_status,
      p_idempotency_key, p_request_hash
    )
    returning id into v_order_id;
  exception when unique_violation then
    -- The theoretical race in API_CONTRACTS.md §3: the unique constraint
    -- fired between step 1's pre-check and here (a concurrent request for
    -- the same key won). Re-fetch and return the existing order — unless
    -- the payloads differ, which is the same deterministic conflict as
    -- step 1.
    select * into v_existing from orders where idempotency_key = p_idempotency_key;
    if p_request_hash is not null and v_existing.idempotency_request_hash is not null
       and p_request_hash <> v_existing.idempotency_request_hash then
      raise exception 'ORDER_ALREADY_EXISTS: this idempotency key was already used for a different order'
        using errcode = 'P0001';
    end if;
    select * into v_existing_pay from payments where order_id = v_existing.id;
    return jsonb_build_object(
      'alreadyExisted', true,
      'orderId', v_existing.id,
      'status', v_existing.status::text,
      'paymentStatus', coalesce(v_existing_pay.status::text, 'pending'),
      'subtotal', v_existing.subtotal,
      'discount', v_existing.discount,
      'deliveryFee', v_existing.delivery_fee,
      'walletApplied', v_existing.wallet_applied,
      'payable', v_existing.payable,
      'gateway', v_existing_pay.gateway,
      'gatewayOrderRef', v_existing_pay.gateway_order_ref,
      'gatewayIntentRequestedAt', v_existing_pay.gateway_intent_requested_at
    );
  end;

  insert into order_items (order_id, product_id, qty, unit_price)
  select
    v_order_id,
    (elem ->> 'productId')::uuid,
    (elem ->> 'qty')::int,
    (select sale_price from products where id = (elem ->> 'productId')::uuid)
  from jsonb_array_elements(v_items) as elem;

  insert into payments (order_id, gateway, amount, status)
  values (v_order_id, v_gateway, v_payable, v_payment_status);

  -- ---- Step 12: wallet debit + ledger (same transaction — D10/D25). A
  -- rollback anywhere above already undid this; nothing special needed.
  if v_wallet_applied > 0 then
    update profiles set wallet_balance = wallet_balance - v_wallet_applied
    where id = p_customer_id;
    insert into wallet_ledger (customer_id, delta, reason, order_id)
    values (p_customer_id, -v_wallet_applied, 'checkout_redemption', v_order_id);
  end if;

  -- ---- Step 13: promo redemption writes (under the still-held promos
  -- lock) — D26's cached-aggregate + append-only-ledger pattern.
  if v_promo.id is not null then
    update promos set uses_count = uses_count + 1 where id = v_promo.id;
    insert into promo_redemptions (promo_id, customer_id, order_id)
    values (v_promo.id, p_customer_id, v_order_id);

    -- A wallet_credit promo pays out to the wallet on redemption (the
    -- "welcome credit" mechanism, ENGINEERING_SPECIFICATION.md §7 / D22).
    -- The credit is computed against the balance AFTER this order's debit,
    -- so it is available for a FUTURE order, not this one.
    if v_promo.type = 'wallet_credit' and v_promo.value > 0 then
      update profiles set wallet_balance = wallet_balance + v_promo.value
      where id = p_customer_id;
      insert into wallet_ledger (customer_id, delta, reason, order_id)
      values (p_customer_id, v_promo.value, 'promo_credit', v_order_id);
    end if;
  end if;

  -- ---- Step 14: if the wallet fully covered the order, confirm it now —
  -- no gateway step at all (PHASE_1_1_CORRECTIONS.md §4.1 step 12). The
  -- deferred check_payment_order_consistency trigger validates the final
  -- (confirmed, captured) pair at commit.
  if v_payable = 0 then
    update orders set status = 'confirmed' where id = v_order_id;   -- trigger #1, actor=system
    v_order_status := 'confirmed';
  end if;

  -- ---- Step 15: audit. metadata carries only structural fields — never
  -- a payment instrument, never a delivery code (D32).
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    p_customer_id, 'order.created', 'order', v_order_id,
    jsonb_build_object(
      'subtotal', v_subtotal, 'discount', v_discount, 'delivery_fee', v_delivery_fee,
      'wallet_applied', v_wallet_applied, 'payable', v_payable,
      'promo_code', p_promo_code, 'item_lines', jsonb_array_length(v_items)
    )
  );

  return jsonb_build_object(
    'alreadyExisted', false,
    'orderId', v_order_id,
    'status', v_order_status::text,
    'paymentStatus', v_payment_status::text,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'deliveryFee', v_delivery_fee,
    'walletApplied', v_wallet_applied,
    'payable', v_payable,
    'gateway', v_gateway
  );
end;
$$;

comment on function create_order_phase_a(uuid, uuid, uuid, jsonb, text, boolean, text) is 'create_order Phase A — one transaction, no network I/O (D24). Idempotency check, address/zone/store validation, fixed-order locking (wallet -> promo -> inventory ascending product_id, D25), server-authoritative pricing, inventory reservation, promo redemption (D26), wallet debit (D25), orders + order_items + one payments row (D29), plus the synchronous confirm for a fully wallet-covered order. Business-rule failures raise ''CODE: detail'' with SQLSTATE P0001.';

-- ============================================================
-- 5. Phase B claim marker (PHASE_1_1_CORRECTIONS.md §4.1 step 15). Its
--    OWN short transaction: lock the payments row, decide, set the
--    marker, commit — releasing the lock BEFORE the Edge Function makes
--    the gateway network call.
-- ============================================================
create or replace function claim_payment_intent(p_order_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_pay payments;
begin
  select * into v_pay from payments where order_id = p_order_id for update;
  if not found then
    raise exception 'PAYMENT_SETUP_FAILED: no payment row for order %', p_order_id using errcode = 'P0001';
  end if;

  if v_pay.gateway_order_ref is not null then
    return jsonb_build_object('action', 'already_done', 'gatewayOrderRef', v_pay.gateway_order_ref);
  end if;

  if v_pay.gateway_intent_requested_at is not null
     and now() - v_pay.gateway_intent_requested_at < interval '60 seconds' then
    return jsonb_build_object('action', 'in_progress');
  end if;

  update payments set gateway_intent_requested_at = now(), updated_at = now()
  where order_id = p_order_id;
  return jsonb_build_object('action', 'proceed');
end;
$$;

-- Phase C (PHASE_1_1_CORRECTIONS.md §4.1 step 17) — persist the gateway's
-- reference. A single-row, single-column write; the Edge Function retries
-- it up to 3 times before falling back to PAYMENT_RECONCILIATION_REQUIRED.
create or replace function persist_gateway_ref(p_order_id uuid, p_gateway_order_ref text)
returns void
language sql
set search_path = public
as $$
  update payments
  set gateway_order_ref = p_gateway_order_ref, updated_at = now()
  where order_id = p_order_id;
$$;

-- ============================================================
-- 6. expire_stale_reservations (D27 / PHASE_1_1_CORRECTIONS.md §4.4).
--    Scheduled sweep. FOR UPDATE SKIP LOCKED makes overlapping/concurrent
--    runs safe by construction (same reasoning as D13). Per expired
--    order, one transaction (this whole function is one when called via
--    RPC; per-order atomicity is also fine since a failure rolls the
--    whole sweep back and the next run retries).
-- ============================================================
create or replace function expire_stale_reservations()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_order   record;
  v_item    record;
  v_swept   integer := 0;
begin
  for v_order in
    select id, store_id, customer_id, wallet_applied
    from orders
    where status = 'created' and reservation_expires_at < now()
    for update skip locked
  loop
    -- release every line's reservation
    for v_item in select product_id, qty from order_items where order_id = v_order.id loop
      update inventory
      set qty_reserved = qty_reserved - v_item.qty
      where store_id = v_order.store_id and product_id = v_item.product_id;
    end loop;

    -- reverse any wallet debit — reservation_reversal, NOT refund (D27):
    -- nothing was ever captured.
    if v_order.wallet_applied > 0 then
      update profiles set wallet_balance = wallet_balance + v_order.wallet_applied
      where id = v_order.customer_id;
      insert into wallet_ledger (customer_id, delta, reason, order_id)
      values (v_order.customer_id, v_order.wallet_applied, 'reservation_reversal', v_order.id);
    end if;

    -- payments.status -> failed, then orders.status -> payment_failed.
    -- The deferred consistency trigger validates the final
    -- (payment_failed, failed) pair at commit; statement order does not
    -- matter (it is DEFERRABLE INITIALLY DEFERRED).
    update payments set status = 'failed' where order_id = v_order.id;
    update orders set status = 'payment_failed' where id = v_order.id;   -- trigger #2b, actor=system

    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'order.reservation_expired', 'order', v_order.id,
            jsonb_build_object('wallet_reversed', v_order.wallet_applied));

    v_swept := v_swept + 1;
  end loop;

  return v_swept;
end;
$$;

comment on function expire_stale_reservations() is 'D27. Scheduled every 1 minute (pg_cron below, or a scheduled Edge Function in an environment without pg_cron). Sweeps created orders past reservation_expires_at: releases inventory, reverses any wallet debit (reason=reservation_reversal), moves the order to payment_failed and its payment to failed. FOR UPDATE SKIP LOCKED makes concurrent/overlapping runs safe.';

-- ============================================================
-- 7. Grants — service role only. No client role can execute any of
--    these (they are the Edge-Function-only write path, RBAC_MATRIX.md §5).
-- ============================================================
revoke execute on function create_order_phase_a(uuid, uuid, uuid, jsonb, text, boolean, text) from public, anon, authenticated;
revoke execute on function validate_promo_preview(text, uuid, integer) from public, anon, authenticated;
revoke execute on function claim_payment_intent(uuid) from public, anon, authenticated;
revoke execute on function persist_gateway_ref(uuid, text) from public, anon, authenticated;
revoke execute on function expire_stale_reservations() from public, anon, authenticated;
revoke execute on function promo_redeemability(public.promos, uuid) from public, anon, authenticated;

-- 0003's `grant execute on all functions ... to service_role` ran before
-- these functions existed and its ALTER DEFAULT PRIVILEGES only covers
-- tables — so every 0004 function, including the internal helpers a
-- SECURITY INVOKER function calls in turn, must be granted explicitly.
grant execute on function create_order_phase_a(uuid, uuid, uuid, jsonb, text, boolean, text) to service_role;
grant execute on function validate_promo_preview(text, uuid, integer) to service_role;
grant execute on function claim_payment_intent(uuid) to service_role;
grant execute on function persist_gateway_ref(uuid, text) to service_role;
grant execute on function expire_stale_reservations() to service_role;
grant execute on function promo_redeemability(public.promos, uuid) to service_role;
grant execute on function promo_order_discount(text, integer, integer) to service_role;

-- ============================================================
-- 8. Schedule the sweep (D27, cadence 1 minute). Guarded: pg_cron is
--    present in the Supabase local/hosted images, but if an environment
--    lacks it the migration still applies and the deploy wires a
--    scheduled Edge Function calling expire_stale_reservations instead
--    (documented, PHASE_4_IMPLEMENTATION_REPORT.md).
-- ============================================================
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'craavee-expire-stale-reservations',
    '* * * * *',
    $cron$ select public.expire_stale_reservations(); $cron$
  );
exception when others then
  raise notice 'pg_cron not available (%). Schedule expire_stale_reservations() as a Supabase scheduled Edge Function instead.', sqlerrm;
end;
$$;
