-- ============================================================
-- DEV-ONLY SEED DATA — never run against staging or production.
-- No secrets, no real payment captures, no production credentials.
-- Applied automatically by `supabase db reset` (supabase/config.toml's
-- default seed path) against the LOCAL Supabase Postgres instance only.
-- Source of truth for shape: DATABASE_SPEC.md; quantities per Phase 2
-- prompt §27 / Phase 2A §12 ("store, zones, products, inventory, test
-- users, runners and promos").
-- ============================================================

-- ---------------------------------------------------------------
-- 1. Store (one campus, per dossier P0 scope) + zones
-- ---------------------------------------------------------------
insert into stores (id, name, is_open, opens_at, closes_at, max_queue_depth) values
  ('00000000-0000-4000-8000-000000000001', 'Craavee — Campus Micro-Store', true, '10:00', '02:00', 9999),
  -- Phase 6: a second store exists only so the fulfilment suite can prove
  -- a packer scoped elsewhere is refused. It carries no catalogue.
  ('00000000-0000-4000-8000-00000000000f', 'Craavee — North Gate (fixture)', true, '10:00', '02:00', 9999);

insert into zones (id, store_id, name, delivery_fee, is_serviceable) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Hostel Block A–C', 1000, true),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Hostel Block D–F', 1200, true),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'North Campus PG Cluster', 1500, true),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'Off-Campus (pilot, paused)', 2000, false);

-- ---------------------------------------------------------------
-- 2. Campaign (the hackathon launch — D22, never a schema fork)
-- ---------------------------------------------------------------
insert into campaigns (id, name, type, starts_at, ends_at, config) values
  ('00000000-0000-4000-8000-000000000201', 'Launch Hackathon', 'launch_event',
   now() - interval '2 days', now() + interval '1 day',
   '{"welcome_credit_paise": 15000, "notes": "dev seed — not a real launch window"}'::jsonb),
  ('00000000-0000-4000-8000-000000000202', 'Referral Program', 'referral', now() - interval '30 days', null, '{}'::jsonb);

