-- Craavee v2.0 — Row Level Security
-- Source of truth: docs/engineering/RBAC_MATRIX.md (§5 has the per-table
-- policy definitions this file implements 1:1; §2 is the capability
-- matrix; §4 is the direct-PostgREST-vs-Edge-Function split this file
-- assumes — nothing here grants a client a write path RBAC_MATRIX.md §4
-- says must go through an Edge Function).
--
-- Governing rule (dossier, restated Phase 1 prompt): the client is never
-- the final authorization boundary. auth.jwt()->>'role' is server-
-- injected (D8, custom_access_token_hook in 0002) — never trust a
-- client-supplied role field.

-- ============================================================
-- -1. Application-role Postgres roles (Phase 3 finding)
-- ============================================================
-- `custom_access_token_hook` (0002) overwrites the JWT's top-level
-- `role` claim with the app-level value ('customer'/'packer'/'runner'/
-- 'admin') — the exact pattern Supabase's own Custom Access Token Hook
-- documentation shows (`claims['role'] = claims.app_metadata.role`).
-- What that documentation pattern *requires*, which this migration
-- hadn't yet done, is a real Postgres role for every value the claim can
-- take: PostgREST reads the same top-level `role` claim to `SET ROLE
-- <value>` for the duration of each request — not merely to make it
-- available to `auth.jwt()` inside policies — and fails the entire
-- request with "role <value> does not exist" if no such role exists.
-- Undetected through Phase 2/2A because every RLS test in this suite
-- exercises policies directly over `psql` (setting `request.jwt.claims`
-- by hand), which never goes through PostgREST's own SET ROLE step —
-- only Phase 3's real `@supabase/supabase-js` calls against the actual
-- Auth+PostgREST HTTP path surfaced this.
--
-- Fix: create the four roles PostgREST needs to be able to switch to,
-- each inheriting `authenticated`'s existing grants (every grant below
-- in this file still targets `authenticated` only — unchanged — these
-- four roles ride on that via membership, not a second copy of every
-- grant), and let `authenticator` (the role PostgREST itself connects
-- as locally) switch to them. `auth_role()`/every RLS policy is
-- unaffected: the JWT payload's `role` claim value is identical to what
-- it always was, only the *session's actual Postgres role* now
-- successfully becomes that value instead of erroring.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'customer') then
    create role customer nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'packer') then
    create role packer nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'runner') then
    create role runner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'admin') then
    create role admin nologin;
  end if;
end $$;

grant authenticated to customer, packer, runner, admin;
grant customer, packer, runner, admin to authenticator;

-- ============================================================
-- 0. Helper functions
-- ============================================================
create or replace function auth_role() returns text
language sql stable as $$ select auth.jwt() ->> 'role' $$;

create or replace function auth_store_id() returns uuid
language sql stable as $$ select nullif(auth.jwt() ->> 'store_id', '')::uuid $$;

-- SECURITY DEFINER, deliberately, and narrowly safe: this function is
-- embedded inside RLS policies on profiles/orders/order_items
-- (profiles_select, orders_select, order_items_select). Postgres does
-- NOT guarantee AND/OR short-circuit evaluation order for RLS USING
-- clauses — the planner can (and, observed empirically, does) evaluate
-- this function's nested `runners` query even for a role whose branch
-- of the boolean expression is false, e.g. `auth_role() = 'runner' AND
-- ... = auth_runner_id()` for a non-runner caller. Roles without a
-- direct grant on `runners` (anon; any future role) would otherwise get
-- a hard "permission denied for table runners" instead of the intended
-- graceful "this branch is false" — discovered via Phase 2A's
-- investigation of an anon-session RLS test failure.
--
-- SECURITY DEFINER fixes this by letting the function run with its
-- owner's privileges regardless of the caller's grants, so the nested
-- query never fails on a missing table grant. This introduces NO
-- privilege escalation: the query is unconditionally scoped to
-- `profile_id = auth.uid()`, so it can only ever return the CALLING
-- session's own runner id (or NULL) — never any other user's data,
-- regardless of who invokes it. `search_path` is pinned to prevent
-- search-path hijacking of a SECURITY DEFINER function (a real risk
-- class independent of this specific fix).
create or replace function auth_runner_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from runners where profile_id = auth.uid()
$$;

