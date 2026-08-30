# Database Specification

Target Postgres schema for Craavee v2.0, designed from scratch (see
`DECISION_LOG.md` D17 — no compatibility migration from the old SQLite-
flavored file, which is retired outright). This is a design document, not
an applied migration — Phase 2 turns this into `supabase/migrations/
0001_init.sql`.

Conventions locked in `DECISION_LOG.md`: UUID PKs (D5), enum vs.
text+CHECK split (D6), integer-paise money (D7), `store_id` on every
store-scoped row (dossier §11/§5, prompt §5).

---

## 1. Extensions

```sql
create extension if not exists pgcrypto;   -- gen_random_uuid(), crypt()
create extension if not exists citext;     -- case-insensitive phone/email compares if needed
```

## 2. Enum types (D6 — closed, stable sets only)

```sql
create type user_role as enum ('packer', 'runner', 'admin');
-- 'customer' is the implicit default: absence from staff_roles = customer.
-- Not itself an enum value, to keep "customer" as "not staff" rather than
-- a fourth peer value staff_roles would otherwise need a NULL-role row for.

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
-- 'reservation_reversal' added Phase 1.1 (DECISION_LOG D27): a wallet
-- debit given back because payment setup never completed (gateway
-- failure, timeout, or reservation expiry) — distinct from 'refund',
-- which means a payment was actually captured and later returned.
```

## 3. Identity & roles

```sql
-- One row per Supabase Auth user, for ALL roles (dossier §6: "one
-- authentication system"). Created by a trigger on auth.users insert
-- (see §9 below), never created directly by client code.
create table profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  phone                   text not null unique,
  full_name               text,
  wallet_balance          integer not null default 0 check (wallet_balance >= 0),
  referral_code           text unique,
  acquisition_campaign_id uuid references campaigns(id),
  created_at              timestamptz not null default now()
);
-- wallet_balance: cached value, see DECISION_LOG D10. Authoritative
-- record is wallet_ledger. Every write to this column happens inside the
-- same transaction as the corresponding wallet_ledger insert — never
-- independently, and never from client-supplied input.

-- Role assignment. Absence of a row = customer (the default, majority
-- case, and therefore not itself a row — see DECISION_LOG D8).
-- INSERT/UPDATE/DELETE on this table is service-role only: no RLS policy
-- grants `authenticated` write access at all (see RBAC_MATRIX.md).
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
```

## 4. Campaigns (hackathon lives here — D22)

```sql
create table campaigns (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null check (type in ('launch_event', 'referral', 'organic', 'other')),
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  config     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- The launch hackathon is exactly one row here, type = 'launch_event'.
-- No other table has any FK or branch that knows a hackathon exists —
-- see profiles.acquisition_campaign_id (attribution) and promos.
-- campaign_id (optional link for a campaign-specific promo code) as the
-- ONLY two touchpoints, both attribution/config, never order/inventory/
-- payment logic. Per DECISION_LOG D22 / prompt §7.31.
```

(Note: `profiles` above forward-references `campaigns` — in the actual
migration file, declare `campaigns` before `profiles`, or add the FK via
`ALTER TABLE` after both exist. Shown in read order here for narrative
clarity.)

## 5. Stores, zones, addresses

```sql
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
-- Exactly one row at launch. Every order/inventory/product row still
-- carries store_id (dossier §5/§11: "carrying an unused foreign key is
-- free; retrofitting multi-tenancy into a live ordering system is not").

create table zones (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references stores(id),
  name            text not null,
  delivery_fee    integer not null check (delivery_fee >= 0),
  is_serviceable  boolean not null default true,
  created_at      timestamptz not null default now()
);
create index idx_zones_store on zones(store_id);

-- Structured campus geography. No free-text delivery address anywhere.
-- See DECISION_LOG D15.
create table addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  zone_id     uuid not null references zones(id),
  block       text not null,          -- hostel/block name, e.g. "Hostel C"
  floor       text,
  room        text not null,
  landmark    text,                   -- runner-readability only, never used for serviceability/routing
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_addresses_customer on addresses(customer_id);
```

Serviceability check (D16): `zones.is_serviceable`, joined live at
checkout — never cached on the address row, so an operational pause takes
effect for every existing saved address instantly.

## 6. Catalog & inventory