-- ---------------------------------------------------------------
-- 3. Auth users + profiles (handle_new_user creates the profile row
--    automatically on each auth.users insert) — customers, staff, runners
-- ---------------------------------------------------------------
-- `aud`/`role` = 'authenticated', `instance_id` = the nil UUID, on every
-- row: this is what a real signup populates, and what GoTrue's own
-- lookup filters on verbatim — confirmed empirically (Phase 3) by reading
-- `FindUserByPhoneAndAudience` (`internal/models/user.go`, GoTrue
-- v2.195.0): `where instance_id = <uuid.Nil> and phone = ? and aud = ?
-- and is_sso_user = false`. `uuid.Nil` is Go's all-zero UUID, NOT NULL —
-- a seeded row with `instance_id` left NULL (or `aud` left NULL) never
-- matches this query, so `verifyOtp` reports "User not found" regardless
-- of everything else being correct. Every seeded user was previously
-- unable to actually sign in through the real Auth API at all, only
-- reachable via direct SQL/RLS testing. See also the `auth.identities`
-- insert below — a second, independently necessary piece of the same gap.
--
-- `confirmation_token`/`recovery_token`/`email_change_token_new`/
-- `email_change` = '' explicitly: these four columns have no database
-- default (NULL otherwise — verified via `information_schema.columns`;
-- the other empty-string-shaped columns on this table do default to ''
-- already), but GoTrue's Go struct scans them as plain `string`, not a
-- nullable type — a NULL here fails the whole `/verify` request with a
-- 500 ("converting NULL to string is unsupported"), caught the same way
-- (empirically, against this exact GoTrue version) as the `instance_id`
-- issue above.
insert into auth.users (id, phone, aud, role, instance_id, confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at) values
  -- customers
  ('00000000-0000-4000-8000-000000001001', '9000000001', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001002', '9000000002', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001003', '9000000003', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001004', '9000000004', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  -- packer
  ('00000000-0000-4000-8000-000000001101', '9000001101', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  -- runners
  ('00000000-0000-4000-8000-000000001201', '9000001201', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001202', '9000001202', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001203', '9000001203', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  -- admin
  ('00000000-0000-4000-8000-000000001301', '9000001301', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  -- Phase 6 fulfilment-suite packers: 1102 in the seed store, 1103 in the
  -- fixture store above (the cross-store rejection case)
  ('00000000-0000-4000-8000-000000001102', '9000001102', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001103', '9000001103', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now());

update profiles set full_name = 'Aarav Sharma', acquisition_campaign_id = '00000000-0000-4000-8000-000000000201',
  referral_code = 'AARAV01' where id = '00000000-0000-4000-8000-000000001001';
update profiles set full_name = 'Priya Nair', acquisition_campaign_id = '00000000-0000-4000-8000-000000000201',
  referral_code = 'PRIYA01' where id = '00000000-0000-4000-8000-000000001002';
update profiles set full_name = 'Rohan Mehta' where id = '00000000-0000-4000-8000-000000001003';
update profiles set full_name = 'Sneha Iyer' where id = '00000000-0000-4000-8000-000000001004';
update profiles set full_name = 'Kabir Singh' where id = '00000000-0000-4000-8000-000000001101';
update profiles set full_name = 'Meera Reddy' where id = '00000000-0000-4000-8000-000000001201';
update profiles set full_name = 'Arjun Das' where id = '00000000-0000-4000-8000-000000001202';
update profiles set full_name = 'Ishaan Kapoor' where id = '00000000-0000-4000-8000-000000001203';
update profiles set full_name = 'Ops Admin' where id = '00000000-0000-4000-8000-000000001301';

-- welcome credit for the two hackathon-attributed customers (D22: an
-- ordinary wallet_ledger credit, never a special "event credit")
insert into wallet_ledger (customer_id, delta, reason) values
  ('00000000-0000-4000-8000-000000001001', 15000, 'promo_credit'),
  ('00000000-0000-4000-8000-000000001002', 15000, 'promo_credit');
update profiles set wallet_balance = 15000 where id in ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000001002');

-- ---------------------------------------------------------------
-- 3b. OTP test-login fixtures (Phase 3, TEST_STRATEGY.md §3's k6 auth
--     scenario note + config.toml's `[auth.sms.test_otp]` block, both of
--     which reference these exact phone numbers). GoTrue's test-OTP
--     bypass verifies against an *existing* `auth.users` row for the
--     phone (confirmed empirically: `verifyOtp` for a test phone with no
--     matching user returns "User not found"/`otp_expired`, not a
--     fresh-signup path) — so these rows are what makes
--     `9990000001`/`02`/`03` + code `123456` actually usable for local
--     dev/CI/load-testing, not just configured-but-dangling. Deliberately
--     left undecorated (no `full_name`, no address, no wallet credit)
--     past what `handle_new_user` itself sets — these exist to exercise
--     the real "fresh OTP sign-in creates/uses a bare profile" path
--     (Phase 3 §9), not to be a third copy of the demo customers above.
-- ---------------------------------------------------------------
insert into auth.users (id, phone, aud, role, instance_id, confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000001901', '9990000001', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001902', '9990000002', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001903', '9990000003', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  -- Phase 4 order-integration-suite customers (config.toml [auth.sms.test_otp]).
  -- Kept separate from 1901-1903 so the Phase 4 suite's wallet/order
  -- mutations never break the Phase 3 auth suite's assertions.
  ('00000000-0000-4000-8000-000000001904', '9990000004', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001905', '9990000005', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001906', '9990000006', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001909', '9990000009', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  -- Phase 5 payment-integration-suite customers — dedicated so the Phase
  -- 5 webhook/refund wallet mutations never race the Phase 4 order suite
  -- (both can run concurrently under `node --test`).
  ('00000000-0000-4000-8000-000000001907', '9990000007', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now()),
  ('00000000-0000-4000-8000-000000001908', '9990000008', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '', now(), now());

-- A matching `auth.identities` row (provider='phone') is also required —
-- a real signup writes one, and GoTrue's own account-linking expects it
-- to exist even though `verifyOtp`'s lookup itself goes through
-- `auth.users` directly (see the `aud`/`role` note above). Covers every
-- seeded user in one pass, not just the three above — the same gap
-- existed for all of them.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select phone, id, jsonb_build_object('sub', id::text, 'phone', phone, 'phone_verified', true), 'phone', now(), now(), now()
from auth.users
where phone is not null;

-- ---------------------------------------------------------------
-- 4. Staff role assignments (D8 — the only legitimate way a role is
--    ever assigned; seeding writes staff_roles directly since this is a
--    trusted, offline, service-role context, not a client request)
-- ---------------------------------------------------------------
insert into staff_roles (profile_id, role, store_id) values
  ('00000000-0000-4000-8000-000000001101', 'packer', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000001301', 'admin', null),
  ('00000000-0000-4000-8000-000000001102', 'packer', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000001103', 'packer', '00000000-0000-4000-8000-00000000000f');

insert into runners (id, profile_id, store_id, is_online) values
  ('00000000-0000-4000-8000-000000001210', '00000000-0000-4000-8000-000000001201', '00000000-0000-4000-8000-000000000001', true),
  ('00000000-0000-4000-8000-000000001220', '00000000-0000-4000-8000-000000001202', '00000000-0000-4000-8000-000000000001', true),
  ('00000000-0000-4000-8000-000000001230', '00000000-0000-4000-8000-000000001203', '00000000-0000-4000-8000-000000000001', false);

-- ---------------------------------------------------------------
-- 5. Structured addresses (D15 — block/floor/room, never free text)
-- ---------------------------------------------------------------
insert into addresses (id, customer_id, zone_id, block, floor, room, landmark, is_default) values
  ('00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000101', 'Hostel A', '2', '214', 'Near the water cooler', true),
  ('00000000-0000-4000-8000-000000002002', '00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000102', 'Hostel D', '1', '108', null, true),
  ('00000000-0000-4000-8000-000000002003', '00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000103', 'PG Sunrise', '3', '301', 'Opposite the gate', true),
  ('00000000-0000-4000-8000-000000002004', '00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000101', 'Hostel B', '4', '412', null, true);

-- ---------------------------------------------------------------
-- 6. Catalog — 24 products across the dossier's category set (§1: 150–250
--    SKUs at real scale; a representative slice for local dev)
-- ---------------------------------------------------------------
insert into products (id, store_id, name, brand, mrp, sale_price, unit_label, category, sort_order) values
  ('00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000000001', 'Flamin'' Hot Cheetos', 'Cheetos', 5000, 4500, '90 g', 'Munchies & Snacks', 1),
  ('00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-000000000001', 'Lay''s Magic Masala', 'Lay''s', 2000, 1800, '52 g', 'Munchies & Snacks', 2),
  ('00000000-0000-4000-8000-000000003003', '00000000-0000-4000-8000-000000000001', 'Kurkure Masala Munch', 'Kurkure', 2000, 1800, '90 g', 'Munchies & Snacks', 3),
  ('00000000-0000-4000-8000-000000003004', '00000000-0000-4000-8000-000000000001', 'Bourbon Biscuits', 'Britannia', 3000, 2800, '150 g', 'Munchies & Snacks', 4),
  ('00000000-0000-4000-8000-000000003005', '00000000-0000-4000-8000-000000000001', 'Sparkling Water — Lime', 'Bisleri', 5000, 4500, '750 ml', 'Cold Drinks & Beverages', 5),
  ('00000000-0000-4000-8000-000000003006', '00000000-0000-4000-8000-000000000001', 'Iced Mango Slushie Mix', 'Frooti', 9000, 8500, '1 L', 'Cold Drinks & Beverages', 6),
  ('00000000-0000-4000-8000-000000003007', '00000000-0000-4000-8000-000000000001', 'Coca-Cola', 'Coca-Cola', 4000, 3800, '750 ml', 'Cold Drinks & Beverages', 7),
  ('00000000-0000-4000-8000-000000003008', '00000000-0000-4000-8000-000000000001', 'Sting Energy Drink', 'Sting', 2000, 1900, '250 ml', 'Cold Drinks & Beverages', 8),
  ('00000000-0000-4000-8000-000000003009', '00000000-0000-4000-8000-000000000001', 'Instant Coffee Sachets', 'Nescafé', 9000, 8500, '10 pcs', 'Tea & Coffee', 9),
  ('00000000-0000-4000-8000-000000003010', '00000000-0000-4000-8000-000000000001', 'Masala Chai Premix', 'Taj Mahal', 12000, 11000, '400 g', 'Tea & Coffee', 10),
  ('00000000-0000-4000-8000-000000003011', '00000000-0000-4000-8000-000000000001', 'Cold Brew Botanical', 'Sleepy Owl', 15000, 14000, '200 ml', 'Tea & Coffee', 11),
  ('00000000-0000-4000-8000-000000003012', '00000000-0000-4000-8000-000000000001', 'Cookies & Cream Mini Pint', 'Amul', 8000, 7500, '110 ml', 'Ice Cream & Desserts', 12),
  ('00000000-0000-4000-8000-000000003013', '00000000-0000-4000-8000-000000000001', 'Chocolate Chip Cookies', 'Sunfeast', 5000, 4500, '4-pack', 'Ice Cream & Desserts', 13),
  ('00000000-0000-4000-8000-000000003014', '00000000-0000-4000-8000-000000000001', 'Choco Bar', 'Kwality Walls', 3000, 2800, '1 pc', 'Ice Cream & Desserts', 14),
  ('00000000-0000-4000-8000-000000003015', '00000000-0000-4000-8000-000000000001', 'Instant Noodle Cup — Spicy', 'Maggi', 4000, 3800, '70 g', 'Instant Meals', 15),
  ('00000000-0000-4000-8000-000000003016', '00000000-0000-4000-8000-000000000001', 'Cup Ramen — Masala', 'Top Ramen', 4500, 4200, '70 g', 'Instant Meals', 16),
  ('00000000-0000-4000-8000-000000003017', '00000000-0000-4000-8000-000000000001', 'Ready-to-Eat Khichdi', 'MTR', 8500, 8000, '250 g', 'Instant Meals', 17),
  ('00000000-0000-4000-8000-000000003018', '00000000-0000-4000-8000-000000000001', 'Toned Milk', 'Amul', 3000, 2900, '500 ml', 'Dairy', 18),
  ('00000000-0000-4000-8000-000000003019', '00000000-0000-4000-8000-000000000001', 'Curd Cup', 'Amul', 2500, 2400, '200 g', 'Dairy', 19),
  ('00000000-0000-4000-8000-000000003020', '00000000-0000-4000-8000-000000000001', 'Paneer Block', 'Mother Dairy', 9000, 8500, '200 g', 'Dairy', 20),
  ('00000000-0000-4000-8000-000000003021', '00000000-0000-4000-8000-000000000001', 'Bananas', null, 6000, 5500, '6 pcs', 'Fruits & Vegetables', 21),
  ('00000000-0000-4000-8000-000000003022', '00000000-0000-4000-8000-000000000001', 'Tomatoes', null, 4000, 3800, '500 g', 'Fruits & Vegetables', 22),
  ('00000000-0000-4000-8000-000000003023', '00000000-0000-4000-8000-000000000001', 'Toothpaste', 'Colgate', 5500, 5000, '150 g', 'Personal Care', 23),
  ('00000000-0000-4000-8000-000000003024', '00000000-0000-4000-8000-000000000001', 'Sanitary Pads', 'Whisper', 9000, 8200, '30 pcs', 'Personal Care', 24);

-- ---------------------------------------------------------------
-- 7. Inventory — every product listed above, all initially unreserved.
--    A couple of rows seeded near/at zero to exercise stock-out UI in
--    later phases; nothing here simulates a captured payment or any
--    order/reservation state.
-- ---------------------------------------------------------------
insert into inventory (store_id, product_id, qty_on_hand, qty_reserved)
select '00000000-0000-4000-8000-000000000001', id,
  case
    when name = 'Bananas' then 0                 -- out of stock, for stock-out flows later
    when name = 'Paneer Block' then 2             -- low stock
    else 20 + (row_number() over (order by sort_order))::int
  end,
  0
from products where store_id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------
-- 8. Promos — one hackathon welcome code, one evergreen referral-style
--    code (D26 concurrency-safe design; uses_count starts at 0, real)
-- ---------------------------------------------------------------
insert into promos (id, code, type, value, max_uses, per_user_limit, valid_from, valid_to, campaign_id) values
  ('00000000-0000-4000-8000-000000004001', 'HACKFEST', 'wallet_credit', 15000, 800, 1, now() - interval '2 days', now() + interval '5 days', '00000000-0000-4000-8000-000000000201'),
  ('00000000-0000-4000-8000-000000004002', 'FIRST50', 'flat', 5000, null, 1, now() - interval '30 days', null, null);

-- ---------------------------------------------------------------
-- No orders, payments, refunds, or webhook_events are seeded — an order
-- is a live transactional object created by create_order (Phase 4+),
-- and seeding a fake captured payment here would be exactly the "fake
-- production payment records" this file is explicitly told not to
-- contain (Phase 2 prompt §27 / Phase 2A §12).
-- ---------------------------------------------------------------