-- ============================================================
-- 1. profiles
-- ============================================================
alter table profiles enable row level security;
alter table profiles force row level security;

create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or auth_role() = 'admin'
    or (
      auth_role() = 'runner'
      and exists (
        select 1 from orders
        where orders.customer_id = profiles.id
          and orders.status in ('assigned', 'picked_up')
          and orders.runner_id = auth_runner_id()
      )
    )
  );

create policy profiles_update on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Column-level restriction (RBAC_MATRIX.md §5: "restricted at the
-- application/view layer to full_name only") — implemented as a
-- BEFORE UPDATE trigger rejecting changes to any other column, since
-- Postgres column-level GRANTs don't compose cleanly with a single
-- UPDATE statement touching a mix of allowed/disallowed columns the way
-- a trigger check does.
create or replace function reject_profiles_self_edit_beyond_name()
returns trigger language plpgsql as $$
begin
  if new.phone <> old.phone
     or new.wallet_balance <> old.wallet_balance
     or new.referral_code is distinct from old.referral_code
     or new.acquisition_campaign_id is distinct from old.acquisition_campaign_id
  then
    raise exception 'FORBIDDEN: customers may only update full_name' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_self_edit on profiles;
create trigger trg_profiles_self_edit
  before update on profiles
  for each row
  when (auth_role() is not null and auth_role() is distinct from 'admin')
  execute function reject_profiles_self_edit_beyond_name();

-- No INSERT/DELETE policy for any authenticated role — rows are created
-- only by handle_new_user (0002).

-- ============================================================
-- 2. staff_roles — no authenticated policy at all (RBAC_MATRIX §5)
-- ============================================================
alter table staff_roles enable row level security;
alter table staff_roles force row level security;
-- Deliberately zero policies for `authenticated`/`anon`. Reads happen via
-- the Auth Hook (runs as supabase_auth_admin, granted in 0002) and via
-- admin-only Edge Functions using the service role internally, which
-- bypasses RLS by design.

-- ============================================================
-- 3. campaigns
-- ============================================================
alter table campaigns enable row level security;
alter table campaigns force row level security;

create policy campaigns_select on campaigns for select
  using (auth_role() = 'admin');

create policy campaigns_insert on campaigns for insert
  with check (auth_role() = 'admin');

create policy campaigns_update on campaigns for update
  using (auth_role() = 'admin')
  with check (auth_role() = 'admin');

-- ============================================================
-- 4. stores
-- ============================================================
alter table stores enable row level security;
alter table stores force row level security;

create policy stores_select on stores for select using (true);

create policy stores_update on stores for update
  using (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = stores.id))
  with check (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = stores.id));

-- ============================================================
-- 5. zones
-- ============================================================
alter table zones enable row level security;
alter table zones force row level security;

create policy zones_select on zones for select using (true);

create policy zones_insert on zones for insert
  with check (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = zones.store_id));

create policy zones_update on zones for update
  using (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = zones.store_id))
  with check (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = zones.store_id));

-- ============================================================
-- 6. addresses
-- ============================================================
alter table addresses enable row level security;
alter table addresses force row level security;

create policy addresses_select on addresses for select
  using (customer_id = auth.uid() or auth_role() = 'admin');

create policy addresses_insert on addresses for insert
  with check (customer_id = auth.uid());

create policy addresses_update on addresses for update
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

create policy addresses_delete on addresses for delete
  using (customer_id = auth.uid());
-- Admin: SELECT only, per RBAC_MATRIX.md §5 ("never write — an admin
-- should never silently edit where a customer lives").

-- ============================================================
-- 7. products
-- ============================================================
alter table products enable row level security;
alter table products force row level security;

create policy products_select on products for select
  using (
    is_listed = true
    or auth_role() = 'admin'
  );

create policy products_insert on products for insert
  with check (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = products.store_id));

