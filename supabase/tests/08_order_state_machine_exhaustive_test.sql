-- Order state machine: enforce_order_transition()
-- ORDER_STATE_MACHINE.md §2/§3/§4, dossier correctness guarantee #6.
-- Parameterized over order_transition_rules / order_status enum values
-- so this test can't silently drift from the rules table it's checking
-- (TEST_STRATEGY.md §2, guarantee #6).
begin;
create extension if not exists pgtap;

-- Plan = one pass-case per every legal (from,to) pair actually reachable
-- from 'created' in one hop for our fixture, plus a full parameterized
-- sweep of illegal pairs (all_status x all_status minus the legal set),
-- plus a couple of hand-picked actor-mismatch cases.
-- NOTE ON STRUCTURE: the positive and negative sweeps below run inside
-- `DO` blocks so they can loop over order_transition_rules / the full
-- order_status enum in plpgsql. A `DO` block cannot return rows (PERFORM
-- discards them), so each sweep reports as ONE aggregate pgTAP
-- assertion (success_count = attempted_count) rather than one assertion
-- per transition — still a real, per-transition-checked test (a nested
-- BEGIN/EXCEPTION per iteration means one real failure inside the loop
-- is caught and counted, not silently swallowed or left to abort the
-- whole block), just reported as a single TAP line instead of sixteen.
select plan(4);

insert into stores (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Test Store');
insert into zones (id, store_id, name, delivery_fee)
  values ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000001', 'Zone A', 1000);
insert into auth.users (id, phone) values ('aaaaaaaa-0000-4000-8000-000000001001', '9990000101');
insert into addresses (id, customer_id, zone_id, block, room) values
  ('aaaaaaaa-0000-4000-8000-000000002001', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000101', 'Block A', '101');
insert into runners (id, profile_id, store_id) values
  ('aaaaaaaa-0000-4000-8000-000000005101', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001');

-- Results of the two loop-based sweeps are carried out of their DO
-- blocks via a temp table, since a DO block cannot return query rows
-- (PERFORM discards them) — the actual pgTAP assertion runs afterward,
-- at the top level, where its result is a real SELECTed row.
create temp table sweep_results (sweep text primary key, succeeded int, attempted int);

-- ---- Positive: every row in order_transition_rules is individually
-- reachable as a bare (from,to) transition in a 'system' (no jwt)
-- context, i.e. the rules table and the trigger agree with each other.
-- Run as postgres (service-role-equivalent, auth.jwt() is null) so the
-- actor check is skipped and only the (from,to) legality is exercised.
-- Each iteration is wrapped in its own BEGIN/EXCEPTION so one real
-- failure is counted, not left to abort the whole sweep before later
-- rows are tried.
do $$
declare
  r record;
  oid uuid;
  fresh_runner uuid;
  fresh_profile uuid;
  succeeded int := 0;
  attempted int := 0;
begin
  for r in select from_status, to_status from order_transition_rules loop
    attempted := attempted + 1;
    begin
    oid := gen_random_uuid();
    insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key)
      values (oid, 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', r.from_status, 40, 10, 50, gen_random_uuid());
    insert into payments (order_id, amount, status) values (oid, 50,
      (case r.from_status
        when 'created' then 'pending'
        when 'payment_failed' then 'failed'
        when 'cancelled' then 'refunded'
        else 'captured'
      end)::payment_status);
    -- One-live-job-per-runner (D13/D28) means each order that lands in
    -- assigned/picked_up needs its OWN runner, not a shared fixture one
    -- — reusing a single runner across iterations would trip the same
    -- partial unique index this test suite verifies elsewhere (test file
    -- 06), for the wrong reason (test-data collision, not a real bug).
    if r.from_status = 'assigned' or r.to_status = 'assigned' or r.from_status = 'picked_up' or r.to_status = 'delivery_failed' then
      fresh_profile := gen_random_uuid();
      fresh_runner := gen_random_uuid();
      insert into auth.users (id, phone) values (fresh_profile, '9' || lpad((random()*999999999)::bigint::text, 9, '0'));
      insert into runners (id, profile_id, store_id) values (fresh_runner, fresh_profile, 'aaaaaaaa-0000-4000-8000-000000000001');
      update orders set runner_id = fresh_runner where id = oid;
    end if;
    -- Bring payments to a state consistent with the TARGET too, so the
    -- deferred consistency trigger (checked later, at COMMIT/immediate)
    -- won't be what fails this specific transition test.
    if r.to_status in ('confirmed','packed','assigned','picked_up','delivered') then
      update payments set status = 'captured' where order_id = oid;
    elsif r.to_status = 'payment_failed' then
      update payments set status = 'failed' where order_id = oid;
    elsif r.to_status = 'cancelled' and r.from_status = 'created' then
      -- pre-payment cancel (ORDER_STATE_MACHINE.md #3): pending -> failed
      update payments set status = 'failed' where order_id = oid;
    elsif r.to_status = 'cancelled' then
      -- post-payment cancel (#5/#6/#9/#14): captured -> refunded
      update payments set status = 'refunded' where order_id = oid;
    end if;

      update orders set status = r.to_status where id = oid;
      succeeded := succeeded + 1;
    exception when others then
      raise notice 'legal transition %->% unexpectedly failed: %', r.from_status, r.to_status, sqlerrm;
    end;
  end loop;
  insert into sweep_results values ('positive', succeeded, attempted);
end;
$$;

-- ---- Negative: every (from,to) pair NOT in order_transition_rules must
-- be rejected, swept across the full order_status enum cross product.
do $$
declare
  from_s order_status;
  to_s order_status;
  oid uuid;
  rejected_count int := 0;
  attempted_count int := 0;
  legal boolean;
begin
  for from_s in select unnest(enum_range(null::order_status)) loop
    for to_s in select unnest(enum_range(null::order_status)) loop
      if from_s = to_s then continue; end if;
      select exists(select 1 from order_transition_rules where from_status = from_s and to_status = to_s) into legal;
      if legal then continue; end if;

      attempted_count := attempted_count + 1;
      oid := gen_random_uuid();
      begin
        insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key)
          values (oid, 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', from_s, 40, 10, 50, gen_random_uuid());
        insert into payments (order_id, amount, status) values (oid, 50, 'pending');
        update orders set status = to_s where id = oid;
        -- if we get here, the illegal transition was NOT rejected
      exception when sqlstate 'P0001' then
        rejected_count := rejected_count + 1;
      end;
    end loop;
  end loop;
  insert into sweep_results values ('negative', rejected_count, attempted_count);
end;
$$;

select is(
  (select succeeded from sweep_results where sweep = 'positive'),
  (select attempted from sweep_results where sweep = 'positive'),
  format('all %s legal transitions in order_transition_rules succeed', (select attempted from sweep_results where sweep = 'positive'))
);

select is(
  (select succeeded from sweep_results where sweep = 'negative'),
  (select attempted from sweep_results where sweep = 'negative'),
  format('all %s illegal (from,to) pairs are rejected by enforce_order_transition', (select attempted from sweep_results where sweep = 'negative'))
);

-- ---- Actor mismatch: a legal (from,to) pair attempted by the wrong role
--
-- A plain `authenticated`-role client can never reach this check at all
-- for `orders` — there is no UPDATE grant on the table for ANY app role
-- (RBAC_MATRIX.md §5: every order write is Edge-Function-only), so a
-- direct client attempt is already rejected at the privilege layer
-- (42501) regardless of which actor role its JWT claims. That's a
-- *stronger* guarantee than the trigger's actor check, not a gap.
--
-- The actor check's real purpose (ORDER_STATE_MACHINE.md §4) is defense
-- in depth for a service-role-executed write that carries a forwarded
-- caller identity (e.g. an Edge Function auditing which user requested
-- an action while performing the actual write as service role) — so it
-- is exercised here as `postgres` (bypasses RLS and holds every grant,
-- standing in for a service-role connection) WITH a customer's JWT
-- claims still set, simulating exactly that scenario: even a privileged
-- connection cannot use a customer's forwarded identity to justify a
-- packer/runner-only transition.
reset role;
insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key)
  values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 'confirmed', 40, 10, 50, gen_random_uuid());
insert into payments (order_id, amount, status) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 50, 'captured');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001001","role":"customer"}';
-- confirmed->packed is legal only for 'packer', not 'customer'
select throws_ok(
  $$ update orders set status = 'packed' where id = 'aaaaaaaa-0000-4000-8000-0000000000a1' $$,
  'P0001', null,
  'a legal (from,to) pair attempted by the wrong actor role is still rejected, even from a privileged connection carrying that actor''s forwarded identity'
);

reset request.jwt.claims;
insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key)
  values ('aaaaaaaa-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 'packed', 40, 10, 50, gen_random_uuid());
insert into payments (order_id, amount, status) values ('aaaaaaaa-0000-4000-8000-0000000000a2', 50, 'captured');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001001","role":"customer"}';
-- packed->assigned is legal only for 'runner', not 'customer'
select throws_ok(
  $$ update orders set status = 'assigned', runner_id = 'aaaaaaaa-0000-4000-8000-000000005101' where id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$,
  'P0001', null,
  'customer identity cannot justify a runner-only transition even though the (from,to) pair itself is legal'
);

select * from finish();
rollback;