```sql
create table products (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id),
  name        text not null,
  brand       text,
  image_url   text,
  mrp         integer not null check (mrp >= 0),
  sale_price  integer not null check (sale_price >= 0),
  unit_label  text,               -- "500 g", "1 kg", "6 pcs"
  category    text not null,
  sort_order  integer not null default 0,
  is_listed   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint sale_price_not_above_mrp check (sale_price <= mrp)
);
create index idx_products_store_category on products(store_id, category) where is_listed;

-- Reservation semantics — see DECISION_LOG D11.
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
-- Available-to-sell = qty_on_hand - qty_reserved, computed at read time,
-- never stored (would be one more place to get out of sync).
```

## 7. Orders

```sql
create table orders (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id),
  store_id              uuid not null references stores(id),
  address_id            uuid not null references addresses(id),
  runner_id             uuid references runners(id),   -- NOT profiles(id) — see DECISION_LOG D28
  status                order_status not null default 'created',
  subtotal              integer not null check (subtotal >= 0),   -- GROSS goods total = sum(order_items.unit_price*qty)
  discount              integer not null default 0 check (discount >= 0),  -- promo discount, D33 (Phase 4)
  delivery_fee          integer not null check (delivery_fee >= 0),
  wallet_applied        integer not null default 0 check (wallet_applied >= 0),
  payable               integer not null check (payable >= 0),
  payment_status        payment_status not null default 'pending',
  delivery_code_hash    text,          -- set when status -> assigned; see D14
  idempotency_key       uuid not null unique,
  idempotency_request_hash text,       -- SHA-256 of the normalized create_order request, D23 (Phase 4) — a same-key/different-payload replay is a deterministic ORDER_ALREADY_EXISTS conflict
  reservation_expires_at timestamptz not null default (now() + interval '15 minutes'),
  placed_at             timestamptz not null default now(),
  confirmed_at          timestamptz,
  packed_at             timestamptz,
  assigned_at           timestamptz,
  picked_up_at          timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  constraint payable_matches_math
    check (payable = subtotal - discount + delivery_fee - wallet_applied),   -- D33: subtotal is gross, discount is subtracted
  constraint wallet_not_above_total
    check (wallet_applied <= subtotal - discount + delivery_fee),
  constraint discount_not_above_subtotal
    check (discount <= subtotal)
);
-- discount + idempotency_request_hash: added Phase 4 (DECISION_LOG D33).
-- subtotal stays the GROSS goods total; a flat/percent promo lands in
-- `discount`; a wallet_credit promo contributes 0 to `discount` and is
-- instead a wallet_ledger credit (reason='promo_credit') on redemption.
-- create_order_phase_a (migration 0004) is the only writer of these.
-- runner_id -> runners(id), not profiles(id): added Phase 1.1
-- (DECISION_LOG D28). Makes "assigned only to an actual onboarded,
-- active runner" a foreign-key-level guarantee rather than an
-- application-logic convention. RLS/Edge Functions resolve a caller's
-- runners.id from their profile_id (auth.uid()) rather than comparing
-- auth.uid() directly against this column — see RBAC_MATRIX.md.
--
-- reservation_expires_at: added Phase 1.1 (DECISION_LOG D27). Set once
-- at insert, never extended. Governs how long inventory stays reserved
-- and a wallet debit stays applied while payment setup is outstanding —
-- see API_CONTRACTS.md `expire_stale_reservations` and
-- PHASE_1_1_CORRECTIONS.md §4.4. Only meaningful while status='created';
-- ignored once an order reaches any other state.

create index idx_orders_store_status_placed on orders(store_id, status, placed_at);
create index idx_orders_customer_placed on orders(customer_id, placed_at desc);
create index idx_orders_reservation_expiry on orders(reservation_expires_at) where status = 'created';
create unique index idx_orders_one_live_job_per_runner
  on orders(runner_id) where status in ('assigned', 'picked_up');
-- ^ the database-level backstop for "one live job per runner" (D13,
-- dossier §13 guarantee #5), now expressed in terms of runners.id per
-- D28. This is true regardless of what the claim_job Edge Function does
-- or doesn't get right.

-- Note: orders.runner_id forward-references runners(id), defined in §10
-- below — same ordering caveat as campaigns/profiles in §4: declare
-- runners before orders in the actual migration file, or add this FK via
-- ALTER TABLE after both exist. Shown in read order here for narrative
-- clarity, matching the rest of this document's convention.

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
```