create policy products_update on products for update
  using (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = products.store_id))
  with check (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = products.store_id));

create policy products_delete on products for delete
  using (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = products.store_id));

-- ============================================================
-- 8. inventory — no direct customer SELECT (RBAC_MATRIX §5: "availability
--    is derived" via a joined view, not raw inventory numbers)
-- ============================================================
alter table inventory enable row level security;
alter table inventory force row level security;

create policy inventory_select_packer on inventory for select
  using (
    auth_role() = 'admin'
    or (auth_role() = 'packer' and auth_store_id() = inventory.store_id)
  );

create policy inventory_update_admin on inventory for update
  using (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = inventory.store_id))
  with check (auth_role() = 'admin' and (auth_store_id() is null or auth_store_id() = inventory.store_id));
-- The reserved_not_above_on_hand CHECK (0001) is the backstop even on
-- this "simple" admin manual-count path (RBAC_MATRIX.md §4).

-- Customer-facing availability without exposing exact counts (RBAC_MATRIX
-- §5) — a security-barrier view joined to products, exposing only a
-- boolean, granted to `authenticated`/`anon` directly. Deliberately NOT
-- security_invoker: this view needs to read `inventory` on the
-- customer's behalf, and customers have no SELECT policy on `inventory`
-- at all (by design) — running as the view owner (the default) is what
-- makes that join work. Because that also means this view does NOT
-- automatically inherit `products`' own `is_listed=true` RLS filter for
-- non-admin sessions (owner-context bypasses it the same way it bypasses
-- inventory's policy), the `where` clause below re-implements that one
-- filter explicitly so this view can't accidentally leak unlisted
-- products the way a naive owner-context view would.
create or replace view products_with_availability
  with (security_barrier = true)
as
select
  p.*,
  coalesce((inv.qty_on_hand - inv.qty_reserved) > 0, false) as is_available
from products p
left join inventory inv on inv.store_id = p.store_id and inv.product_id = p.id
where p.is_listed = true;

grant select on products_with_availability to authenticated, anon;

-- ============================================================
-- 9. orders
-- ============================================================
alter table orders enable row level security;
alter table orders force row level security;

create policy orders_select on orders for select
  using (
    customer_id = auth.uid()
    or (auth_role() = 'packer' and store_id = auth_store_id() and status in ('confirmed', 'packed'))
    or (auth_role() = 'runner' and store_id = auth_store_id() and (status = 'packed' or runner_id = auth_runner_id()))
    or auth_role() = 'admin'
  );
-- No INSERT/UPDATE policy for ANY role, including admin (RBAC_MATRIX.md
-- §5: "even admin overrides go through an Edge Function so the state
-- machine trigger and audit log fire consistently"). All writes are
-- service-role only (Edge Functions), which bypasses RLS by design.

-- ============================================================
-- 10. order_items — visibility inherits orders' SELECT policy
-- ============================================================
alter table order_items enable row level security;
alter table order_items force row level security;

create policy order_items_select on order_items for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and (
          o.customer_id = auth.uid()
          or (auth_role() = 'packer' and o.store_id = auth_store_id() and o.status in ('confirmed', 'packed'))
          or (auth_role() = 'runner' and o.store_id = auth_store_id() and (o.status = 'packed' or o.runner_id = auth_runner_id()))
          or auth_role() = 'admin'
        )
    )
  );
-- No writes for anyone — created by create_order, updated only by
-- mark_packed/mark_stock_out (all service-role, Phase 4+).

-- ============================================================
-- 11. payments — 1:1 with orders (D29), restricted columns for customer
-- ============================================================
alter table payments enable row level security;
alter table payments force row level security;

create policy payments_select on payments for select
  using (
    exists (select 1 from orders o where o.id = payments.order_id and o.customer_id = auth.uid())
    or auth_role() = 'admin'
  );
-- No authenticated write policy — create_order/payment_webhook/refund/
-- expire_stale_reservations are all service-role only.

