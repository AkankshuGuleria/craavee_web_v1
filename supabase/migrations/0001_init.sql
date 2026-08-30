-- Craavee v2.0 — initial schema
-- Source of truth: docs/engineering/DATABASE_SPEC.md (as amended by
-- docs/engineering/PHASE_1_1_CORRECTIONS.md, decisions D24-D32).
-- Do not hand-edit this file to "make implementation easier" — if the
-- schema needs to change, change DATABASE_SPEC.md first, then this file.
--
-- Tables are declared in dependency order (no forward references), which
-- is why the order here differs from DATABASE_SPEC.md's narrative order
-- (that document explicitly notes campaigns/profiles and runners/orders
-- as forward-reference pairs — resolved here by declaring the referenced
-- table first).

-- ============================================================
-- 1. Extensions
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists citext;

-- ============================================================
-- 2. Enum types (D6 — closed, stable sets only)
-- ============================================================
create type user_role as enum ('packer', 'runner', 'admin');
-- 'customer' is the implicit default: absence from staff_roles = customer.

create type order_status as enum (
  'created', 'confirmed', 'packed', 'assigned', 'picked_up', 'delivered',
  'payment_failed', 'cancelled', 'delivery_failed'
);

create type payment_status as enum (
  'pending', 'captured', 'failed', 'refunded', 'partially_refunded'
);

create type wallet_ledger_reason as enum (
  'promo_credit', 'referral_credit', 'refund', 'manual_adjustment',
  'checkout_redemption', 'reservation_reversal'
);

-- ============================================================
-- 3. Campaigns (hackathon lives here — D22)
-- ============================================================
create table campaigns (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null check (type in ('launch_event', 'referral', 'organic', 'other')),
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  config     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
comment on table campaigns is 'Launch/acquisition campaigns. The hackathon is exactly one row here (type=''launch_event''). No other table branches on campaign existence — see profiles.acquisition_campaign_id and promos.campaign_id, both attribution-only. D22.';

-- ============================================================
-- 4. Stores, zones
-- ============================================================
create table stores (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  is_open         boolean not null default true,
  opens_at        time,
  closes_at       time,
  pause_reason    text,
  max_queue_depth integer not null default 9999,
  created_at      timestamptz not null default now()
);

create table zones (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references stores(id),
  name            text not null,
  delivery_fee    integer not null check (delivery_fee >= 0),
  is_serviceable  boolean not null default true,
  created_at      timestamptz not null default now()
);
create index idx_zones_store on zones(store_id);

-- ============================================================
-- 5. Identity & roles
-- ============================================================
-- One row per Supabase Auth user, for ALL roles (dossier §6: "one
-- authentication system"). Created by handle_new_user (0002_triggers_
-- and_functions.sql), never created directly by client code.
create table profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  phone                   text not null unique,
  full_name               text,
  wallet_balance          integer not null default 0 check (wallet_balance >= 0),
  referral_code           text unique,
  acquisition_campaign_id uuid references campaigns(id),
  created_at              timestamptz not null default now()
);
comment on column profiles.wallet_balance is 'Cached value, D10. Authoritative record is wallet_ledger. Written only inside the same transaction as the corresponding wallet_ledger insert.';

-- Role assignment. Absence of a row = customer (the default). No RLS
-- write policy exists for `authenticated` on this table at all (0003) —
-- the only door in is the assign_staff_role Edge Function (Phase 4+).
create table staff_roles (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references profiles(id) on delete cascade,
  role        user_role not null,
  store_id    uuid references stores(id),  -- null only for admin (all-store scope)
  granted_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  constraint staff_role_store_required
    check (role = 'admin' or store_id is not null)
);

-- Structured campus geography. No free-text delivery address. D15.
create table addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  zone_id     uuid not null references zones(id),
  block       text not null,
  floor       text,
  room        text not null,
  landmark    text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_addresses_customer on addresses(customer_id);

-- ============================================================
-- 6. Catalog & inventory
-- ============================================================
create table products (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id),
  name        text not null,
  brand       text,
  image_url   text,
  mrp         integer not null check (mrp >= 0),
  sale_price  integer not null check (sale_price >= 0),
  unit_label  text,
  category    text not null,
  sort_order  integer not null default 0,
  is_listed   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint sale_price_not_above_mrp check (sale_price <= mrp)
);
create index idx_products_store_category on products(store_id, category) where is_listed;