`idempotency_key UNIQUE NOT NULL` is dossier correctness guarantee #1 (D23)
— `create_order` checks for an existing row with the client-supplied key
before doing anything else, and returns it unchanged on replay.

## 8. Payments, refunds & webhook dedup

Redesigned in Phase 1.1 (`DECISION_LOG.md` D24, D29) — strictly 1:1 with
orders, always created (even for a fully wallet-covered order, already
`status='captured'`), with a claim-marker mechanism that lets payment
intent creation happen outside a held Postgres transaction (see
`PHASE_1_1_CORRECTIONS.md` §4).

```sql
create table payments (
  id                          uuid primary key default gen_random_uuid(),
  order_id                    uuid not null unique references orders(id),
  gateway                     text check (gateway in ('razorpay', 'cashfree')),  -- null for a wallet-only, gateway-free payment
  gateway_order_ref           text,             -- set in Phase C, once the gateway call succeeds
  gateway_payment_ref         text,             -- set by payment_webhook on capture
  gateway_intent_requested_at timestamptz,       -- claim marker (Phase B) — see below
  amount                      integer not null check (amount >= 0),
  refunded_amount             integer not null default 0 check (refunded_amount >= 0),
  status                      payment_status not null default 'pending',
  raw_event                   jsonb,             -- last webhook payload, REDACTED at write time — see DECISION_LOG D32
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint refunded_not_above_amount check (refunded_amount <= amount),
  unique (gateway, gateway_order_ref),
  unique (gateway, gateway_payment_ref)
);
create index idx_payments_order on payments(order_id);
-- order_id UNIQUE: "one logical payment per order" (Phase 1.1 prompt §7)
-- is now a database constraint, not a convention — exactly one payments
-- row exists for every order, from the moment the order is created.
--
-- UNIQUE(gateway, gateway_payment_ref) is dossier correctness guarantee
-- #2 — a retried webhook confirming the same gateway payment reference
-- cannot create a second captured record. Scoped per-gateway (Phase 1.1)
-- in case two gateways' reference formats could otherwise collide as
-- bare strings. UNIQUE(gateway, gateway_order_ref) is the equivalent
-- guarantee one step earlier in the flow — no two orders can ever share
-- a gateway order reference.
--
-- gateway_intent_requested_at: the "claim" a create_order invocation
-- takes before calling the gateway (Phase B), so a concurrent duplicate
-- request doesn't create a second gateway intent for the same order. A
-- claim older than 60 seconds with gateway_order_ref still null is
-- considered stale and may be reclaimed by a retry. See
-- PHASE_1_1_CORRECTIONS.md §4.1 steps 15-18 and §4.3's resume matrix.

-- Refunds — a dedicated append-only table, added Phase 1.1 (D29), the
-- third application of the cached-aggregate + ledger pattern (see D10,
-- D26). payments.refunded_amount is the cache; this table is the detail.
create table refunds (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null references payments(id),
  amount            integer not null check (amount > 0),
  reason            text not null,
  idempotency_key   uuid not null unique,   -- admin double-click / auto-reconciliation replay safety
  gateway_refund_ref text,                  -- null for a wallet-only refund destination
  actor_id          uuid references profiles(id),  -- null for system-initiated (auto-reconciliation) refunds
  created_at        timestamptz not null default now()
);
create index idx_refunds_payment on refunds(payment_id);
-- A payment's refunded_amount must equal SUM(refunds.amount) for that
-- payment_id — reconciled the same way wallet_ledger/profiles.wallet_
-- balance and promo_redemptions/promos.uses_count are (see TEST_
-- STRATEGY.md).

-- Deliberately separate from `payments`: dedupes at the transport layer
-- (has this exact webhook delivery been processed?) independent of
-- business-logic payment state. A gateway can and will redeliver the
-- same event_id; this table is what payment_webhook checks FIRST,
-- before touching `payments` or `orders` at all.
create table webhook_events (
  id                uuid primary key default gen_random_uuid(),
  gateway           text not null,
  gateway_event_id  text not null,
  payload           jsonb not null,          -- REDACTED at write time — see DECISION_LOG D32
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (gateway, gateway_event_id)
);
```