-- IMPORTANT: the base `payments` table is granted to `service_role`
-- ONLY (see the grants block at the end of this file) — deliberately
-- NOT to `authenticated`. Reason: Supabase's model has every client
-- session (customer or admin) connect as the same Postgres role,
-- `authenticated` — the app-role distinction lives entirely in JWT
-- claims read by RLS policies, not in separate Postgres roles. That
-- means a column-level GRANT (which applies to a Postgres role, not a
-- JWT claim) cannot restrict `raw_event`/gateway columns for customers
-- while still allowing them for admins if both share one grant on the
-- base table.
--
-- The fix is NOT security_invoker views: a security_invoker view still
-- requires the CALLING role to hold its own privilege on the underlying
-- table (Postgres checks object privileges against the invoker, not just
-- RLS), so a security_invoker view here would need `authenticated`
-- granted on the base table anyway — reintroducing the exact leak this
-- is meant to prevent. Instead, same pattern as `products_with_
-- availability` above: an owner-context view (default, no security_
-- invoker) that never needs the caller to hold any base-table privilege
-- at all, with row-scoping re-implemented explicitly in the view's own
-- WHERE clause using auth.uid()/auth_role() — those are ordinary
-- function calls that read the real caller's JWT context regardless of
-- the view's security mode, so this is not a privilege leak the way
-- exposing all rows unconditionally would be.
create or replace view payments_customer_view
  with (security_barrier = true)
as
select id, order_id, amount, refunded_amount, status, created_at
from payments p
where exists (select 1 from orders o where o.id = p.order_id and o.customer_id = auth.uid());

create or replace view payments_admin_view
  with (security_barrier = true)
as
select *
from payments
where auth_role() = 'admin';

grant select on payments_customer_view to authenticated;
grant select on payments_admin_view to authenticated;

-- ============================================================
-- 12. refunds
-- ============================================================
alter table refunds enable row level security;
alter table refunds force row level security;

create policy refunds_select on refunds for select
  using (
    exists (
      select 1 from payments p join orders o on o.id = p.order_id
      where p.id = refunds.payment_id and o.customer_id = auth.uid()
    )
    or auth_role() = 'admin'
  );
-- No authenticated write policy — refund + internal reconciliation paths
-- are service-role only.

-- ============================================================
-- 13. webhook_events — no authenticated policy at all
-- ============================================================
alter table webhook_events enable row level security;
alter table webhook_events force row level security;
-- Zero policies: service-role only, by design (RBAC_MATRIX.md §5).

-- ============================================================
-- 14. wallet_ledger
-- ============================================================
alter table wallet_ledger enable row level security;
alter table wallet_ledger force row level security;

create policy wallet_ledger_select on wallet_ledger for select
  using (customer_id = auth.uid() or auth_role() = 'admin');
-- No authenticated write policy — always via an Edge Function, always
-- paired with the profiles.wallet_balance update (D10).

-- ============================================================
-- 15. runners
-- ============================================================
alter table runners enable row level security;
alter table runners force row level security;

create policy runners_select on runners for select
  using (
    profile_id = auth.uid()
    or auth_role() = 'admin'
    or (auth_role() = 'packer' and auth_store_id() = runners.store_id)
  );

create policy runners_update on runners for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create or replace function reject_runners_self_edit_beyond_online()
returns trigger language plpgsql as $$
begin
  if new.profile_id <> old.profile_id or new.store_id <> old.store_id then
    raise exception 'FORBIDDEN: runners may only update is_online' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_runners_self_edit on runners;
create trigger trg_runners_self_edit
  before update on runners
  for each row
  when (auth_role() is not null and auth_role() is distinct from 'admin')
  execute function reject_runners_self_edit_beyond_online();

-- ============================================================
-- 16. runner_earnings
-- ============================================================
alter table runner_earnings enable row level security;
alter table runner_earnings force row level security;

create policy runner_earnings_select on runner_earnings for select
  using (
    exists (select 1 from runners r where r.id = runner_earnings.runner_id and r.profile_id = auth.uid())
    or auth_role() = 'admin'
  );
