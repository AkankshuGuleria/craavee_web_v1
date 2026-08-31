-- ============================================================
-- Phase 7 — Runner + last-mile delivery
-- ============================================================
-- Implements the runner half of the operational loop:
--   packed -> assigned -> picked_up -> delivered
-- plus release (assigned -> packed) and admin reassignment.
--
-- Nothing here relaxes an existing guarantee. Every transition still
-- goes through enforce_order_transition (0002); the partial unique index
-- idx_orders_one_live_job_per_runner (0001) remains the one-live-job
-- backstop; RLS from 0003 is unchanged for orders.
--
-- Transitions implemented, by ORDER_STATE_MACHINE.md row:
--   #7  packed          -> assigned         claim_job
--   #8  assigned        -> packed           release_job (runner/admin)
--   #10 assigned        -> picked_up        mark_picked_up
--   #11 picked_up       -> delivered        verify_delivery_code
--   #13 delivery_failed -> assigned         admin_reassign
-- All five already exist in order_transition_rules (0002 §102-110) —
-- this migration adds no new transition rule and no new order_status.


-- ============================================================
-- 1. Delivery code storage
-- ============================================================
-- D14 requires two things that cannot both hold against a single
-- hash-only column: the customer must be able to READ the plaintext
-- code after `assigned` (RBAC_MATRIX.md §5 row "Delivery code
-- (plaintext)": customer = "R (own order, once, after assigned)"), and
-- the code must never be stored in plaintext.
--
-- Resolution (Phase 7 decision, D39): the bcrypt hash stays on
-- orders.delivery_code_hash and remains the ONLY thing verification
-- reads. The plaintext lives in this separate, short-lived table so the
-- customer can be shown it, and is DELETED the moment the code stops
-- being needed (delivered, released, or reassigned away).
--
-- Why a separate table rather than a column on `orders`: 0003 grants
-- `select on orders to authenticated` table-wide, and orders_select
-- already lets a runner read every `packed` row at their store plus
-- their own assignment. A plaintext column on `orders` would therefore
-- be readable by the runner — the exact thing D14 forbids ("the runner
-- only submits a guess; they don't get to read the answer"). With a
-- separate table the runner has no policy at all, so that guarantee is
-- structural rather than a column-grant detail that a later `select *`
-- could quietly undo.
create table order_delivery_codes (
  order_id   uuid primary key references orders(id) on delete cascade,
  code       text not null check (code ~ '^\d{4}$'),
  created_at timestamptz not null default now()
);

comment on table order_delivery_codes is
  'D39 (Phase 7). Plaintext 4-digit delivery code, readable ONLY by the owning customer via RLS. Deleted on delivered/release/reassign. The authoritative value for verification is orders.delivery_code_hash (bcrypt, D14) - never this table.';

alter table order_delivery_codes enable row level security;

-- Customer-only. No runner policy, no packer policy: they cannot read
-- this table at all. Admin is deliberately excluded too - RBAC_MATRIX.md
-- §5 gives admin no read on the plaintext code either.
create policy order_delivery_codes_select on order_delivery_codes for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_delivery_codes.order_id
        and o.customer_id = auth.uid()
    )
  );

-- No authenticated write policy: rows are created and deleted by the
-- Phase 7 functions running as service_role.
grant select on order_delivery_codes to authenticated;