**Payment state transitions** are validated by a new trigger,
`enforce_payment_transition` (`BEFORE UPDATE ON payments`), structured
identically to `enforce_order_transition` (`ORDER_STATE_MACHINE.md` §4):
`pending→captured`, `pending→failed`, `captured→refunded`,
`captured→partially_refunded`, `partially_refunded→refunded`,
`partially_refunded→partially_refunded` (topping up only,
`refunded_amount` strictly increasing) are the only valid pairs. No
`failed→*` transition exists — a failed payment is terminal, mirroring
the order-side rule that a new payment attempt means a new order
(`PHASE_1_1_CORRECTIONS.md` §4.3, scenario E). Full invariant table:
`PHASE_1_1_CORRECTIONS.md` §8.

**Payment/order state consistency** (which `(orders.status,
payments.status)` pairs are valid) is enforced by extending
`enforce_order_transition` to check the paired `payments.status` for
transitions where the two are coupled — full table and rationale:
`PHASE_1_1_CORRECTIONS.md` §9, `DECISION_LOG.md` D30.

## 9. Wallet ledger

```sql
create table wallet_ledger (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id),
  delta       integer not null,     -- positive = credit, negative = debit; never 0
  reason      wallet_ledger_reason not null,
  order_id    uuid references orders(id),
  created_at  timestamptz not null default now(),
  constraint delta_not_zero check (delta <> 0)
);
create index idx_wallet_ledger_customer on wallet_ledger(customer_id, created_at desc);
```

`profiles.wallet_balance` and this table are written in the same
transaction, always (D10). A nightly job (Phase 8+) recomputes
`SUM(delta)` per customer and alerts on mismatch — see `TEST_STRATEGY.md`.

## 10. Runners & earnings

```sql
-- Separate from staff_roles deliberately: is_online is a hot-write field
-- (toggled every shift start/end, possibly multiple times a day), while
-- staff_roles is a rarely-written authorization record. Splitting them
-- means a runner's shift toggle never touches the row RLS/role-claim
-- logic reads from.
create table runners (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references profiles(id),
  store_id    uuid not null references stores(id),
  is_online   boolean not null default false,
  joined_at   timestamptz not null default now()
);

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
```

## 11. Promos

```sql
create table promos (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  type            text not null check (type in ('flat', 'percent', 'wallet_credit')),
  value           integer not null check (value >= 0),
  max_uses        integer,               -- null = unlimited
  uses_count      integer not null default 0 check (uses_count >= 0),
  per_user_limit  integer not null default 1,
  valid_from      timestamptz not null,
  valid_to        timestamptz,
  campaign_id     uuid references campaigns(id),
  created_at      timestamptz not null default now(),
  constraint uses_not_above_max check (max_uses is null or uses_count <= max_uses)
);
-- uses_count: added Phase 1.1 (DECISION_LOG D26) — the cached-aggregate
-- half of the same pattern used for wallet_balance (D10) and refunded_
-- amount (D29). Authoritative detail is promo_redemptions, below.

-- Supporting table (justified — needed to enforce per_user_limit without
-- scanning wallet_ledger/orders by string-matching promo codes).
create table promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references promos(id),
  customer_id uuid not null references profiles(id),
  order_id    uuid references orders(id),
  created_at  timestamptz not null default now()
);
create index idx_promo_redemptions_promo_customer on promo_redemptions(promo_id, customer_id);
-- Concurrency (revised Phase 1.1, DECISION_LOG D26 — this closes the gap
-- the original version of this note flagged as an accepted trade-off):
-- create_order locks the target `promos` row (`SELECT ... FOR UPDATE`)
-- before checking EITHER max_uses (via uses_count) OR per_user_limit
-- (via a COUNT(*) query against this table, which is now safe to trust
-- specifically because the promos row lock excludes every other
-- concurrent redeemer of that same code for the duration of the check).
-- This one lock correctly enforces per_user_limit for ANY value, not
-- just 1 — no UNIQUE(promo_id, customer_id) constraint is relied upon as
-- the enforcement mechanism, since that shape can't express limit > 1.
-- Full detail: PHASE_1_1_CORRECTIONS.md §6.
```

## 12. Audit log

```sql
create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id),   -- null for system-initiated actions
  action      text not null,                  -- e.g. 'order.status_changed', 'inventory.adjusted'
  entity_type text not null,                  -- e.g. 'order', 'product', 'promo'
  entity_id   uuid not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index idx_audit_logs_actor on audit_logs(actor_id, created_at desc);
```

Every Edge Function mutation writes an `audit_logs` row inside the same
transaction as its business-logic write (see `API_CONTRACTS.md`).

## 13. Rate limiting (supports D14, D18 — no Redis)