-- Reservation semantics — D11.
create table inventory (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id),
  product_id    uuid not null references products(id),
  qty_on_hand   integer not null default 0 check (qty_on_hand >= 0),
  qty_reserved  integer not null default 0 check (qty_reserved >= 0),
  created_at    timestamptz not null default now(),
  unique (store_id, product_id),
  constraint reserved_not_above_on_hand check (qty_reserved <= qty_on_hand)
);
-- Available-to-sell = qty_on_hand - qty_reserved, computed at read time.

-- ============================================================
-- 7. Runners (declared before orders — orders.runner_id references
-- runners.id, D28)
-- ============================================================
-- Separate from staff_roles deliberately: is_online is a hot-write field,
-- staff_roles is a rarely-written authorization record.
create table runners (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references profiles(id),
  store_id    uuid not null references stores(id),
  is_online   boolean not null default false,
  joined_at   timestamptz not null default now()
);

-- ============================================================
-- 8. Orders
-- ============================================================
create table orders (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references profiles(id),
  store_id               uuid not null references stores(id),
  address_id             uuid not null references addresses(id),
  runner_id              uuid references runners(id),   -- NOT profiles(id) — D28
  status                 order_status not null default 'created',
  subtotal               integer not null check (subtotal >= 0),
  delivery_fee           integer not null check (delivery_fee >= 0),
  wallet_applied         integer not null default 0 check (wallet_applied >= 0),
  payable                integer not null check (payable >= 0),
  payment_status         payment_status not null default 'pending',
  delivery_code_hash     text,
  idempotency_key        uuid not null unique,
  reservation_expires_at timestamptz not null default (now() + interval '15 minutes'),
  placed_at              timestamptz not null default now(),
  confirmed_at           timestamptz,
  packed_at              timestamptz,
  assigned_at            timestamptz,
  picked_up_at           timestamptz,
  delivered_at           timestamptz,
  cancelled_at           timestamptz,
  cancel_reason          text,
  constraint payable_matches_math
    check (payable = subtotal + delivery_fee - wallet_applied),
  constraint wallet_not_above_total
    check (wallet_applied <= subtotal + delivery_fee)
);
comment on column orders.reservation_expires_at is 'D27. Set once at insert, never extended. Only meaningful while status=''created''.';

create index idx_orders_store_status_placed on orders(store_id, status, placed_at);
create index idx_orders_customer_placed on orders(customer_id, placed_at desc);
create index idx_orders_reservation_expiry on orders(reservation_expires_at) where status = 'created';
create unique index idx_orders_one_live_job_per_runner
  on orders(runner_id) where status in ('assigned', 'picked_up');
-- ^ database-level backstop for "one live job per runner" (D13, D28,
-- dossier §13 guarantee #5).

create table order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     uuid not null references products(id),
  qty            integer not null check (qty > 0),
  unit_price     integer not null check (unit_price >= 0),
  fulfilled_qty  integer not null default 0 check (fulfilled_qty >= 0 and fulfilled_qty <= qty),
  created_at     timestamptz not null default now()
);
create index idx_order_items_order on order_items(order_id);
-- idempotency_key UNIQUE NOT NULL on orders is dossier correctness
-- guarantee #1 (D23).

-- ============================================================
-- 9. Payments, refunds & webhook dedup — redesigned Phase 1.1 (D24, D29)
-- ============================================================
create table payments (
  id                          uuid primary key default gen_random_uuid(),
  order_id                    uuid not null unique references orders(id),
  gateway                     text check (gateway in ('razorpay', 'cashfree')),
  gateway_order_ref           text,
  gateway_payment_ref         text,
  gateway_intent_requested_at timestamptz,
  amount                      integer not null check (amount >= 0),
  refunded_amount             integer not null default 0 check (refunded_amount >= 0),
  status                      payment_status not null default 'pending',
  raw_event                   jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint refunded_not_above_amount check (refunded_amount <= amount),
  unique (gateway, gateway_order_ref),
  unique (gateway, gateway_payment_ref)
);
comment on table payments is 'Strictly 1:1 with orders (order_id UNIQUE, D29) — exactly one row per order, created in create_order Phase A, always. gateway_intent_requested_at is the claim marker preventing duplicate concurrent gateway calls (D24). raw_event MUST be redacted at write time by the writing function (D32) — this migration does not and cannot enforce payload content, only structure.';
create index idx_payments_order on payments(order_id);

