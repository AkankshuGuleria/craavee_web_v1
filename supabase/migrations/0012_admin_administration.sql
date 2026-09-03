-- ============================================================
-- Phase 9B — administration backend
-- ============================================================
-- Two audited mutation paths the Console needs, and nothing else.
--
-- RBAC_MATRIX.md §4 says admin catalog/pricing edits and manual stock
-- corrections are safe as plain RLS writes: single-table, uncontended, no
-- cross-table invariant. That remains true and the policies are
-- untouched. What plain RLS cannot do is write `audit_logs`, which is
-- service-role-INSERT only — so a browser correcting stock or changing a
-- price leaves no record of who did it.
--
-- Both of these move money or promises: a price is what the next customer
-- pays, and a stock correction is what the store claims it can deliver.
-- They belong in the audit log for the same reason the kill switch does
-- (0011 §5). These functions are therefore the audited path, not a new
-- authority — same writes, same admin scope, plus the record.
--
--   1. process_admin_adjust_inventory
--   2. process_admin_upsert_product
--
-- Migrations 0001-0011 are untouched.


-- ============================================================
-- 1. process_admin_adjust_inventory
-- ============================================================
-- Corrects `qty_on_hand` only. `qty_reserved` is deliberately NOT
-- adjustable here: it is owned by the order lifecycle (create_order
-- reserves, mark_packed consumes, refund-from-confirmed releases), and a
-- human typing a number into it would desynchronise it from the orders
-- that believe they hold that stock — the same class of corruption
-- migration 0011 had to fix from the other direction.
--
-- reserved_not_above_on_hand (0001) is the backstop: an admin cannot
-- count the shelf down below what live orders have already claimed. The
-- function reports that as a canonical error instead of a raw constraint
-- violation, because "you have 4 units promised to orders" is actionable
-- and "23514" is not.
create or replace function process_admin_adjust_inventory(
  p_store_id   uuid,
  p_product_id uuid,
  p_actor_id   uuid,
  p_qty_on_hand integer,
  p_reason     text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role     text;
  v_store    uuid;
  v_before   record;
begin
  if p_qty_on_hand is null or p_qty_on_hand < 0 then
    raise exception 'VALIDATION_FAILED: on-hand quantity must be zero or more'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'VALIDATION_FAILED: a reason is required for a stock correction'
      using errcode = 'P0001';
  end if;

  select sr.role::text, sr.store_id into v_role, v_store
  from staff_roles sr where sr.profile_id = p_actor_id;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN: admin role required' using errcode = 'P0001';
  end if;
  -- A store-scoped admin may only correct their own store's shelf; a
  -- null store_id is the all-store admin (RBAC §1).
  if v_store is not null and v_store is distinct from p_store_id then
    raise exception 'FORBIDDEN: this admin is scoped to a different store'
      using errcode = 'P0001';
  end if;

  select qty_on_hand, qty_reserved into v_before
  from inventory
  where store_id = p_store_id and product_id = p_product_id
  for update;
  if not found then
    raise exception 'VALIDATION_FAILED: no inventory row for that product at that store'
      using errcode = 'P0001';
  end if;

  if p_qty_on_hand < v_before.qty_reserved then
    raise exception 'VALIDATION_FAILED: % units are already reserved by live orders, so on-hand cannot go below that', v_before.qty_reserved
      using errcode = 'P0001';
  end if;

  update inventory
     set qty_on_hand = p_qty_on_hand
   where store_id = p_store_id and product_id = p_product_id;

  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id, 'inventory.adjusted', 'product', p_product_id,
    jsonb_build_object(
      'storeId', p_store_id,
      'reason',  btrim(p_reason),
      'from',    v_before.qty_on_hand,
      'to',      p_qty_on_hand,
      'delta',   p_qty_on_hand - v_before.qty_on_hand,
      'reserved', v_before.qty_reserved
    )
  );

  return jsonb_build_object(
    'storeId', p_store_id, 'productId', p_product_id,
    'qtyOnHand', p_qty_on_hand, 'qtyReserved', v_before.qty_reserved,
    'previousOnHand', v_before.qty_on_hand
  );
