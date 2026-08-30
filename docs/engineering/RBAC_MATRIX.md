# RBAC Matrix & Row-Level Security Specification

Governing rule, verbatim from the dossier and restated in the Phase 1
prompt: **the client is never the final authorization boundary.** Every
policy below is a Postgres RLS policy (or an Edge Function's internal
check backed by the service role), never a client-side gate alone. Role
enters the system exactly once, via the JWT claim described in
`DECISION_LOG.md` D8 — nothing here trusts a client-supplied role field.

**Revised Phase 1.1 (`DECISION_LOG.md` D28):** `orders.runner_id` now
references `runners.id`, not `profiles.id` directly. Every policy below
that scopes access by "the requesting runner's own order(s)" resolves the
caller's `runners.id` from their `profile_id` (`auth.uid()`) via a
subquery/join, rather than comparing `auth.uid()` directly against
`orders.runner_id` — reflected in the `orders` and `profiles` entries in
§5 below.

## 1. Role model

| Role | How assigned | Scope |
|---|---|---|
| `customer` | Default — any authenticated `profiles` row with no `staff_roles` entry | Own data only |
| `packer` | `staff_roles` row, `role='packer'`, `store_id` required | One store |
| `runner` | `staff_roles` row, `role='runner'`, `store_id` required | One store |
| `admin` | `staff_roles` row, `role='admin'`, `store_id` nullable (null = all stores) | One or all stores |

`super_admin` was considered per the prompt's explicit permission to add
it "only if genuinely required" — **not added**. Nothing in this spec
identifies a capability an `admin` shouldn't have that a narrower or wider
role would need instead; a single `admin` role with all-store scope when
`store_id is null` already covers "operate everything," and Craavee is a
single-founder/small-team product at this stage where a second admin tier
adds authorization surface with no corresponding real-world need. Revisit
only if/when a second store's admin needs to be restricted from the first
store's data (at which point per-store `admin` rows, already supported by
`staff_roles.store_id`, handle it — no schema change needed).

## 2. Capability matrix

`R`=read, `W`=write/create, `U`=update, `D`=delete, `—`=no access,
`EF`=only via Edge Function (never direct PostgREST), `own`=own rows only.