-- ============================================================
-- 2. Runner scope resolution
-- ============================================================
-- The mirror of 0006's assert_fulfilment_actor, for runner-actor
-- operations. Resolves the caller's runners.id from their profile
-- (D28: orders.runner_id references runners.id, never profiles.id) and
-- refuses anything the RBAC matrix does not allow.
--
-- Returns the resolved (role, runner_id). runner_id is null for an
-- admin, who acts on any store's orders without owning a runner row.
create or replace function assert_runner_actor(p_actor_id uuid, p_store_id uuid)
returns table (role user_role, runner_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role     user_role;
  v_store    uuid;
  v_runner   uuid;
begin
  select sr.role, sr.store_id into v_role, v_store
  from staff_roles sr where sr.profile_id = p_actor_id;

  if v_role is null then
    raise exception 'FORBIDDEN: actor is not staff' using errcode = 'P0001';
  end if;

  if v_role = 'admin' then
    return query select v_role, null::uuid;
    return;
  end if;

  if v_role <> 'runner' then
    raise exception 'FORBIDDEN: role % may not perform runner operations', v_role
      using errcode = 'P0001';
  end if;

  if v_store is distinct from p_store_id then
    raise exception 'FORBIDDEN: runner is scoped to a different store' using errcode = 'P0001';
  end if;

  select r.id into v_runner from runners r where r.profile_id = p_actor_id;

  if v_runner is null then
    raise exception 'FORBIDDEN: no runner record for this profile' using errcode = 'P0001';
  end if;

  return query select v_role, v_runner;
end;
$$;

revoke execute on function assert_runner_actor(uuid, uuid) from public, anon, authenticated;
grant  execute on function assert_runner_actor(uuid, uuid) to service_role;


-- ============================================================
-- 3. claim_job  (ORDER_STATE_MACHINE.md #7: packed -> assigned)
-- ============================================================
-- D13's mechanism exactly: SELECT ... FOR UPDATE SKIP LOCKED on the
-- target order. If another runner's claim is mid-flight the row is
-- locked and SKIP LOCKED returns no row - we fail immediately with
-- JOB_ALREADY_CLAIMED rather than waiting, because concurrent job
-- claims are interchangeable (a runner who loses should try the next
-- order instantly, not block).
--
-- Not idempotent, by design (API_CONTRACTS.md §6): claiming is a
-- contest, not a retryable write. A client that times out should GET
-- the order to see whether its own attempt won, not blindly re-POST.
--
-- Three independent defences against a double assignment:
--   1. FOR UPDATE SKIP LOCKED     - loses the race, returns immediately
--   2. the explicit no-live-job check below
--   3. idx_orders_one_live_job_per_runner (0001) - the database backstop
--      that holds even if 1 and 2 both have a bug
create or replace function process_claim_job(
  p_order_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_store_id  uuid;
  v_status    order_status;
  v_role      user_role;
  v_runner    uuid;
  v_online    boolean;
  v_locked    uuid;
  v_code      text;
  v_summary   text;
  v_address   jsonb;
begin
  -- Edge Functions run as service_role with no JWT context; make that
  -- explicit so enforce_order_transition takes its "trusted caller,
  -- already authorized" branch rather than reading a stale claim.
  -- Same pattern as process_mark_packed / process_refund.
  perform set_config('request.jwt.claims', '{}', true);

  -- ---- Step 1: read the order's store WITHOUT locking, so an
  -- unauthorized caller is rejected before we take any lock at all.
  select store_id, status into v_store_id, v_status
  from orders where id = p_order_id;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  -- ---- Step 2: authorization, resolved from staff_roles and runners -
  -- never from the request body (§8, §22).
  select ar.role, ar.runner_id into v_role, v_runner
  from assert_runner_actor(p_actor_id, v_store_id) ar;

  -- An admin has no runners.id and therefore nothing to claim *as*.
  -- Admin assignment is admin_reassign's job, not claim_job's.
  if v_role <> 'runner' then
    raise exception 'FORBIDDEN: only a runner may claim a job' using errcode = 'P0001';
  end if;

  -- ---- Step 3: the runner must be on shift. RBAC_MATRIX.md §5 gives
  -- the runner update rights on their own runners.is_online precisely so
  -- this can be an authorization input rather than a UI-only flag.
  select is_online into v_online from runners where id = v_runner;
  if not v_online then
    raise exception 'FORBIDDEN: runner is not online' using errcode = 'P0001';
  end if;

  -- ---- Step 4: does this runner already hold a live job? Checked
  -- before the claim attempt so the common case returns the precise
  -- error; the partial unique index still catches a true race.
  if exists (
    select 1 from orders
    where runner_id = v_runner and status in ('assigned', 'picked_up')
  ) then
    raise exception 'RUNNER_ALREADY_ASSIGNED: runner already has a live job'
      using errcode = 'P0001';
  end if;

  -- ---- Step 5: D13's contested lock. `skip locked` means a row another
  -- transaction is already claiming simply is not returned to us.
  select id into v_locked
  from orders
  where id = p_order_id and status = 'packed'
  for update skip locked;

  if v_locked is null then
    -- Either someone else holds the lock right now, or the order is no
    -- longer `packed`. Both are the same thing to the caller: they lost.
    raise exception 'JOB_ALREADY_CLAIMED: this job is no longer claimable'
      using errcode = 'P0001';
  end if;

  -- ---- Step 6: mint the delivery code. pgcrypto lives in the
  -- `extensions` schema on Supabase, and these functions deliberately
  -- run with `search_path = public`, so crypt/gen_salt are qualified
  -- explicitly rather than widening the path. Generated here, at the moment
  -- of assignment (D14: "generated server-side when the order
  -- transitions to assigned"), never earlier - an unclaimed order has no
  -- code to leak.
  v_code := lpad((floor(random() * 10000))::int::text, 4, '0');

  update orders
     set delivery_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf')),
         status             = 'assigned',
         runner_id          = v_runner
   where id = p_order_id;
  -- assigned_at is stamped by enforce_order_transition, not here.

  -- Plaintext for the customer only (see §1). Upsert rather than insert:
  -- an order released and re-claimed gets a fresh code in the same row.
  insert into order_delivery_codes (order_id, code)
  values (p_order_id, v_code)
  on conflict (order_id) do update
    set code = excluded.code, created_at = now();

  -- ---- Step 7: audit. NEVER the code itself - audit_logs' own comment
  -- forbids it ("metadata must never contain ... a delivery code").
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'order.assigned', 'order', p_order_id,
          jsonb_build_object('runnerId', v_runner, 'storeId', v_store_id));

  -- ---- Step 8: the delivery payload. Deliberately narrow (§16):
  -- enough to complete the drop, nothing about money or the customer's
  -- wallet/profile beyond the name RBAC_MATRIX.md §5 allows.
  select jsonb_build_object(
           'block', a.block, 'floor', a.floor, 'room', a.room,
           'landmark', a.landmark, 'zoneName', z.name)
    into v_address
    from orders o
    join addresses a on a.id = o.address_id
    left join zones z on z.id = a.zone_id
   where o.id = p_order_id;

  select string_agg(p.name || ' x' || oi.qty, ', ' order by p.name)
    into v_summary
    from order_items oi join products p on p.id = oi.product_id
   where oi.order_id = p_order_id;

  return jsonb_build_object(
    'orderId', p_order_id,
    'status', 'assigned',
    'address', coalesce(v_address, '{}'::jsonb),
    'itemSummary', coalesce(v_summary, '')
  );
end;
$$;

revoke execute on function process_claim_job(uuid, uuid) from public, anon, authenticated;
grant  execute on function process_claim_job(uuid, uuid) to service_role;


-- ============================================================
-- 4. mark_picked_up  (#10: assigned -> picked_up)
-- ============================================================
-- Only the assigned runner, or an admin override. A repeat call after
-- the transition already happened returns {alreadyPickedUp:true} rather
-- than raising - API_CONTRACTS.md §6 accepts INVALID_ORDER_TRANSITION
-- here, but a double-tap on a phone is common enough that the safe,
-- non-destructive answer is better and costs nothing.
create or replace function process_mark_picked_up(
  p_order_id uuid,
  p_actor_id uuid
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
  perform set_config('request.jwt.claims', '{}', true);

  select store_id, status, runner_id into v_store_id, v_status, v_order_run
  from orders where id = p_order_id for update;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  select ar.role, ar.runner_id into v_role, v_runner
  from assert_runner_actor(p_actor_id, v_store_id) ar;

  -- Ownership, not just role. A runner acting on another runner's order
  -- is rejected even though their role is correct (ORDER_STATE_MACHINE.md
  -- §3, last row - D28).
  if v_role = 'runner' and v_order_run is distinct from v_runner then
    raise exception 'FORBIDDEN: not the assigned runner' using errcode = 'P0001';
  end if;

  if v_status = 'picked_up' then
    return jsonb_build_object('orderId', p_order_id, 'status', 'picked_up', 'alreadyPickedUp', true);
  end if;

  if v_status <> 'assigned' then
    raise exception 'INVALID_ORDER_TRANSITION: % -> picked_up is not a legal transition', v_status
      using errcode = 'P0001';
  end if;

  update orders set status = 'picked_up' where id = p_order_id;

  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'order.picked_up', 'order', p_order_id,
          jsonb_build_object('runnerId', v_order_run, 'role', v_role));

  return jsonb_build_object('orderId', p_order_id, 'status', 'picked_up');
end;
$$;

revoke execute on function process_mark_picked_up(uuid, uuid) from public, anon, authenticated;
grant  execute on function process_mark_picked_up(uuid, uuid) to service_role;


-- ============================================================
-- 5. release_job  (#8: assigned -> packed)
-- ============================================================
-- The runner gives the job back before pickup, or an admin takes it off
-- them. enforce_order_transition clears runner_id and assigned_at
-- itself (0002 §181-184), so this function does not write them.
--
-- Scope note: this is assigned -> packed ONLY. `picked_up` has no legal
-- path back to `packed` in ORDER_STATE_MACHINE.md - once the runner
-- physically holds the bag the only exits are `delivered` and
-- `delivery_failed`. A runner who has picked up and cannot deliver
-- therefore needs mark_delivery_failed, which Phase 7's scope excludes.
-- Reported rather than papered over by inventing a transition.
create or replace function process_release_job(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason   text default null
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
  perform set_config('request.jwt.claims', '{}', true);

  select store_id, status, runner_id into v_store_id, v_status, v_order_run
  from orders where id = p_order_id for update;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  select ar.role, ar.runner_id into v_role, v_runner
  from assert_runner_actor(p_actor_id, v_store_id) ar;

  if v_role = 'runner' and v_order_run is distinct from v_runner then
    raise exception 'FORBIDDEN: not the assigned runner' using errcode = 'P0001';
  end if;

  -- Idempotent replay: already back in the queue.
  if v_status = 'packed' then
    return jsonb_build_object('orderId', p_order_id, 'status', 'packed', 'alreadyReleased', true);
  end if;

  if v_status <> 'assigned' then
    raise exception 'INVALID_ORDER_TRANSITION: % -> packed is not a legal transition', v_status
      using errcode = 'P0001';
  end if;

  update orders set status = 'packed' where id = p_order_id;

  -- The code minted for the previous runner must not survive the
  -- release - the next claim mints a fresh one.
  delete from order_delivery_codes where order_id = p_order_id;
  update orders set delivery_code_hash = null where id = p_order_id;

  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'order.released', 'order', p_order_id,
          jsonb_build_object('releasedRunnerId', v_order_run, 'role', v_role,
                             'reason', p_reason));

  return jsonb_build_object('orderId', p_order_id, 'status', 'packed');
end;
$$;

revoke execute on function process_release_job(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function process_release_job(uuid, uuid, text) to service_role;


-- ============================================================
-- 6. verify_delivery_code  (#11: picked_up -> delivered)
-- ============================================================
-- API_CONTRACTS.md §3 `verify_delivery_code`, followed exactly:
--   * check rate_limit_events for >=5 'delivery_code_attempt' rows for
--     this order in the last 15 minutes BEFORE comparing the hash;
--     exceeded => RATE_LIMITED regardless of whether the code is right
--   * every attempt, right or wrong, writes a rate_limit_events row
--     FIRST, then compares
--   * on match: delivered + runner_earnings insert + audit, one txn
--   * on mismatch: no state change, DELIVERY_CODE_INVALID, attempt logged
--
-- The 4-digit space is 10,000 wide, so the limit is what makes the code
-- safe at all (D14). subject = order_id, so the budget is per-order:
-- burning attempts on one order never locks a runner out of another.
--
-- The plaintext is never read here. Verification is purely
-- crypt(guess, hash) = hash against orders.delivery_code_hash, so
-- deleting the order_delivery_codes row does not weaken it.
create or replace function process_verify_delivery_code(
  p_order_id uuid,
  p_actor_id uuid,
  p_code     text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_store_id  uuid;
  v_status    order_status;
  v_order_run uuid;
  v_hash      text;
  v_fee       integer;
  v_role      user_role;
  v_runner    uuid;
  v_attempts  integer;
begin
  perform set_config('request.jwt.claims', '{}', true);

  select store_id, status, runner_id, delivery_code_hash, delivery_fee
    into v_store_id, v_status, v_order_run, v_hash, v_fee
  from orders where id = p_order_id for update;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  -- Authorization before anything else, so an unauthorized caller can
  -- neither burn another order's attempt budget nor learn its state.
  select ar.role, ar.runner_id into v_role, v_runner
  from assert_runner_actor(p_actor_id, v_store_id) ar;

  if v_role = 'runner' and v_order_run is distinct from v_runner then
    raise exception 'FORBIDDEN: not the assigned runner' using errcode = 'P0001';
  end if;

  -- ---- Rate limit, checked before the comparison.
  select count(*) into v_attempts
  from rate_limit_events
  where subject = p_order_id::text
    and action = 'delivery_code_attempt'
    and created_at > now() - interval '15 minutes';

  -- NOTE: rate-limit and wrong-code outcomes are RETURNED, not raised.
  -- A `raise` aborts the transaction, which would roll back the
  -- rate_limit_events row we just wrote - so a wrong guess would cost
  -- the attacker nothing and the 5-attempt ceiling would be decorative.
  -- Returning lets the attempt log commit. The Edge Function turns these
  -- into the canonical RATE_LIMITED / DELIVERY_CODE_INVALID responses,
  -- so the API contract is unchanged. State-machine and authorization
  -- failures still raise, because those must not commit anything.
  if v_attempts >= 5 then
    return jsonb_build_object('orderId', p_order_id, 'error', 'RATE_LIMITED');
  end if;

  -- Logged before comparing, so a wrong guess costs an attempt even if
  -- the transaction later raises.
  insert into rate_limit_events (subject, action)
  values (p_order_id::text, 'delivery_code_attempt');

  -- ---- Idempotent replay: already delivered. Returned only to the
  -- runner who actually delivered it (ownership was checked above).
  if v_status = 'delivered' then
    return jsonb_build_object('orderId', p_order_id, 'status', 'delivered', 'alreadyDelivered', true);
  end if;

  if v_status <> 'picked_up' then
    raise exception 'INVALID_ORDER_TRANSITION: % -> delivered is not a legal transition', v_status
      using errcode = 'P0001';
  end if;

  if v_hash is null or extensions.crypt(p_code, v_hash) <> v_hash then
    return jsonb_build_object('orderId', p_order_id, 'error', 'DELIVERY_CODE_INVALID');
  end if;

  update orders set status = 'delivered' where id = p_order_id;

  -- Earnings. The formula itself is explicitly deferred by
  -- ENGINEERING_SPECIFICATION.md ("a pricing decision, not an
  -- architecture one"), so this uses the order's delivery_fee as a
  -- documented placeholder. idx_runner_earnings_order is UNIQUE on
  -- order_id, so a concurrent second verification cannot double-credit.
  insert into runner_earnings (runner_id, order_id, amount)
  values (v_order_run, p_order_id, coalesce(v_fee, 0))
  on conflict (order_id) do nothing;

  -- The code has done its job; the customer no longer needs to see it.
  delete from order_delivery_codes where order_id = p_order_id;

  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'order.delivered', 'order', p_order_id,
          jsonb_build_object('runnerId', v_order_run, 'role', v_role));

  return jsonb_build_object('orderId', p_order_id, 'status', 'delivered');
end;
$$;

revoke execute on function process_verify_delivery_code(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function process_verify_delivery_code(uuid, uuid, text) to service_role;


-- ============================================================
-- 7. admin_reassign  (#13, plus the same-status runner swap)
-- ============================================================
-- API_CONTRACTS.md: `{ orderId, runnerId? }` where runnerId is a
-- runners.id (D28); omitting it releases to the general claim queue
-- instead of naming a runner.
--
-- Three shapes, all admin-only:
--   a) delivery_failed -> assigned   re-attempt (#13), runnerId required
--   b) assigned        -> assigned   swap runner A for runner B.
--                                    NOT a status transition, so
--                                    enforce_order_transition returns
--                                    early (0002 §125) and does not
--                                    validate it - which is exactly why
--                                    the ownership and busy checks below
--                                    live here, and why the partial
--                                    unique index matters as the backstop.
--   c) runnerId omitted -> release   assigned -> packed, via the same
--                                    path release_job uses.
create or replace function process_admin_reassign(
  p_order_id  uuid,
  p_actor_id  uuid,
  p_runner_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_store_id   uuid;
  v_status     order_status;
  v_order_run  uuid;
  v_role       user_role;
  v_new_store  uuid;
  v_code       text;
begin
  perform set_config('request.jwt.claims', '{}', true);

  select store_id, status, runner_id into v_store_id, v_status, v_order_run
  from orders where id = p_order_id for update;

  if not found then
    raise exception 'VALIDATION_FAILED: no such order' using errcode = 'P0001';
  end if;

  select sr.role into v_role from staff_roles sr where sr.profile_id = p_actor_id;

  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN: admin role required' using errcode = 'P0001';
  end if;

  -- ---- Shape (c): no target runner => release back to the queue.
  if p_runner_id is null then
    if v_status <> 'assigned' then
      raise exception 'INVALID_ORDER_TRANSITION: % -> packed is not a legal transition', v_status
        using errcode = 'P0001';
    end if;
    update orders set status = 'packed' where id = p_order_id;
    delete from order_delivery_codes where order_id = p_order_id;
    update orders set delivery_code_hash = null where id = p_order_id;

    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (p_actor_id, 'order.released', 'order', p_order_id,
            jsonb_build_object('releasedRunnerId', v_order_run, 'role', 'admin',
                               'reason', 'admin_reassign_to_queue'));

    return jsonb_build_object('orderId', p_order_id, 'status', 'packed');
  end if;

  -- ---- Target runner must exist and be at this order's store. Store
  -- scope survives reassignment (§14).
  select store_id into v_new_store from runners where id = p_runner_id;
  if v_new_store is null then
    raise exception 'VALIDATION_FAILED: no such runner' using errcode = 'P0001';
  end if;
  if v_new_store is distinct from v_store_id then
    raise exception 'FORBIDDEN: target runner belongs to a different store' using errcode = 'P0001';
  end if;

  -- ---- The target must be free. Checked explicitly so the caller gets
  -- RUNNER_ALREADY_ASSIGNED rather than a raw unique-violation; the
  -- index still backstops a concurrent claim that slips in between.
  if exists (
    select 1 from orders
    where runner_id = p_runner_id
      and status in ('assigned', 'picked_up')
      and id <> p_order_id
  ) then
    raise exception 'RUNNER_ALREADY_ASSIGNED: target runner already has a live job'
      using errcode = 'P0001';
  end if;

  if v_status not in ('assigned', 'delivery_failed') then
    raise exception 'INVALID_ORDER_TRANSITION: % -> assigned is not a legal transition', v_status
      using errcode = 'P0001';
  end if;

  -- Reassigning to the runner who already holds it is a no-op, not an error.
  if v_status = 'assigned' and v_order_run = p_runner_id then
    return jsonb_build_object('orderId', p_order_id, 'status', 'assigned', 'unchanged', true);
  end if;

  -- ---- The new runner needs a code the customer also holds, and the
  -- previous runner's code must stop working. Mint a fresh one either
  -- way, so a reassignment never leaves the old runner able to complete
  -- a delivery they no longer own.
  v_code := lpad((floor(random() * 10000))::int::text, 4, '0');

  update orders
     set runner_id          = p_runner_id,
         status             = 'assigned',
         delivery_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf'))
   where id = p_order_id;

  insert into order_delivery_codes (order_id, code)
  values (p_order_id, v_code)
  on conflict (order_id) do update
    set code = excluded.code, created_at = now();

  -- A same-status swap does not re-stamp assigned_at via the trigger
  -- (it returns early), so stamp it here - the assignment genuinely is new.
  if v_status = 'assigned' then
    update orders set assigned_at = now() where id = p_order_id;
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'order.reassigned', 'order', p_order_id,
          jsonb_build_object('fromRunnerId', v_order_run, 'toRunnerId', p_runner_id,
                             'fromStatus', v_status));

  return jsonb_build_object('orderId', p_order_id, 'status', 'assigned',
                            'runnerId', p_runner_id);
end;
$$;

revoke execute on function process_admin_reassign(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function process_admin_reassign(uuid, uuid, uuid) to service_role;


-- ============================================================
-- 8. Runner queue index
-- ============================================================
-- The queue reads "packed orders at my store, oldest first". 0001's
-- idx_orders_store_status_placed(store_id, status, placed_at) already
-- serves exactly that prefix, so no new index is added here - see the
-- Phase 7 report's performance section for the plan confirming it.


-- ============================================================
-- 9. Runner access to the delivery address
-- ============================================================
-- RBAC_MATRIX.md §5, "Other profiles" row: a runner gets
-- "own store's ACTIVE order's customer name + address only, via orders
-- join". 0003's addresses_select is customer-or-admin, so without this
-- a runner cannot see where to deliver.
--
-- Deliberately scoped to the order they are actually working
-- (`assigned`/`picked_up`, and only their own runners.id), NOT to the
-- claimable queue. A runner browsing open jobs has no need for anyone's
-- address yet, and showing every unclaimed customer's door to every
-- runner at the store would be a real privacy expansion for no
-- operational gain - the queue shows the item count and the address
-- arrives with the claim.
create policy addresses_select_runner_active on addresses for select
  using (
    auth_role() = 'runner'
    and exists (
      select 1 from orders o
      where o.address_id = addresses.id
        and o.runner_id = auth_runner_id()
        and o.status in ('assigned', 'picked_up')
    )
  );