-- No authenticated writes — created by delivery completion, settled by
-- an admin-triggered Edge Function.

-- ============================================================
-- 17. promos — no direct customer SELECT (validated via Edge Function)
-- ============================================================
alter table promos enable row level security;
alter table promos force row level security;

create policy promos_select_admin on promos for select
  using (auth_role() = 'admin');

create policy promos_insert on promos for insert
  with check (auth_role() = 'admin');

create policy promos_update on promos for update
  using (auth_role() = 'admin')
  with check (auth_role() = 'admin');

create policy promos_delete on promos for delete
  using (auth_role() = 'admin');

-- ============================================================
-- 18. promo_redemptions — no authenticated policy
-- ============================================================
alter table promo_redemptions enable row level security;
alter table promo_redemptions force row level security;
-- Written only by create_order/validate_promo (service role).

create policy promo_redemptions_select_admin on promo_redemptions for select
  using (auth_role() = 'admin');

-- ============================================================
-- 19. audit_logs
-- ============================================================
alter table audit_logs enable row level security;
alter table audit_logs force row level security;

create policy audit_logs_select on audit_logs for select
  using (auth_role() = 'admin');
-- INSERT: service role only (D32) — no authenticated INSERT policy.

-- ============================================================
-- 20. rate_limit_events — service role only
-- ============================================================
alter table rate_limit_events enable row level security;
alter table rate_limit_events force row level security;
-- Zero policies for authenticated/anon — this table exists purely to
-- support rate-limited Edge Functions (verify_delivery_code etc.).

-- ============================================================
-- 21. Base table-level privilege grants
-- ============================================================
-- Current Supabase local/cloud default is to NOT auto-expose newly
-- created tables to anon/authenticated/service_role (config.toml's
-- `auto_expose_new_tables` is unset = false) — RLS policies alone are
-- necessary but not sufficient; without a GRANT, PostgREST gets a
-- permission-denied error before RLS is even evaluated. Every grant
-- below is scoped to exactly the operations RBAC_MATRIX.md §2/§4
-- documents as direct-PostgREST (not Edge-Function-only) for at least
-- one role — an operation that's EF-only everywhere (e.g. any write to
-- `orders`) gets no grant at all, so the RLS-policy-absence and the
-- privilege-absence agree with each other rather than one silently
-- masking the other.
--
-- service_role bypasses RLS entirely (BYPASSRLS) but still needs table
-- privileges to reach a table at all under the new default — granted
-- full access on everything here in one pass rather than repeated per
-- table above, since Edge Functions (service role) are the trusted,
-- already-self-authorizing layer for every table in this schema.
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

grant select on profiles to authenticated;
grant update on profiles to authenticated;

grant select on campaigns to authenticated;
grant insert on campaigns to authenticated;
grant update on campaigns to authenticated;

grant select on stores to anon, authenticated;
grant update on stores to authenticated;

grant select on zones to anon, authenticated;
grant insert, update on zones to authenticated;

grant select, insert, update, delete on addresses to authenticated;

grant select on products to anon, authenticated;
grant insert, update, delete on products to authenticated;

grant select on inventory to authenticated;
grant update on inventory to authenticated;

grant select on orders to authenticated;
-- No insert/update/delete grant on orders for `authenticated` — every
-- write is Edge-Function-only (RBAC_MATRIX.md §4/§5); the RLS policy
-- absence already blocks it, this omission is the matching privilege-
-- layer statement of the same fact.

grant select on order_items to authenticated;

-- payments: no grant to authenticated at all — see the payments section
-- above (§11) for why (views only).

grant select on refunds to authenticated;

grant select on wallet_ledger to authenticated;

grant select on runners to authenticated;
grant update on runners to authenticated;

grant select on runner_earnings to authenticated;

grant select on promos to authenticated;
grant insert, update, delete on promos to authenticated;

grant select on audit_logs to authenticated;

-- staff_roles, webhook_events, promo_redemptions, rate_limit_events: no
-- grant to authenticated/anon at all — service_role only, matching the
-- "zero policies" sections above exactly.