| Resource | Customer | Packer | Runner | Admin |
|---|---|---|---|---|
| Own profile | R, U (name only) | R, U (name only) | R, U (name only) | R, U |
| Other profiles | — | — | R (own store's active order's customer name + address only, via `orders` join) | R |
| `staff_roles` (role assignment) | — | — | — | R, W via **EF only** (see §4) |
| Product catalog (active/listed) | R (own store, listed only) | R (own store) | — | R, W, U, D (own store or all) |
| Inventory | — (never directly; availability surfaces through catalog read) | R, U (`qty_reserved`/`qty_on_hand` adjustments via **EF only**, e.g. stock-out) | — | R, U (via **EF only** for anything affecting live orders; direct catalog-page stock corrections may be plain RLS write — see §4) |
| Own addresses | R, W, U, D | — | — | R |
| Zones / serviceability | R (read-only, for checkout) | — | — | R, W, U |
| Own orders | R, W (**EF only** — `create_order`) | — | — | R |
| Orders — own store, active queue | — | R (packing-relevant fields) | R (claimable + own assigned) | R |
| Order status transitions | — (cancel-before-packed via **EF**) | U (**EF only** — `confirmed→packed`) | U (**EF only** — `claim_job`, `mark_picked_up`, `verify_delivery_code`) | U (**EF only**, override path) |
| Order items | R (own order) | R (own store queue) | R (own assigned order, product name/qty only) | R |
| Delivery code (plaintext) | R (own order, once, after `assigned`) | — | — (never — runner submits a guess, doesn't read the answer) | — (not stored in plaintext anywhere; see D14) |
| Payments (1:1 with order, D29) | R (own, restricted columns, not `raw_event`/gateway refs) | — | — | R (incl. redacted `raw_event`, D32) |
| Refunds (new, D29) | R (own order's refunds) | — | — | R (all, incl. `actor_id`) |
| Payment creation / webhook / expiry sweep | **EF only** | — | — | — |
| Wallet ledger | R (own) | — | — | R (all), W (**EF only** — manual adjustment) |
| Wallet balance spend at checkout | Implicit via `create_order` **EF** | — | — | — |
| Runner online status | — | — | U (own) | R |
| Runner earnings | — | — | R (own) | R (all), U (**EF only** — settlement) |
| Promos | R (validate code at checkout, via **EF**) | — | — | R, W, U, D |
| Campaigns | — | — | — | R, W, U |
| Audit logs | — | — | — | R |
| Store config (hours, pause, queue threshold) | R (open/closed status only, for UX) | — | — | R, W, U |

## 3. Explicit "cannot" list (from the Phase 1 prompt, verified against the matrix above)

**Customer cannot:** modify prices (`products` has no customer write
policy at all), modify stock (`inventory` has no customer policy at all),
modify order status directly (all transitions are `EF`-gated), read other
customers' data (every customer-scoped policy is `USING (customer_id =
auth.uid())` or equivalent), see another customer's wallet/order history.

**Runner cannot:** access customer wallet/payment information (`payments`,
`refunds`, and `wallet_ledger` have no runner policy at all — not even
for their own assigned order's customer), access other customers' order
history (runner `orders` policy is scoped to `store_id = own store AND
(status = 'packed' /* claimable */ OR runner_id IN (SELECT id FROM
runners WHERE profile_id = auth.uid()))`, never a blanket store-wide
order read), modify pricing/inventory (no runner policy on `products`/
`inventory` at all), be assigned an order without an active `runners` row
(structurally impossible — `orders.runner_id` is a foreign key into
`runners`, not `profiles`, per D28).

**Packer cannot:** access unrelated customer financial data (no packer
policy on `payments`/`wallet_ledger` at all — packer's `orders` read is
scoped to non-financial columns via a view, see §5).

**Admin** has the broadest access by design, but even admin mutations to
`orders.status`, `payments`, and `wallet_ledger` go through Edge Functions
(§4) so the six correctness guarantees apply to admin-initiated actions
too, not just customer/runner-initiated ones — an admin "force complete"
is still an audited, validated state transition, never a raw `UPDATE`.

## 4. Direct PostgREST (RLS-gated) vs. Edge-Function-only

| Operation | Path | Why |
|---|---|---|
| Read active catalog | PostgREST + RLS | Single-table, no contention, no cross-table invariant |
| Read own orders/addresses/wallet ledger | PostgREST + RLS | Single-row-scoped, no contention |
| Update own address, own name, runner online toggle | PostgREST + RLS | Single-row write, no invariant beyond "is this my row" |
| `create_order` | **Edge Function**, internally phased (D24) | Phase A: multi-table transaction (orders + order_items + inventory reservation + wallet debit + promo redemption), contended (D11, D25, D26), idempotency check (D23). Phases B/C: gateway call + short persistence transaction, deliberately **not** holding the Phase A transaction open — `PHASE_1_1_CORRECTIONS.md` §4 |
| `claim_job` | **Edge Function** | Contended (D13), enforces one-live-job partial-unique via transaction, not just the index as a hope. Resolves caller's `runners.id` first (D28) |
| `payment_webhook` | **Edge Function** | External caller (gateway, not an authenticated Craavee user at all — verified by signature, not JWT), writes across `webhook_events`/`payments`/`orders`/`wallet_ledger` atomically. May itself trigger an internal refund (via the `refunds` table) if it observes a captured payment against an already-terminal order — `PHASE_1_1_CORRECTIONS.md` §8/§9 |
| `refund` | **Edge Function** | Writes across `payments`/`refunds`/`wallet_ledger`/`orders`, must be atomic and audited. Takes a client-supplied `idempotencyKey` (Phase 1.1, D29) so an admin's accidental double-click replays instead of double-refunding |
| `expire_stale_reservations` | **Edge Function**, scheduled (system-triggered, not user-triggered) | New Phase 1.1 (D27) — releases inventory/wallet reservations and transitions abandoned `created` orders to `payment_failed` on a schedule; uses `FOR UPDATE SKIP LOCKED` over candidates |
| `mark_packed`, `mark_stock_out` | **Edge Function** | Touches `orders` + `order_items` + `inventory` together (stock-out releases a reservation and may trigger a partial refund — cross-table) |
| `mark_picked_up`, `verify_delivery_code` | **Edge Function** | State-machine transition + (for verify) rate-limited hash comparison — not expressible as a safe direct RLS write |
| `validate_promo` | **Edge Function** | Reads `promos` + `promo_redemptions` count together, a business invariant (per-user limit) beyond simple row ownership |
| `assign_staff_role` | **Edge Function**, admin-only, service-role | `staff_roles` has **no** RLS write policy for any authenticated role at all — the only door in is this function, callable only by an existing admin (checked inside the function, not by RLS, since the row being modified might be the actor's own) |
| Admin catalog/pricing edit | PostgREST + RLS (`admin` role, `store_id` match) | Single-table write, no cross-table invariant, no contention — RLS alone is sufficient and simpler than a function for this one |
| Admin inventory correction (manual stock count) | PostgREST + RLS **for the count itself**; but any correction that would drop `qty_on_hand` below `qty_reserved` is rejected by the `reserved_not_above_on_hand` CHECK constraint, so the database is the backstop even on this "simple" path |

## 5. RLS policy definitions (conceptual — exact SQL is a Phase 2 artifact, but every clause below is specific enough to implement without further product decisions)

Throughout: `auth.jwt() ->> 'role'` reads the server-injected role claim
(D8); `auth.uid()` is the Supabase-standard current-user helper. All
tables have `FORCE ROW LEVEL SECURITY` — even the table owner (used by
Edge Functions via the service role, which bypasses RLS entirely by
design, per Supabase's standard model) doesn't get an accidental bypass
through a client role.

**`profiles`**
- `SELECT`: `id = auth.uid()` OR (`auth.jwt()->>'role' = 'admin'`) OR
  (`auth.jwt()->>'role' = 'runner'` AND exists an `orders` row where
  `orders.customer_id = profiles.id` AND `orders.status IN
  ('assigned','picked_up')` AND `orders.runner_id IN (SELECT id FROM
  runners WHERE profile_id = auth.uid())` — i.e. a runner may read the
  profile of *only* the customer on their current live job, resolved via
  their own `runners` row per D28, and only while the job is live).
- `UPDATE`: `id = auth.uid()`, column-restricted at the application/view
  layer to `full_name` only (RLS can't restrict columns natively without
  a security-definer wrapper or separate view; Phase 2 implements this as
  a Postgres view `profiles_self_editable` the client writes through, or
  a `BEFORE UPDATE` trigger that rejects changes to any column but
  `full_name` — implementation detail, not a spec ambiguity).
- No `INSERT`/`DELETE` policy for any authenticated role — rows are
  created only by the `handle_new_user` trigger (§ Auth flow,
  `SECURITY_MODEL.md`).

**`staff_roles`** — no `SELECT`/`INSERT`/`UPDATE`/`DELETE` policy for
`authenticated` at all. Reads happen via the Auth Hook (runs as a
trusted Postgres function, not through PostgREST) and via `admin`-only
Edge Functions using the service role internally.

**`campaigns`** — `SELECT`: `auth.jwt()->>'role' = 'admin'`. No public
read (campaign config, including promo economics, isn't customer-facing
data). `INSERT`/`UPDATE`: admin only.

**`stores`** — `SELECT`: everyone (`true`) but the client only ever reads
`is_open`, `opens_at`, `closes_at` in practice (nothing sensitive here).
`UPDATE`: `auth.jwt()->>'role' = 'admin'` AND (`store_id is null` OR
`staff_roles.store_id = stores.id`).

**`zones`** — `SELECT`: everyone (needed for checkout serviceability
check pre-auth in some flows — treat as public reference data).
`INSERT`/`UPDATE`: admin only, own store.

**`addresses`** — `SELECT`/`INSERT`/`UPDATE`/`DELETE`: `customer_id =
auth.uid()`. Admin: `SELECT` only (support/dispute resolution), never
write — an admin should never silently edit where a customer lives.

**`products`** — `SELECT`: `is_listed = true` for `customer`/`packer`;
unrestricted (incl. unlisted) for `admin`. `INSERT`/`UPDATE`/`DELETE`:
admin only, `store_id` match.

**`inventory`** — `SELECT`: none directly for `customer` (availability is
derived — see `products`-joined view, e.g. `products_with_availability`,
which exposes `is_available boolean` computed from `qty_on_hand -
qty_reserved > 0` without exposing exact counts to customers, a
deliberate choice to avoid a customer inferring exact stock/sales
volume). `packer`: `SELECT` own store. `admin`: full access. All writes
except the manual-count exception in §4 go through Edge Functions.

**`orders`**
- `SELECT`: `customer_id = auth.uid()` OR (`auth.jwt()->>'role' =
  'packer'` AND `store_id = <packer's store>` AND `status IN
  ('confirmed','packed')`) OR (`auth.jwt()->>'role' = 'runner'` AND
  `store_id = <runner's store>` AND (`status = 'packed'` /* claimable,
  visible to all runners at that store */ OR `runner_id IN (SELECT id
  FROM runners WHERE profile_id = auth.uid())` /* own live/past job,
  resolved via runners per D28 */)) OR `auth.jwt()->>'role' = 'admin'`.