end;
$$;

comment on function process_admin_adjust_inventory(uuid, uuid, uuid, integer, text) is
  'Phase 9B. Admin manual stock correction with an audit row (the plain-RLS write in RBAC §4 cannot produce one). Adjusts qty_on_hand ONLY — qty_reserved is owned by the order lifecycle. reserved_not_above_on_hand is the backstop; the function surfaces it as a canonical error.';


-- ============================================================
-- 2. process_admin_upsert_product
-- ============================================================
-- Catalog and pricing edits, audited.
--
-- The safety property that matters here is one this function does NOT
-- have to implement: changing a price CANNOT alter an existing order.
-- order_items.unit_price is a snapshot copied at create_order time, and
-- orders.subtotal/payable are stored integers — nothing recomputes from
-- products.sale_price after the fact. A price edit therefore affects the
-- next customer and nobody who has already paid. The regression test in
-- supabase/tests/17 pins that, because it is the kind of guarantee that
-- is only obvious until someone adds a view that joins live prices.
create or replace function process_admin_upsert_product(
  p_product_id uuid,
  p_store_id   uuid,
  p_actor_id   uuid,
  p_name       text,
  p_brand      text,
  p_category   text,
  p_unit_label text,
  p_mrp        integer,
  p_sale_price integer,
  p_is_listed  boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role   text;
  v_scope  uuid;
  v_before record;
  v_id     uuid;
  v_action text;
begin
  select sr.role::text, sr.store_id into v_role, v_scope
  from staff_roles sr where sr.profile_id = p_actor_id;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN: admin role required' using errcode = 'P0001';
  end if;
  if v_scope is not null and v_scope is distinct from p_store_id then
    raise exception 'FORBIDDEN: this admin is scoped to a different store'
      using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'VALIDATION_FAILED: a product name is required' using errcode = 'P0001';
  end if;
  if p_mrp is null or p_mrp < 0 or p_sale_price is null or p_sale_price < 0 then
    raise exception 'VALIDATION_FAILED: prices must be zero or more, in paise'
      using errcode = 'P0001';
  end if;
  -- sale_price_not_above_mrp (0001) enforces this too; saying it here
  -- turns a constraint code into a sentence an operator can act on.
  if p_sale_price > p_mrp then
    raise exception 'VALIDATION_FAILED: the sale price cannot be above the MRP'
      using errcode = 'P0001';
  end if;

  if p_product_id is null then
    insert into products (store_id, name, brand, category, unit_label, mrp, sale_price, is_listed)
    values (p_store_id, btrim(p_name), nullif(btrim(coalesce(p_brand, '')), ''),
            btrim(p_category), nullif(btrim(coalesce(p_unit_label, '')), ''),
            p_mrp, p_sale_price, coalesce(p_is_listed, true))
    returning id into v_id;
    v_action := 'product.created';

    -- A listed product with no inventory row is invisible to customers
    -- (products_with_availability inner-joins it) and cannot be ordered,
    -- so a new product starts with an explicit zero-stock row rather
    -- than silently not existing.
    insert into inventory (store_id, product_id, qty_on_hand, qty_reserved)
    values (p_store_id, v_id, 0, 0)
    on conflict (store_id, product_id) do nothing;

    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (p_actor_id, v_action, 'product', v_id,
            jsonb_build_object('storeId', p_store_id, 'name', btrim(p_name),
                               'mrp', p_mrp, 'salePrice', p_sale_price,
                               'isListed', coalesce(p_is_listed, true)));
  else
    select id, store_id, name, mrp, sale_price, is_listed into v_before
    from products where id = p_product_id for update;
    if not found then
      raise exception 'VALIDATION_FAILED: no such product' using errcode = 'P0001';
    end if;
    if v_scope is not null and v_scope is distinct from v_before.store_id then
      raise exception 'FORBIDDEN: this admin is scoped to a different store'
        using errcode = 'P0001';
    end if;

    update products
       set name       = btrim(p_name),
           brand      = nullif(btrim(coalesce(p_brand, '')), ''),
           category   = btrim(p_category),
           unit_label = nullif(btrim(coalesce(p_unit_label, '')), ''),
           mrp        = p_mrp,
           sale_price = p_sale_price,
           is_listed  = coalesce(p_is_listed, v_before.is_listed)
     where id = p_product_id;
    v_id := p_product_id;
    v_action := 'product.updated';

    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (p_actor_id, v_action, 'product', v_id,
            jsonb_build_object(
              'storeId', v_before.store_id,
              'name', btrim(p_name),
              'priceFrom', v_before.sale_price, 'priceTo', p_sale_price,
              'mrpFrom', v_before.mrp, 'mrpTo', p_mrp,
              'listedFrom', v_before.is_listed, 'listedTo', coalesce(p_is_listed, v_before.is_listed)));
  end if;

  return jsonb_build_object('productId', v_id, 'action', v_action,
                            'salePrice', p_sale_price, 'isListed', coalesce(p_is_listed, true));
end;
$$;

comment on function process_admin_upsert_product(uuid, uuid, uuid, text, text, text, text, integer, integer, boolean) is
  'Phase 9B. Admin catalog/pricing create+edit with an audit row recording the before/after price. A new product gets a zero-stock inventory row so it is not silently unorderable. Changing a price never alters an existing order: order_items.unit_price is a snapshot (test 17 pins it).';


-- ============================================================
-- 3. Execute grants — service role only
-- ============================================================
revoke execute on function process_admin_adjust_inventory(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function process_admin_upsert_product(uuid, uuid, uuid, text, text, text, text, integer, integer, boolean) from public, anon, authenticated;
grant  execute on function process_admin_adjust_inventory(uuid, uuid, uuid, integer, text) to service_role;
grant  execute on function process_admin_upsert_product(uuid, uuid, uuid, text, text, text, text, integer, integer, boolean) to service_role;


-- ============================================================
-- 4. refunds_admin_view — make the refund ledger actually readable
-- ============================================================
-- `refunds` has an admin SELECT policy (0003 §12) and a SELECT grant, so
-- it looks readable. It is not: the policy's customer branch joins
-- `payments`, and `payments` has NO select grant for `authenticated` —
-- deliberately, because it carries gateway refs and raw_event, which
-- RBAC_MATRIX.md §5 keeps out of the browser by routing reads through
-- two column-restricted views instead.
--
-- Evaluating that policy therefore needs a privilege the caller does not
-- have, and PostgREST answers `42501: permission denied for table
-- payments` — for an admin too. The refund ledger has been unreadable
-- from any client since 0003; nothing had tried to read it until this
-- phase built the surface.
--
-- The fix is the pattern already in this codebase, not a new grant: an
-- admin-scoped, security_barrier view, exactly like payments_admin_view
-- immediately above it in 0003. `payments` stays ungranted, no policy is
-- weakened, and the customer path is untouched — a customer still reads
-- their own refunds through the base table's policy, which for them does
-- not need this view at all.
create or replace view refunds_admin_view
  with (security_barrier = true)
as
select r.id, r.payment_id, r.amount, r.reason, r.actor_id, r.created_at,
       p.order_id, p.amount as payment_amount, p.refunded_amount as payment_refunded
from refunds r
join payments p on p.id = r.payment_id
where auth_role() = 'admin';

grant select on refunds_admin_view to authenticated;

comment on view refunds_admin_view is
  'Phase 9B. The admin refund ledger. refunds'' own policy joins payments to check customer ownership, and payments is ungranted to authenticated by design (RBAC §5) — so the base table is unreadable even for an admin. Same shape as payments_admin_view: admin-scoped, security_barrier, no new grant on payments.';
