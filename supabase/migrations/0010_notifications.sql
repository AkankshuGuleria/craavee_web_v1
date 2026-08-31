-- ============================================================
-- Phase 8, Part C — push notifications
-- ============================================================
-- ENGINEERING_SPECIFICATION.md §14: `expo-notifications`, fired from the
-- state transition (ORDER_STATE_MACHINE.md §2's "Notification" column),
-- never from client-side inference. **Notifications are never the system
-- of record** - a failed push has zero effect on orders/payments/wallet,
-- and the customer's next poll shows the truth regardless.
--
-- Event path (§16): a status change writes an outbox row IN THE SAME
-- TRANSACTION as the change itself, so an event cannot exist for a state
-- that never happened, and a state change cannot silently fail to
-- produce one. A separate dispatcher drains the outbox and does the
-- network I/O - no HTTP inside a database transaction (D24's rule).
--
--   orders UPDATE  ->  trigger  ->  notification_outbox  ->  dispatcher  ->  Expo
--
-- Driven by a trigger rather than by editing each process_* function on
-- purpose: every transition is covered by construction, including ones
-- added later, and no already-merged migration is touched.


-- ============================================================
-- 1. Push tokens
-- ============================================================
-- One row per device. A profile may have several (§14: multiple devices);
-- a token belongs to exactly one profile, and re-registering a token that
-- moved to a different account reassigns it rather than duplicating -
-- Expo reuses a token across a reinstall on the same device.
create table push_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index idx_push_tokens_profile on push_tokens(profile_id);

comment on table push_tokens is
  'Expo push tokens, one row per device. A client can only ever see/delete its own rows; assignment is done server-side from the JWT so a client cannot register a token against another profile (Phase 8 §14).';

alter table push_tokens enable row level security;

-- Read and delete own rows only. There is deliberately NO insert/update
-- policy: registration goes through the register_push_token Edge
-- Function, which sets profile_id from the verified JWT. That is what
-- makes "never trust a client to assign a token to another profile"
-- (§14) structural rather than a convention.
create policy push_tokens_select on push_tokens for select
  using (profile_id = auth.uid());

-- Logout should be able to drop this device's token without a round trip.
create policy push_tokens_delete on push_tokens for delete
  using (profile_id = auth.uid());

grant select, delete on push_tokens to authenticated;


-- ============================================================
-- 2. Notification outbox
-- ============================================================
-- UNIQUE (order_id, event) is the whole idempotency story (§17): a
-- retried transition, a replayed webhook or a duplicate Edge Function
-- call cannot enqueue the same notification twice, because the second
-- insert simply does nothing. No new infrastructure, no dedupe service.
create table notification_outbox (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  event      text not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   integer not null default 0,
  last_error text,
  constraint notification_outbox_once unique (order_id, event)
);
create index idx_notification_outbox_unsent on notification_outbox(created_at) where sent_at is null;

comment on table notification_outbox is
  'Phase 8 §16/§17. One row per (order, event), written in the same transaction as the state change it describes. UNIQUE(order_id,event) makes a retried event a no-op. Payload is title/body only - never a delivery code, money figure, token or secret (§15).';

alter table notification_outbox enable row level security;
-- Service role only: no authenticated policy at all. A customer has no
-- reason to read the queue, and staff certainly do not.
grant select, insert, update on notification_outbox to service_role;


-- ============================================================
-- 3. The trigger that turns a state change into an event
-- ============================================================
-- Copy is written for a lock screen (§15): it says what happened and
-- nothing else. No delivery code, no amount, no address, no runner name.
create or replace function enqueue_order_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  v_title text;
  v_body  text;
begin
  if old.status = new.status then
    return new;
  end if;

  case new.status
    when 'confirmed' then
      v_event := 'order.confirmed';
      v_title := 'Order confirmed';
      v_body  := 'We''re getting your order ready.';
    when 'packed' then
      v_event := 'order.packed';
      v_title := 'Order packed';
      v_body  := 'Your order is packed and waiting for a runner.';
    when 'assigned' then
      v_event := 'order.assigned';
      v_title := 'Runner assigned';
      v_body  := 'A runner is on the way to collect your order.';
    when 'picked_up' then
      v_event := 'order.picked_up';
      v_title := 'On its way';
      v_body  := 'Your order has been picked up.';
    when 'delivered' then
      v_event := 'order.delivered';
      v_title := 'Delivered';
      v_body  := 'Enjoy! Your order has arrived.';
    when 'delivery_failed' then
      v_event := 'order.delivery_failed';
      v_title := 'We couldn''t deliver your order';
      v_body  := 'Support will reach out shortly.';
    when 'payment_failed' then
      v_event := 'order.payment_failed';
      v_title := 'Payment failed';
      v_body  := 'Your payment didn''t go through. Please try again.';
    when 'cancelled' then
      v_event := 'order.cancelled';
      v_title := 'Order cancelled';
      v_body  := 'Your order was cancelled.';
    else
      return new;
  end case;

  -- ON CONFLICT DO NOTHING is the idempotency guarantee. It also means a
  -- legitimate second visit to the same status (packed -> assigned ->
  -- packed -> assigned after a release) does not re-notify, which is the
  -- behaviour we want: the customer already knows a runner was assigned.
  insert into notification_outbox (order_id, event, profile_id, title, body)
  values (new.id, v_event, new.customer_id, v_title, v_body)
  on conflict on constraint notification_outbox_once do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_order_notification on orders;
create trigger trg_enqueue_order_notification
  after update on orders
  for each row execute function enqueue_order_notification();


-- ============================================================
-- 4. Token registration
-- ============================================================
-- profile_id comes from the caller the Edge Function verified, never
-- from the request body. Re-registering an existing token moves it to
-- the current profile and refreshes last_seen_at, which covers both
-- token refresh and a shared device (§14).
create or replace function process_register_push_token(
  p_profile_id uuid,
  p_token      text,
  p_platform   text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_attempts integer;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'VALIDATION_FAILED: token is required' using errcode = 'P0001';
  end if;
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'VALIDATION_FAILED: unknown platform' using errcode = 'P0001';
  end if;

  -- §25: reuse the existing rate-limit table, no new infrastructure.
  -- Registration is idempotent and cheap, so the ceiling is generous -
  -- it exists to stop a loop, not to police normal use.
  select count(*) into v_attempts
  from rate_limit_events
  where subject = p_profile_id::text
    and action = 'push_token_register'
    and created_at > now() - interval '1 minute';

  if v_attempts >= 20 then
    return jsonb_build_object('error', 'RATE_LIMITED');
  end if;

  insert into rate_limit_events (subject, action) values (p_profile_id::text, 'push_token_register');

  insert into push_tokens (profile_id, token, platform)
  values (p_profile_id, btrim(p_token), p_platform)
  on conflict (token) do update
    set profile_id = excluded.profile_id,
        platform = excluded.platform,
        last_seen_at = now();

  return jsonb_build_object('registered', true);
end;
$$;

revoke execute on function process_register_push_token(uuid, text, text) from public, anon, authenticated;
grant  execute on function process_register_push_token(uuid, text, text) to service_role;


-- ============================================================
-- 5. Dispatcher support
-- ============================================================
-- Claims a batch of unsent rows and returns them with their target
-- tokens. `for update skip locked` means two dispatcher runs can never
-- pick up the same row, so a retry or an overlapping invocation cannot
-- double-send.
create or replace function claim_notification_batch(p_limit integer default 50)
returns table (
  outbox_id uuid,
  order_id  uuid,
  event     text,
  title     text,
  body      text,
  token     text,
  platform  text
)
language plpgsql
set search_path = public
as $$
begin
  return query
  with claimed as (
    select o.id
    from notification_outbox o
    where o.sent_at is null and o.attempts < 5
    order by o.created_at
    limit p_limit
    for update skip locked
  ), bumped as (
    update notification_outbox n
       set attempts = n.attempts + 1
      from claimed c
     where n.id = c.id
    returning n.id, n.order_id, n.event, n.title, n.body, n.profile_id
  )
  select b.id, b.order_id, b.event, b.title, b.body, t.token, t.platform
  from bumped b
  join push_tokens t on t.profile_id = b.profile_id;
end;
$$;

revoke execute on function claim_notification_batch(integer) from public, anon, authenticated;
grant  execute on function claim_notification_batch(integer) to service_role;

create or replace function mark_notification_sent(p_outbox_id uuid, p_error text default null)
returns void
language sql
set search_path = public
as $$
  update notification_outbox
     set sent_at = case when p_error is null then now() else sent_at end,
         last_error = p_error
   where id = p_outbox_id;
$$;

revoke execute on function mark_notification_sent(uuid, text) from public, anon, authenticated;
grant  execute on function mark_notification_sent(uuid, text) to service_role;

-- Expo tells us when a token is dead; §14 requires cleaning those up.
create or replace function delete_push_token(p_token text)
returns void
language sql
set search_path = public
as $$
  delete from push_tokens where token = p_token;
$$;

revoke execute on function delete_push_token(text) from public, anon, authenticated;
grant  execute on function delete_push_token(text) to service_role;