- `INSERT`: none directly — always `create_order` (Edge Function, service
  role).
- `UPDATE`: none directly for any non-admin role — always through the
  relevant Edge Function. Admin has no direct `UPDATE` policy either
  (§3) — even admin overrides go through an Edge Function so the state
  machine trigger and audit log fire consistently.

**`order_items`** — `SELECT` inherits `orders`' visibility (implemented
as a policy referencing `exists (select 1 from orders where orders.id =
order_items.order_id and <the orders SELECT policy>)`). No direct writes
for anyone — `order_items` rows are created by `create_order` and updated
(`fulfilled_qty`) only by `mark_packed`/`mark_stock_out`.

**`payments`** — `SELECT`: `orders.customer_id = auth.uid()` (joined),
columns restricted to `status`/`amount`/`refunded_amount`/`created_at`
for customers via a view (`raw_event`, `gateway_order_ref`,
`gateway_payment_ref`, `gateway_intent_requested_at` are staff/admin-only
— internal reconciliation/claim-tracking detail, not customer-facing).
Admin: full read, including `raw_event` (which is redacted at write time
regardless — `DECISION_LOG.md` D32 — so even admin never sees an
unredacted gateway payload). No `authenticated`-role writes at all — only
`create_order` (Phase A/C), `payment_webhook`, `refund`, and
`expire_stale_reservations` (all service role) write this table. Added
Phase 1.1: `payments.order_id` is now `UNIQUE` (D29) — every order has
exactly one payment row from creation, so there is no "no payment row
yet" customer-facing state to handle differently.