create table refunds (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references payments(id),
  amount             integer not null check (amount > 0),
  reason             text not null,
  idempotency_key    uuid not null unique,
  gateway_refund_ref text,
  actor_id           uuid references profiles(id),
  created_at         timestamptz not null default now()
);
comment on table refunds is 'Append-only detail table; payments.refunded_amount is the cached aggregate. Third application of the cached-aggregate + ledger pattern (D29, see also D10 wallet_ledger, D26 promo_redemptions).';
create index idx_refunds_payment on refunds(payment_id);

create table webhook_events (
  id                uuid primary key default gen_random_uuid(),
  gateway           text not null,
  gateway_event_id  text not null,
  payload           jsonb not null,
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (gateway, gateway_event_id)
);
comment on table webhook_events is 'Transport-level dedup, independent of business-logic payment state (dossier correctness guarantee #2). payload MUST be redacted at write time (D32).';

-- ============================================================
-- 10. Wallet ledger
-- ============================================================
create table wallet_ledger (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id),
  delta       integer not null,
  reason      wallet_ledger_reason not null,
  order_id    uuid references orders(id),
  created_at  timestamptz not null default now(),
  constraint delta_not_zero check (delta <> 0)
);
create index idx_wallet_ledger_customer on wallet_ledger(customer_id, created_at desc);

-- ============================================================
-- 11. Runner earnings
-- ============================================================
create table runner_earnings (
  id          uuid primary key default gen_random_uuid(),
  runner_id   uuid not null references runners(id),
  order_id    uuid not null references orders(id),
  amount      integer not null check (amount >= 0),
  settled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index idx_runner_earnings_order on runner_earnings(order_id);
create index idx_runner_earnings_unsettled on runner_earnings(runner_id) where settled_at is null;

-- ============================================================
-- 12. Promos — concurrency-safe design, D26
-- ============================================================
create table promos (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  type            text not null check (type in ('flat', 'percent', 'wallet_credit')),
  value           integer not null check (value >= 0),
  max_uses        integer,
  uses_count      integer not null default 0 check (uses_count >= 0),
  per_user_limit  integer not null default 1,
  valid_from      timestamptz not null,
  valid_to        timestamptz,
  campaign_id     uuid references campaigns(id),
  created_at      timestamptz not null default now(),
  constraint uses_not_above_max check (max_uses is null or uses_count <= max_uses)
);
comment on column promos.uses_count is 'Cached aggregate, D26. Authoritative detail is promo_redemptions. Locking this row (SELECT ... FOR UPDATE) before checking/incrementing is what makes both max_uses and per_user_limit safe under concurrency for ANY per_user_limit value.';

create table promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references promos(id),
  customer_id uuid not null references profiles(id),
  order_id    uuid references orders(id),
  created_at  timestamptz not null default now()
);
create index idx_promo_redemptions_promo_customer on promo_redemptions(promo_id, customer_id);

-- ============================================================
-- 13. Audit log
-- ============================================================
create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id),
  action      text not null,
  entity_type text not null,
  entity_id   uuid not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
comment on table audit_logs is 'Service-role write only (D32). actor_id null only for genuinely system-initiated rows. metadata must never contain a raw gateway payload, card/UPI identifier, or delivery code.';
create index idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index idx_audit_logs_actor on audit_logs(actor_id, created_at desc);

-- ============================================================
-- 14. Rate limiting (supports D14, D18 — no Redis)
-- ============================================================
create table rate_limit_events (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  action      text not null,
  created_at  timestamptz not null default now()
);
create index idx_rate_limit_subject_action_time on rate_limit_events(subject, action, created_at);

-- ============================================================
-- 15. profiles.acquisition_campaign_id forward reference note
-- ============================================================
-- profiles.acquisition_campaign_id already references campaigns(id)
-- directly above since campaigns is declared before profiles in this
-- file (dependency-ordered, unlike DATABASE_SPEC.md's narrative order).