```sql
-- Minimal, justified support table: used by verify_delivery_code (5
-- attempts then cooldown) and OTP-adjacent checks if Supabase Auth's
-- built-in limits prove insufficient. A short retention window keeps
-- this table small; a daily cleanup job (Phase 2+) deletes rows older
-- than 24h.
create table rate_limit_events (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,   -- e.g. order_id for delivery-code attempts
  action      text not null,   -- e.g. 'delivery_code_attempt'
  created_at  timestamptz not null default now()
);
create index idx_rate_limit_subject_action_time on rate_limit_events(subject, action, created_at);
```

## 14. Locking strategy summary

Revised Phase 1.1: the wallet row-lock claim in the original version of
this table (row 3, below) was wrong — see `DECISION_LOG.md` D25. A fixed
lock-acquisition order is now specified for any transaction that needs
more than one of {wallet, promo, inventory}: **wallet → promo →
inventory** (inventory rows themselves always locked in ascending
`product_id` order), followed by every Edge Function that touches more
than one, not just `create_order`.

| Operation | Lock | Why |
|---|---|---|
| Wallet balance check/debit (`create_order` Phase A, `refund`) | `SELECT wallet_balance FROM profiles WHERE id = $1 FOR UPDATE`, acquired **first** in the fixed lock order | Concurrent wallet-spending checkouts for the same customer are ordinary, not rare (multi-device sign-in, a checkout racing a promo credit) — D25, correcting the original D10 assumption. |
| Promo redemption check (`create_order` Phase A) | `SELECT * FROM promos WHERE code = $1 FOR UPDATE`, acquired **second** | One lock correctly serializes both the global `max_uses` check and the per-customer `per_user_limit` check for any limit value — D26. |
| Inventory reservation (`create_order` Phase A) | `SELECT ... FOR UPDATE` on the target `inventory` row(s), sorted ascending by `product_id`, acquired **last** | Contending requests are NOT interchangeable — the second customer should wait briefly and get an accurate answer, not an immediate false failure. D11. Ascending-`product_id` ordering (Phase 1.1) prevents two orders with overlapping, differently-ordered SKU lists from deadlocking against each other. |
| Payment intent creation claim (`create_order` Phase B) | No lock held during the actual gateway call — a short claim-and-release transaction sets `payments.gateway_intent_requested_at` before the call, a second short transaction persists the result after | Explicitly does **not** hold a Postgres transaction across external network I/O — D24, the Phase 1.1 correction to the original (flawed) single-transaction design. |
| Runner job claim (`claim_job`) | `SELECT ... FOR UPDATE SKIP LOCKED` on the target `orders` row | Contending requests ARE interchangeable — a runner who loses a claim should immediately see failure and try the next order, not wait. D13. |
| Reservation expiry sweep (`expire_stale_reservations`) | `SELECT ... FOR UPDATE SKIP LOCKED` over candidate expired orders | Safe under overlapping/concurrent scheduled runs, same reasoning as D13. D27. |
| Order state transition | `BEFORE UPDATE` trigger validates the transition table (see `ORDER_STATE_MACHINE.md`), extended Phase 1.1 to also validate the paired `payments.status` (D30); no additional row lock needed beyond the implicit one `UPDATE` already takes. | Dossier §13 guarantee #6. |
| Payment state transition | `BEFORE UPDATE` trigger (`enforce_payment_transition`, Phase 1.1, D29) validates the transition table in `PHASE_1_1_CORRECTIONS.md` §8. | Mirrors the order-transition trigger's design for the same reason. |

## 15. What is deliberately NOT in this schema

- No `venues`, `tables`, `seats`, `event_credits`, `hackathon_users`,
  `event_orders` — permanently discarded, D1.
- No separate `customers` table distinct from `profiles` — one identity
  table for all roles, since Craavee has one auth system (dossier §6). A
  "customer" is simply a `profiles` row with no `staff_roles` entry.
- No floating-point or `numeric` money columns anywhere — D7.
- No cache/materialized-view table for computed wallet balance beyond the
  `profiles.wallet_balance` cache already specified — D10 covers this
  fully; a second cache would be redundant.
- No separate `payment_intents` table distinct from `payments` — the
  claim marker (`payments.gateway_intent_requested_at`) and the 1:1
  `orders`↔`payments` relationship (D29) together cover what a separate
  intents table would otherwise exist for, without a second table whose
  rows would need to be kept in sync with `payments` one-to-one anyway.
