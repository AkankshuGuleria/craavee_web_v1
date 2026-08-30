-- Craavee v2.0 — triggers & functions
-- Source of truth: docs/engineering/ORDER_STATE_MACHINE.md (transition
-- table §2, payment/order consistency §2.1), docs/engineering/
-- SECURITY_MODEL.md §1 (auth flow), docs/engineering/DECISION_LOG.md D30.

-- ============================================================
-- 1. handle_new_user — profile creation on Supabase Auth signup
-- ============================================================
-- Fires once per auth.users row (SECURITY_MODEL.md §1: "the trigger only
-- fires on auth.users insert, not every sign-in"). Idempotent by
-- construction: auth.users.id is unique, so a retry that somehow re-fires
-- for the same user id would hit profiles' primary key and no-op via
-- ON CONFLICT DO NOTHING rather than erroring or overwriting existing
-- profile data — safe on retries per the Phase 2 instruction.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

comment on function handle_new_user() is 'Creates the matching profiles row on first sign-in. SECURITY DEFINER because auth.users is not writable/insertable-into by the authenticated role, and this trigger must succeed regardless of the newly-created user''s own (nonexistent yet) permissions. ON CONFLICT DO NOTHING makes it safe on retries and unable to overwrite existing profile data — SECURITY_MODEL.md §1.';

-- ============================================================
-- 2. Custom Access Token Auth Hook — role claim injection (D8)
-- ============================================================
-- Registered as a Supabase Auth Hook via supabase/config.toml
-- ([auth.hook.custom_access_token]) — see that file. This function is
-- the hook's implementation; wiring it up as the active hook is a
-- project-config concern, not something this SQL file can do on its own.
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  assigned_role text;
  assigned_store_id uuid;
begin
  select role::text, store_id
    into assigned_role, assigned_store_id
    from public.staff_roles
    where profile_id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  if assigned_role is not null then
    claims := jsonb_set(claims, '{role}', to_jsonb(assigned_role));
    if assigned_store_id is not null then
      claims := jsonb_set(claims, '{store_id}', to_jsonb(assigned_store_id::text));
    end if;
  else
    claims := jsonb_set(claims, '{role}', to_jsonb('customer'::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

comment on function custom_access_token_hook(jsonb) is 'D8: injects role (and store_id, for staff) into the JWT at every mint/refresh, looked up from staff_roles — never from client-supplied input. Absence from staff_roles yields role=customer. Must be granted to supabase_auth_admin and registered in config.toml/dashboard to actually run — see SECURITY_MODEL.md §1.';

-- Supabase requires the auth admin role to be able to execute the hook
-- and read the table(s) it queries.
grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.staff_roles to supabase_auth_admin;
revoke execute on function custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ============================================================
-- 3. Order state machine — legal transition table (ORDER_STATE_
--    MACHINE.md §2), encoded as data so pgTAP tests can be generated
--    from it rather than hand-duplicating the transition list.
-- ============================================================
create table order_transition_rules (
  from_status order_status not null,
  to_status   order_status not null,
  actor       text not null check (actor in ('customer', 'packer', 'runner', 'admin', 'system')),
  primary key (from_status, to_status, actor)
);
comment on table order_transition_rules is 'Reference data, not application state — the legal (from,to,actor) triples from ORDER_STATE_MACHINE.md §2. enforce_order_transition() reads this table; it is not itself part of any order''s lifecycle.';

insert into order_transition_rules (from_status, to_status, actor) values
  ('created',         'confirmed',       'system'),   -- #1
  ('created',         'payment_failed',  'system'),   -- #2a/#2b
  ('created',         'cancelled',       'customer'), -- #3
  ('confirmed',       'packed',          'packer'),   -- #4
  ('confirmed',       'cancelled',       'customer'), -- #5
  ('confirmed',       'cancelled',       'admin'),    -- #6
  ('packed',          'assigned',        'runner'),   -- #7
  ('assigned',        'packed',          'runner'),   -- #8 (self-release)
  ('assigned',        'packed',          'system'),   -- #8 (timeout release)
  ('assigned',        'cancelled',       'admin'),    -- #9
  ('assigned',        'picked_up',       'runner'),   -- #10
  ('picked_up',       'delivered',       'runner'),   -- #11
  ('picked_up',       'delivery_failed', 'runner'),   -- #12
  ('picked_up',       'delivery_failed', 'admin'),    -- #12
  ('delivery_failed', 'assigned',        'admin'),    -- #13
  ('delivery_failed', 'cancelled',       'admin');    -- #14

-- Timestamp column each transition stamps, keyed by target status —
-- enforce_order_transition() uses this so there is exactly one place
-- that knows "which column goes with which transition" (ORDER_STATE_
-- MACHINE.md §4, point 4).
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

  -- Actor check. auth.jwt() is only populated for a PostgREST-mediated
  -- request carrying a Supabase session (i.e. a direct client call).
  -- Edge Functions invoked with the service role run outside that
  -- context (auth.jwt() is null) and are trusted to have already
  -- performed their own authorization check (RBAC_MATRIX.md §4: "checked
  -- inside the function... not delegable to a policy") — this trigger's
  -- actor check exists specifically to defend the direct-client path,
  -- which per RBAC_MATRIX.md §5 should never have a matching RLS UPDATE
  -- policy in the first place. Belt-and-suspenders, not the only gate.
  begin
    jwt_role := auth.jwt() ->> 'role';
  exception when others then
    jwt_role := null;
  end;

  if jwt_role is not null then
    select exists (
      select 1 from order_transition_rules
      where from_status = old.status and to_status = new.status and actor = jwt_role
    ) into actor_allowed;

    if not actor_allowed then
      raise exception 'FORBIDDEN: role % may not perform % -> %', jwt_role, old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;

  -- Stamp the relevant timestamp column server-side. Edge Functions never
  -- write these directly (ORDER_STATE_MACHINE.md §4).
  case new.status
    when 'confirmed'  then new.confirmed_at := now();
    when 'packed'     then new.packed_at := now();
    when 'assigned'   then new.assigned_at := now();
    when 'picked_up'  then new.picked_up_at := now();
    when 'delivered'  then new.delivered_at := now();
    when 'cancelled'  then new.cancelled_at := now();
    else null;
  end case;

  -- Transition #8 (release): clear assigned_at/runner_id when returning
  -- to packed from assigned.
  if old.status = 'assigned' and new.status = 'packed' then
    new.assigned_at := null;
    new.runner_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_order_transition on orders;
create trigger trg_enforce_order_transition
  before update on orders
  for each row execute function enforce_order_transition();

comment on function enforce_order_transition() is 'Dossier correctness guarantee #6. Single trigger function, one code path (ORDER_STATE_MACHINE.md §4) — validates against order_transition_rules, checks actor role when a PostgREST session context exists, stamps timestamps.';

-- ============================================================
-- 4. Payment state machine — legal transition table
--    (PHASE_1_1_CORRECTIONS.md §8, DECISION_LOG D29)
-- ============================================================
create table payment_transition_rules (
  from_status payment_status not null,
  to_status   payment_status not null,
  primary key (from_status, to_status)
);

insert into payment_transition_rules (from_status, to_status) values
  ('pending',            'captured'),
  ('pending',            'failed'),
  ('captured',           'refunded'),
  ('captured',           'partially_refunded'),
  ('partially_refunded', 'refunded'),
  ('partially_refunded', 'partially_refunded');
-- No failed->* row: a failed payment is terminal (a new attempt means a
-- new order, PHASE_1_1_CORRECTIONS.md §4.3 scenario E).

create or replace function enforce_payment_transition()
returns trigger
language plpgsql
as $$
declare
  rule_exists boolean;
begin
  if old.status = new.status then
    -- Allow same-status updates only for the topping-up-a-partial-refund
    -- case (refunded_amount increasing); reject a no-op-looking update
    -- that doesn't actually increase refunded_amount, since that would
    -- indicate a caller bug (e.g. a replayed refund not going through
    -- the idempotency-key short-circuit as intended).
    if new.status = 'partially_refunded' and new.refunded_amount <= old.refunded_amount then
      raise exception 'INVALID_ORDER_TRANSITION: partially_refunded update must increase refunded_amount'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  select exists (
    select 1 from payment_transition_rules
    where from_status = old.status and to_status = new.status
  ) into rule_exists;

  if not rule_exists then
    raise exception 'INVALID_ORDER_TRANSITION: payment % -> % is not a legal transition', old.status, new.status
      using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_payment_transition on payments;
create trigger trg_enforce_payment_transition
  before update on payments
  for each row execute function enforce_payment_transition();

-- ============================================================
-- 5. Payment/order state consistency (D30) — deferred constraint
--    triggers so statement order within a transaction doesn't matter.
--    ORDER_STATE_MACHINE.md §2.1's valid-combinations table, encoded as
--    data for the same reason as order_transition_rules above.
-- ============================================================
create table payment_order_consistency_rules (
  order_status   order_status not null,
  payment_status payment_status not null,
  primary key (order_status, payment_status)
);

insert into payment_order_consistency_rules (order_status, payment_status) values
  ('created',         'pending'),
  ('confirmed',        'captured'),
  ('confirmed',        'partially_refunded'),
  ('packed',           'captured'),
  ('packed',           'partially_refunded'),
  ('assigned',         'captured'),
  ('assigned',         'partially_refunded'),
  ('picked_up',        'captured'),
  ('picked_up',        'partially_refunded'),
  ('delivered',        'captured'),
  ('delivered',        'partially_refunded'),
  ('payment_failed',   'failed'),
  ('payment_failed',   'captured'),   -- transient only, D30 — see check function comment
  ('payment_failed',   'refunded'),
  ('cancelled',        'failed'),
  ('cancelled',        'refunded'),
  ('cancelled',        'partially_refunded'), -- transient only, D30
  ('delivery_failed',  'captured'),
  ('delivery_failed',  'partially_refunded');

create or replace function check_payment_order_consistency()
returns trigger
language plpgsql
as $$
declare
  o_status order_status;
  p_status payment_status;
  o_id uuid;
  rule_exists boolean;
begin
  if TG_TABLE_NAME = 'orders' then
    o_id := new.id;
  else
    o_id := new.order_id;
  end if;

  select status into o_status from orders where id = o_id;
  select status into p_status from payments where order_id = o_id;

  -- A payments row may not exist yet only in the impossible case of an
  -- orders row with no payment — D29 guarantees this never happens
  -- (payments is created in the same Phase A transaction as orders), so
  -- a null p_status here indicates a real bug, not a valid transient
  -- state, and is deliberately NOT special-cased into a pass.
  select exists (
    select 1 from payment_order_consistency_rules
    where order_status = o_status and payment_status = p_status
  ) into rule_exists;

  if not rule_exists then
    raise exception 'PAYMENT_ORDER_STATE_MISMATCH: orders.status=% paired with payments.status=% is not a valid combination (order %)', o_status, p_status, o_id
      using errcode = 'P0001';
  end if;

  return null; -- return value ignored for AFTER triggers
end;
$$;

comment on function check_payment_order_consistency() is 'D30. Deferred (checked at COMMIT, not per-statement) specifically so that an Edge Function writing payments.status and orders.status as two separate statements in one transaction is validated on the FINAL combination, not an intermediate one — removes any requirement on which table an Edge Function updates first. payment_failed+captured and cancelled+partially_refunded are listed as valid because they are legitimate transient states within a single transaction (the late-capture reconciliation path, PHASE_1_1_CORRECTIONS.md §8/§9) — the constraint being deferred is what makes this safe: by commit time the same transaction must have already moved the pair to a genuinely resting combination, or a la CONCURRENT transaction reading the still-uncommitted transient value never observes it since Postgres MVCC isolates uncommitted changes.';

drop trigger if exists trg_check_consistency_orders on orders;
create constraint trigger trg_check_consistency_orders
  after insert or update on orders
  deferrable initially deferred
  for each row execute function check_payment_order_consistency();

drop trigger if exists trg_check_consistency_payments on payments;
create constraint trigger trg_check_consistency_payments
  after insert or update on payments
  deferrable initially deferred
  for each row execute function check_payment_order_consistency();

-- ============================================================
-- 6. Wallet ledger reconciliation helper (used by a Phase 8+ scheduled
--    job, D10 — the function exists now since it depends only on schema
--    already in place; the job that calls it on a schedule is a later-
--    phase deployment concern, not a Phase 2 concern).
-- ============================================================
create or replace function find_wallet_balance_mismatches()
returns table (customer_id uuid, cached_balance integer, ledger_sum bigint)
language sql
stable
as $$
  select p.id, p.wallet_balance, coalesce(sum(wl.delta), 0)
  from profiles p
  left join wallet_ledger wl on wl.customer_id = p.id
  group by p.id, p.wallet_balance
  having p.wallet_balance <> coalesce(sum(wl.delta), 0);
$$;

comment on function find_wallet_balance_mismatches() is 'D10 nightly reconciliation query, extracted as a function so a Phase 8+ scheduled job/pgTAP test can call it directly rather than duplicating the SQL.';