**`refunds`** (new table, Phase 1.1, D29) — `SELECT`:
`payments.order_id`-joined `orders.customer_id = auth.uid()` (a customer
can see refunds issued against their own orders, same restricted-column
treatment as `payments`) OR admin (full read, including `actor_id` for
accountability). No `authenticated`-role writes — only `refund` and the
internal reconciliation path inside `payment_webhook`/`expire_stale_
reservations` (service role) write this table.

**`webhook_events`** — no `authenticated` policy at all. Service-role
only, by design (this table exists purely for the webhook handler's own
idempotency check).

**`wallet_ledger`** — `SELECT`: `customer_id = auth.uid()` OR admin.
Writes: service role only, always via an Edge Function, always paired
with the `profiles.wallet_balance` update in the same transaction (D10).

**`runners`** — `SELECT`: `profile_id = auth.uid()` OR admin OR (packer
at the same store, for shift visibility). `UPDATE`: `profile_id =
auth.uid()`, restricted to `is_online` (same column-restriction pattern
as `profiles.full_name`).

**`runner_earnings`** — `SELECT`: `runners.profile_id = auth.uid()`
(joined) OR admin. No `authenticated` writes — created by the order's
delivery-completion path, settled by an admin-triggered Edge Function.

**`promos`** — `SELECT`: none for `customer` directly (a customer
validates a code through the `validate_promo` Edge Function, which
returns only whether it's valid and its effect — not the full row,
which would leak `max_uses`/other customers'-redemption-relevant info).
Admin: full access.

**`promo_redemptions`** — no `authenticated` policy. Written only by
`create_order`/`validate_promo` (service role) as part of promo
application.

**`audit_logs`** — `SELECT`: admin only. `INSERT`: service role only
(every Edge Function writes here; no client ever inserts directly, since
a client-writable audit log isn't an audit log).
