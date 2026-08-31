-- Payment/order state consistency (D30) — deferred constraint triggers.
-- ORDER_STATE_MACHINE.md §2.1, PHASE_1_1_CORRECTIONS.md §9.
-- Deferred constraints only validate at COMMIT or when explicitly forced
-- via `SET CONSTRAINTS ALL IMMEDIATE` — used throughout this file so
-- failures surface without needing a real commit (this whole file rolls
-- back at the end, per pgTAP convention).
begin;
create extension if not exists pgtap;

select plan(3);  -- positive sweep aggregate, negative sweep aggregate, statement-order scenario

insert into stores (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Test Store');
insert into zones (id, store_id, name, delivery_fee)
  values ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000001', 'Zone A', 1000);
insert into auth.users (id, phone) values ('aaaaaaaa-0000-4000-8000-000000001001', '919990000101');
insert into addresses (id, customer_id, zone_id, block, room) values
  ('aaaaaaaa-0000-4000-8000-000000002001', 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000101', 'Block A', '101');

create temp table sweep_results (sweep text primary key, succeeded int, attempted int);

-- ---- Positive: every valid (orders.status, payments.status) pair in
-- the rules table commits cleanly when forced to check immediately.
do $$
declare
  r record;
  oid uuid;
  succeeded int := 0;
  attempted int := 0;
begin
  for r in select order_status, payment_status from payment_order_consistency_rules loop
    attempted := attempted + 1;
    begin
      oid := gen_random_uuid();
      insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key)
        values (oid, 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', r.order_status, 40, 10, 50, gen_random_uuid());
      insert into payments (order_id, amount, status) values (oid, 50, r.payment_status);
      set constraints all immediate;
      set constraints all deferred;
      succeeded := succeeded + 1;
    exception when others then
      raise notice 'valid pair %/% unexpectedly rejected: %', r.order_status, r.payment_status, sqlerrm;
    end;
  end loop;
  insert into sweep_results values ('positive', succeeded, attempted);
end;
$$;

-- ---- Negative: every (orders.status, payment.status) pair NOT in the
-- rules table is rejected when checked immediately.
do $$
declare
  o_s order_status;
  p_s payment_status;
  oid uuid;
  rejected int := 0;
  attempted int := 0;
  valid boolean;
begin
  for o_s in select unnest(enum_range(null::order_status)) loop
    for p_s in select unnest(enum_range(null::payment_status)) loop
      select exists(select 1 from payment_order_consistency_rules where order_status = o_s and payment_status = p_s) into valid;
      if valid then continue; end if;

      attempted := attempted + 1;
      begin
        oid := gen_random_uuid();
        insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key)
          values (oid, 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', o_s, 40, 10, 50, gen_random_uuid());
        insert into payments (order_id, amount, status) values (oid, 50, p_s);
        set constraints all immediate;
        set constraints all deferred;
        -- reaching here means the invalid pair was NOT rejected
      exception when sqlstate 'P0001' then
        rejected := rejected + 1;
      end;
    end loop;
  end loop;
  insert into sweep_results values ('negative', rejected, attempted);
end;
$$;

select is(
  (select succeeded from sweep_results where sweep = 'positive'),
  (select attempted from sweep_results where sweep = 'positive'),
  format('all %s valid (order_status, payment_status) combinations commit cleanly', (select attempted from sweep_results where sweep = 'positive'))
);

select is(
  (select succeeded from sweep_results where sweep = 'negative'),
  (select attempted from sweep_results where sweep = 'negative'),
  format('all %s invalid (order_status, payment_status) combinations raise PAYMENT_ORDER_STATE_MISMATCH', (select attempted from sweep_results where sweep = 'negative'))
);

-- ---- Realistic scenario: statement order within a transaction should
-- not matter, because the constraint is deferred to commit-check time,
-- not evaluated per-statement (PHASE_1_1_CORRECTIONS.md §9's whole point
-- — an Edge Function writing payments then orders, or orders then
-- payments, in one transaction must both work).
do $$
declare
  oid uuid := gen_random_uuid();
begin
  insert into orders (id, customer_id, store_id, address_id, status, subtotal, delivery_fee, payable, idempotency_key)
    values (oid, 'aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000002001', 'created', 40, 10, 50, gen_random_uuid());
  insert into payments (order_id, amount, status) values (oid, 50, 'pending');
  set constraints all immediate;
  set constraints all deferred;

  -- payments updated FIRST, then orders -- confirmed+captured should be
  -- valid regardless of which table was written first within the txn.
  update payments set status = 'captured' where order_id = oid;
  update orders set status = 'confirmed' where id = oid;
  set constraints all immediate;
end;
$$;
select pass('payments-then-orders write order within one transaction is accepted (statement order does not matter for a deferred constraint)');

select * from finish();
rollback;
