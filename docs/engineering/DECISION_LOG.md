# Engineering Decision Log

Phase 1 · Craavee v2.0. Every decision below is final for the purpose of
Phase 2+ implementation unless a later decision log entry explicitly
supersedes it (superseding entries must say so and keep the old entry for
history, not delete it). Format: **DECISION → RATIONALE → ALTERNATIVES
REJECTED**.

Labels used throughout the spec set: **[DOSSIER]** dossier requirement,
**[PROMPT]** resolved explicitly by the Phase 1 instruction, **[FACT]**
existing-codebase fact, **[DECISION]** engineering call made here.

---

### D1. Product domain: Craavee v2.0 is the product; the hackathon is a launch campaign
**Decision.** The venue/table/seat/event-credit model is permanently
discarded. There is no `hackathon_users`, `event_orders`, `event_credits`,
`venue_tables`, or `seats` concept anywhere in the core schema. The
hackathon is represented purely as a launch campaign / acquisition source /
promotion, using the same order, inventory, auth, and payment model that
serves every customer before and after it.
**Rationale.** [PROMPT] explicit and non-negotiable. Also structurally
correct: an app that special-cases its own launch event accumulates a
permanent fork in its core logic that outlives the event by months.
**Alternatives rejected.** A parallel "event mode" with its own
order/table types (this is what the current repository already is, and
Phase 0 found it to be a dead end for the real product). A feature-flagged
hybrid model (rejected — adds branching complexity to the order/inventory
core for a 30-hour window, in violation of the prompt's explicit
instruction not to contaminate the core model).

### D2. Monorepo, single git repository
**Decision.** One monorepo hosts customer/runner Expo app, Store web,
Console web, shared types, shared validation, Supabase migrations, Edge
Functions, load tests, and CI config. Package-manager-level workspaces
(npm workspaces — matches the existing repo's plain-npm toolchain, no need
to introduce pnpm/turborepo machinery for a 4-package monorepo at this
scale).
**Rationale.** Four surfaces share one auth model, one set of DB types, one
set of Zod validators, and one API contract. A single source of truth for
generated Supabase types (`supabase gen types typescript`) consumed by all
four surfaces is only simple if they're one repo. The existing repo is
already small (71 files) — folding it into a monorepo root is cheap now and
expensive to retrofit later once four surfaces have drifted.
**Alternatives rejected.** Four separate repositories (rejected — type/
contract drift across repos is a constant tax at this team size of one to
two engineers; not worth it until the org is large enough to need
independent deploy cadences per surface). A monorepo with a heavyweight
build orchestrator (Nx/Turborepo) (rejected for now — genuine value only
appears with more packages/CI parallelism than this project has; revisit
if build times become a real problem, not preemptively).

### D3. Application boundaries within the monorepo
**Decision.** Four deployable units: `apps/customer-runner` (Expo, role-
gated at the router, not two separate apps — the dossier explicitly
specifies "same Expo codebase as customer, role-gated at routing level"),
`apps/store` (Next.js), `apps/console` (Next.js), and `supabase/` (schema +
Edge Functions, not really an "app" but a first-class deployable unit with
its own lifecycle). Shared code lives in `packages/`: `packages/types`
(generated Supabase types + domain types), `packages/validation` (Zod
schemas), `packages/api-contracts` (request/response shapes for Edge
Functions, imported by both the calling clients and the functions
themselves so drift is a compile error, not a runtime surprise).
**Rationale.** Matches the dossier's four-surface product model (§6) and
keeps deploy targets aligned 1:1 with Vercel/EAS/Supabase (§12), which is
what §7.1 of this prompt asks for explicitly.
**Alternatives rejected.** Separate `apps/store` and `apps/packer` (the
dossier's role table lists "Store" as one surface covering both packer and
future receive-stock tooling — no engineering reason to split it into two
deployables).

### D4. Expo SDK version strategy
**Decision.** Resolve the Expo SDK version at the moment `apps/customer-
runner` is actually scaffolded (`create-expo-app` / `expo install` against
whatever is current stable then), not pinned in this document. Record the
resolved version in `packages/types`'s README the day it's chosen, and
treat any specific version number written elsewhere in this spec set as
illustrative, not binding.
**Rationale.** [DOSSIER §12] explicit: "Resolve when you run
`create-expo-app`, never pinned in a document written weeks earlier." This
document is being written in Phase 1, before Phase 10 (mobile packaging)
even begins — any version pinned today would be stale by the time it
matters.
**Alternatives rejected.** Pinning a version now for "predictability"
(rejected — false predictability; SDK point releases ship security and
New Architecture fixes fast enough that pinning early just means starting
Phase 10 by immediately upgrading).

### D5. Postgres primary key strategy: UUID v4 everywhere, no serial/bigint
**Decision.** Every table's primary key is `uuid default gen_random_uuid()`
(via `pgcrypto`/`pg_uuid` extensions, both bundled with Supabase). No
`serial`/`bigserial` identity columns anywhere in the core schema.
**Rationale.** Client-generated idempotency keys and offline-tolerant
mobile writes (a runner's phone submitting a delivery confirmation on a
flaky campus network) need IDs the client can safely generate before a
round-trip, which sequential IDs can't provide without a server round-trip
first. UUIDs are also non-enumerable, which matters directly for an
authorization model built on RLS + `store_id` scoping — sequential order
IDs would let a curious customer estimate order volume by ID gaps, a minor
leak the dossier's design-system section wouldn't want visible in a "track
your order" URL either. Supabase/PostgREST tooling assumes UUID PKs as the
default idiom.
**Alternatives rejected.** `bigint identity` (simpler, smaller index, but
enumerable and requires a server round-trip before a client can reference
a not-yet-persisted row — breaks the offline-tolerant runner-app use case).
ULID/KSUID (time-sortable UUIDs — genuinely appealing for `orders` since
`ORDER BY id` would double as `ORDER BY created_at`, but Postgres/Supabase
tooling doesn't have first-class ULID column type support, and mixing key
strategies across tables adds cognitive overhead for a marginal ergonomic
win; use `orders(store_id, status, placed_at)` as the sort index instead,
per dossier §11).

### D6. Enum strategy: Postgres native `enum` types for closed, stable sets only; `text` + `CHECK` for anything that might grow
**Decision.** Native Postgres `enum` types for: `order_status`,
`payment_status`, `user_role`, `wallet_ledger_reason` where the reason set
is genuinely closed. `text` + `CHECK (... IN (...))` for anything that
product decisions are likely to extend without a migration review cycle:
`promo.type`, `audit_logs.action`, `runner_earnings` categorization.
**Rationale.** Native enums are faster and self-documenting in `\d` output,
but `ALTER TYPE ... ADD VALUE` can't run inside a transaction with other
DDL in older Postgres and is generally more ceremony than a `CHECK`
constraint update for values that plausibly change (a new promo type is a
product decision made in a sprint; a new order status is an architecture
decision that should be rare and deliberate — the friction differential is
intentional).
**Alternatives rejected.** All-native-enum (rejected — makes routine promo/
audit-log extension unnecessarily heavyweight). All-text+CHECK (rejected —
loses the self-documentation and type-safety benefit for the handful of
truly closed, foundational sets like order status, where the RLS/trigger
logic is written against exact known values and a typo should be a
migration-time error, not a silent no-op).

### D7. Money representation: integer minor units (paise), never floating point
**Decision.** All monetary columns (`orders.subtotal`, `delivery_fee`,
`payable`, `payments.amount`, `wallet_ledger.delta`, `products.mrp`,
`sale_price`, `runner_earnings.amount`) are `integer`, denominated in
paise (₹1 = 100). No `numeric`/`decimal`/`float`/`double precision` for
money anywhere.
**Rationale.** Floating point cannot represent ₹0.10 exactly, and
compounding rounding error across a wallet ledger that reconciles nightly
(dossier §11: "a reconciliation job compares them nightly") is exactly the
class of bug that erodes trust in a system handling real money. Integer
paise matches how Razorpay/Cashfree already represent amounts in their own
APIs (both gateways take/return amounts in the smallest currency unit), so
there's no unit-conversion boundary between "our money" and "gateway
money" — one fewer place to get the conversion backwards.
**Alternatives rejected.** `numeric(10,2)` rupees (rejected — technically
exact for storage, but reintroduces a unit mismatch at the gateway
boundary, since the gateway SDKs want paise; every payment-adjacent code
path would need a rupees↔paise conversion, which is exactly the kind of
repeated, easy-to-get-backwards conversion integer-paise-everywhere
eliminates). Floating point (rejected outright, not a serious option for
a system with a wallet ledger and a real payment gateway).

### D8. Role claims: role lives on the server-side `profiles`/`runners`/`staff` row, injected into the JWT via a Supabase Auth Hook, never settable by the client
**Decision.** Supabase Auth issues the JWT after phone OTP verification
with no role claim by default. A Postgres function wired as a Supabase
**Custom Access Token Auth Hook** looks up the authenticated user's row in
a server-only `staff_roles` table (for `packer`/`runner`/`admin`) — absence
from that table means `customer`, the default — and injects `role` into
the JWT's custom claims on every token mint/refresh. RLS policies read
`(auth.jwt() ->> 'role')`, never a client-supplied field.
**Rationale.** [DOSSIER §6, §12] "A `role` claim in the JWT, enforced by
Postgres RLS... enforcement never lives in the client" and [PROMPT §7.4]
"Do not trust a role supplied by the client... Define exactly where role
assignment is permitted." Auth Hooks are the Supabase-native mechanism for
exactly this — the JWT is signed server-side, so a client cannot forge a
`role` claim without the signing key.
**Alternatives rejected.** Storing role directly on `auth.users.raw_user_
meta_data` and trusting it in RLS (rejected — that metadata is
client-writable via the Supabase client SDK unless explicitly locked down,
and even locked down it's a weaker mental model than "role assignment only
happens through one server-side table one admin action can write to").
Checking role via a join to a `profiles` table on every RLS policy instead
of a JWT claim (rejected — works, but is a query-per-check-per-row-per-
request performance cost the JWT-claim approach avoids entirely; the Auth
Hook pays that cost once, at token mint time).

### D9. RLS architecture: RLS is the default and only authorization layer for reads and simple writes; four operations bypass PostgREST entirely and go through SECURITY DEFINER Edge Functions
**Decision.** Every table has RLS enabled with `FORCE ROW LEVEL SECURITY`.
Straightforward, single-row-scoped reads and writes (read own orders,
update own online status, read active catalog) are RLS-gated direct
PostgREST calls. Anything that is (a) a multi-row transaction, (b)
contended under concurrency, or (c) needs to bypass a customer's own RLS
scope to touch another table (e.g., reserving inventory while creating an
order) is a Supabase Edge Function running with the service role, invoked
by the client but never granted the service role key itself, per dossier
§10's "four contended writes" model.
**Rationale.** [DOSSIER §10, §13] matches the architecture exactly: "Almost
every request is a read, served straight from Postgres through PostgREST
with RLS... Only four operations mutate under contention, and those get
Edge Functions with real transactions." This keeps 90%+ of the API surface
as zero-code, automatically-consistent RLS policies, and concentrates all
the genuinely hard correctness work (locking, multi-table transactions) in
four reviewable functions instead of scattering it across dozens of ad hoc
routes.
**Alternatives rejected.** A traditional REST/GraphQL API service in front
of Postgres for everything (rejected per dossier §10's own reasoning —
not justified by four endpoints on a 26-day clock, and doubles the secrets/
deployment surface for no correctness benefit RLS + Edge Functions don't
already provide). RLS-only, no Edge Functions, using multiple client-side
round-trips for order creation (rejected outright — this is exactly the
TOCTOU race that causes overselling and double-assignment; multi-step
client-orchestrated transactions cannot provide the six correctness
guarantees).

### D10. Wallet balance strategy: cached balance column + append-only ledger, reconciled nightly
**Decision.** `customers.wallet_balance` (integer, paise) is the fast-read
cache. `wallet_ledger` is the append-only source of truth. Both are
written inside the same Postgres transaction by every wallet-affecting
Edge Function (never independently). A scheduled nightly job
(`pg_cron` or a Supabase scheduled Edge Function) recomputes
`SUM(wallet_ledger.delta)` per customer and asserts equality with
`wallet_balance`, alerting (Sentry) on mismatch rather than silently
auto-correcting (a silent auto-correct would hide a real bug).
**Rationale.** [DOSSIER §11] verbatim: "Balances are cached, ledgers are
authoritative... summing a ledger on every catalog render is correct and
far too slow; trusting a mutable column alone is fast and indefensible
when someone disputes a charge." Writing both in one transaction is what
makes the cache trustworthy between reconciliation runs.
**Alternatives rejected.** Ledger-only, compute balance on read (rejected
— dossier explicitly rejects this for the checkout hot path). Balance-
column-only, no ledger (rejected outright — no audit trail, indefensible
under a payment dispute, explicitly what the dossier warns against).

### D11. Inventory reservation: `qty_on_hand` / `qty_reserved` split, pessimistic row lock (`SELECT ... FOR UPDATE`) inside `create_order`
**Decision.** `inventory` carries both `qty_on_hand` and `qty_reserved`
(available = on_hand − reserved). `create_order` locks the relevant
`inventory` rows with `SELECT ... FOR UPDATE` (not `SKIP LOCKED` — for
inventory we want a purchaser to *wait* briefly for a concurrent reservation
to resolve rather than immediately fail, since inventory contention is
rare per-SKU and a few-millisecond wait is preferable to a false
out-of-stock error) before incrementing `qty_reserved`, inside the same
transaction as order/order_items insertion. A `CHECK (qty_reserved <=
qty_on_hand)` constraint is the last-resort backstop against any bug that
slips past the lock.
**Rationale.** [DOSSIER §11, §13] exact mechanism specified: "`qty_reserved
+ row lock`... prevents two customers buying the last packet of noodles
simultaneously." Locking (not `SKIP LOCKED`) is the right choice here
specifically because the two concurrent requests are *not* interchangeable
work items (unlike runner job claims, D-13) — both customers want the
same unit, and one must legitimately wait to find out if it's still
available, not be told to go claim a different unit.
**Alternatives rejected.** Optimistic concurrency (`UPDATE ... WHERE
qty_reserved + qty_wanted <= qty_on_hand`, retry on 0-rows-affected)
(rejected — works, but under real contention (the dossier's own "two
customers, last packet" scenario) produces user-facing failures on the
losing request that a lock-and-wait would instead resolve correctly for
FIFO fairness at negligible latency cost, since Craavee's per-SKU
concurrency is low — tens of orders per minute at peak, not thousands).
Single-counter stock decrement, no reservation (rejected outright per
dossier §11: "a single decrementing counter loses stock permanently every
time a payment fails, and payments fail constantly").

### D12. Payment abstraction boundary: gateway-agnostic internal contract, one adapter module per gateway
**Decision.** `packages/api-contracts` defines a gateway-agnostic internal
interface — `createPaymentIntent(orderId, amountPaise) → {gatewayOrderId,
checkoutParams}`, `verifyWebhookSignature(rawBody, signatureHeader) →
boolean`, `parseWebhookEvent(rawBody) → NormalizedPaymentEvent`. Exactly
one gateway adapter (`razorpay` or `cashfree`, per whichever clears KYC
first per dossier §17) implements it behind this interface; `payment_
webhook` and `create_order`'s payment-intent step call only the interface,
never the gateway SDK directly.
**Rationale.** [PROMPT §7.9] "Define a gateway-independent contract so the
implementation can support either." Dossier §17 flags gateway KYC as
external, unpredictable-timing, and blocking — hedging with an
abstraction costs one interface definition now and avoids a payments-layer
rewrite if the first-choice gateway's KYC stalls past the freeze date.
**Alternatives rejected.** Direct Razorpay SDK calls with no abstraction
(rejected — cheaper today, expensive if KYC forces a gateway switch mid-
build, which dossier §17 flags as a real possibility given the lead time).
Building both adapters up front (rejected — YAGNI; build one, keep the
seam, add the second only if actually needed).

### D13. Runner job claim concurrency: `FOR UPDATE SKIP LOCKED`, partial unique index for one-live-job
**Decision.** `claim_job(order_id)` selects the target order row with
`FOR UPDATE SKIP LOCKED`. If the row is already locked (another runner's
claim is mid-flight) or already `assigned`, the claim fails immediately
with `JOB_ALREADY_CLAIMED` rather than waiting — unlike inventory (D-11),
concurrent job claims *are* interchangeable (a runner who loses one claim
should instantly try the next order, not wait). A partial unique index,
`UNIQUE (runner_id) WHERE status IN ('assigned','picked_up')`, is the
database-level backstop that makes "one live job per runner" true even if
application logic has a bug.
**Rationale.** [DOSSIER §11, §13] exact mechanism: "`FOR UPDATE SKIP
LOCKED`... two runners arrive for one bag; one leaves empty-handed and
unpaid [without it]" and "partial `UNIQUE (runner_id)`... a runner hoards
four orders and delivers all of them late [without it]." `SKIP LOCKED`
over plain `FOR UPDATE` here is deliberate and is the opposite call from
D-11, for the reason stated above.
**Alternatives rejected.** Plain `FOR UPDATE` (rejected — would make a
second runner's claim attempt wait on the first, when it should instead
immediately see the order as unavailable and move to the next one).
Advisory locks instead of row locks (rejected — row locks map directly
onto the row being contended and are released automatically at
transaction end; advisory locks require manual lock/unlock discipline for
no benefit here).

### D14. Delivery code: 4-digit numeric, stored hashed (bcrypt/argon2 via `pgcrypto`), not plaintext
**Decision.** `orders.delivery_code_hash` stores a bcrypt hash of a
4-digit code generated server-side when the order transitions to
`assigned`. The plaintext code is returned once, in the API response to
the customer's own order-detail read (RLS-scoped to that customer), and is
never stored in plaintext, never logged, and never visible to the runner
(the runner only submits a guess; they don't get to read the answer).
Verification is a `verify_delivery_code(order_id, code)` Edge Function
comparing the hash, rate-limited (5 attempts, then a cooldown) to prevent
brute-forcing a 4-digit (10,000-combination) space.
**Rationale.** [PROMPT §7.12] explicit: "hashing vs plaintext decision,"
"rate limits," "a runner must not be able to mark an order delivered
merely by changing status from the client." Hashing plus rate-limiting
closes the brute-force gap a bare 4-digit code would otherwise have (10,000
guesses is trivial to script without a rate limit).
**Alternatives rejected.** Plaintext storage (rejected — dossier §7.4 calls
this "the cheapest possible proof of delivery," which is about UX
simplicity for the *customer*, not license to store it insecurely
server-side; hashing costs nothing in the UX). No rate limit (rejected —
a 4-digit space is small enough that an unlimited-attempt endpoint is a
real vulnerability, not a theoretical one).

### D15. Address model: `zones` → `addresses` (structured campus geography), no free text, no venue/table/seat hierarchy
**Decision.** `zones` represents a serviceable sub-area of a `store` (e.g.
a specific hostel block cluster). `addresses` belongs to a `customer`,
references a `zone_id`, and captures `block`/`hostel_name`, `floor`,
`room`, plus an optional `landmark` free-text field for runner-readability
only (never used for serviceability or routing logic — that's `zone_id`'s
job). No `venue`/`table`/`seat` concept exists anywhere in the target
schema.
**Rationale.** [DOSSIER §7.1, §11] "Address is captured at checkout... as
structured campus geography: hostel or block, floor, room. Never free
text." [PROMPT §7.3] explicit hierarchy suggestion, adopted as-is since it
matches the dossier and the reasoning holds — a runner navigating on foot
needs block+floor+room, not a lat/lng pin, and serviceability needs to be
a `zone` lookup, not a geofence computed live from lat/lng.
**Alternatives rejected.** Lat/lng + reverse geocoding as the address of
record (this is what the current prototype does via a third-party API —
rejected because it can't express "3rd floor, Room 312" and can't cleanly
answer "is this address in a serviceable zone" without an expensive
geofence computation on every checkout).

### D16. Serviceability: a `zone` is the unit of serviceability, resolved once at address-save time and cached on the address row
**Decision.** `zones.is_serviceable` is the single source of truth for
whether Craavee delivers there. When a customer saves an address, the
zone lookup happens once and `addresses` doesn't need its own
serviceability flag — it inherits the zone's, checked live at checkout
(a zone can flip to unserviceable, e.g. an operational pause, without a
stale cached flag on every address row lying about it).
**Rationale.** Matches dossier §11's "serviceability is a zone lookup."
Checking live at checkout (not caching on the address) means an admin-side
zone pause takes effect immediately for every customer without a bulk
address-table update.
**Alternatives rejected.** Per-address serviceability flag, updated via
trigger when a zone changes (rejected — adds trigger complexity and a
consistency-lag window for no benefit over a live `JOIN` at checkout time,
which is cheap at this scale).

### D17. Migration strategy from the current prototype: clean schema introduction, no compatibility migration
**Decision.** There is no production database anywhere today — the
existing SQLite-flavored DDL was never executed against a live database
(Phase 0 finding). Phase 2 introduces the target schema as migration
`0001_init.sql` from scratch. Nothing attempts to "migrate" `venues`/
`tables`/`credit_ledger` data forward, because no such data exists outside
a developer's local mock arrays.
**Rationale.** [PROMPT §7.29] asks this exact question and the answer is
unambiguous given [FACT] no real database or real user data exists yet —
a compatibility migration would be solving a problem that doesn't exist,
at the cost of dragging a wrong domain model into the real schema's
naming/shape.
**Alternatives rejected.** Writing a `venues→stores`, `tables→addresses`
migration path "for safety" (rejected — there is nothing to migrate; this
would be pure wasted effort and would risk leaking the wrong domain
model's assumptions into the new schema).

### D18. Cache layer: no Redis at Phase 2–9; introduced only if a k6 result demands it
**Decision.** Confirmed, not revisited: no cache layer ships before a k6
load test run shows a specific, measured bottleneck a cache would fix.
**Rationale.** [DOSSIER §12, §14] explicit and repeated. [PROMPT §7.25]
reconfirms. Nothing in this spec introduces a reason to reconsider — the
architecture (RLS-served reads, Edge-Function-served writes, CDN-cached
product images) doesn't have an obvious hot path a cache would fix at
single-store, single-campus scale.
**Alternatives rejected.** Pre-emptive Redis for session/rate-limit state
(rejected — rate limiting at this scale can run against Postgres directly,
e.g. a `rate_limit_events` table with a short-TTL cleanup job, or
Supabase's own built-in Auth rate limits for OTP; not enough volume yet to
justify a new managed service).

### D19. No separate API service: PostgREST (via Supabase) + Edge Functions is the entire backend
**Decision.** Confirmed, not revisited: no NestJS/Express/Fastify service
is deployed in Phase 2–13.
**Rationale.** [DOSSIER §10] "Four mutating endpoints do not justify a
deployment target, container registry, and a second set of secrets on a
26-day clock." Nothing found in Phase 0 or introduced in this spec changes
that math — the four Edge Functions (D-9) plus RLS-served PostgREST reads
cover 100% of the identified API surface (§7.18 of the Phase 1 prompt).
**Alternatives rejected.** Introducing a thin API service now to "future-
proof" for multi-store routing optimization (rejected — dossier §10
explicitly defers this to when the product outgrows the current
architecture, not before; premature infrastructure for imagined future
scale is exactly the kind of engineering-taste failure the dossier warns
against throughout).

### D20. Customer order-status delivery: polling, not a persistent Realtime subscription
**Decision.** The customer app polls `GET` on its own active order (RLS-
scoped) every 8 seconds while the app is foregrounded and the order is in
a non-terminal state, backing off to 30s after 2 minutes with no state
change, and stopping entirely when backgrounded (resuming on foreground).
No customer ever opens a Supabase Realtime channel.
**Rationale.** [DOSSIER §10, §12, §14] "Customers poll their own order,"
explicitly to avoid the socket fan-out failure mode identified as launch-
day failure #4 (800 concurrent customers × persistent sockets). An 8s
poll interval balances perceived responsiveness (median fulfilment target
is 12 minutes per dossier §22, so 8s granularity is imperceptible against
that) against request volume (at 800 concurrent trackers, 8s polling is
100 req/s peak, well within a single Postgres/PostgREST instance's
capacity for a single-row RLS-scoped read).
**Alternatives rejected.** Realtime for customers too, for UX parity with
staff (rejected — directly contradicts dossier §10's stated architecture
and reintroduces the exact failure mode §14 calls out by name). A fixed
polling interval with no backoff (rejected — wastes battery/bandwidth on
a customer who has an order sitting in `packed` for ten minutes with
nothing to report).

### D21. Realtime channel strategy for staff surfaces: one channel per `store_id`, scoped by RLS-equivalent channel authorization
**Decision.** Supabase Realtime (Postgres Changes) on `orders` and
`inventory`, filtered server-side to `store_id = <the operator's assigned
store>`, delivered on a channel named `store:{store_id}:orders` /
`store:{store_id}:inventory`. Console/Store/Runner-app staff clients
subscribe only to their own store's channel(s); channel access itself is
authorized via Supabase's Realtime RLS (Realtime respects the same RLS
policies as the underlying table when Broadcast/Postgres Changes
authorization is enabled), so a packer for store A cannot subscribe to
store B's channel even if they guess the name.
**Rationale.** [DOSSIER §12] "Realtime, store, runners and console only
(~15 connections)." Scoping by `store_id` from day one costs nothing extra
at single-store launch and means multi-store (Phase P2 in the dossier's
roadmap) doesn't require redesigning the channel model.
**Alternatives rejected.** One global channel for all staff (rejected —
works at one store, becomes a cross-store data leak the moment a second
store exists, and dossier §11 already commits to `store_id`-scoped schema
throughout).

### D22. Hackathon representation: `campaigns` + `campaign_id` attribution, not a schema fork
**Decision.** A `campaigns` table (`id`, `name`, `type` — e.g.
`'launch_event'`, `'referral'`, `'organic'` — `starts_at`, `ends_at`,
`config jsonb` for campaign-specific knobs like promo amount) exists purely
for attribution and configuration. `customers.acquisition_campaign_id`
(nullable FK) records which campaign brought a customer in, set once at
signup. The hackathon is one row in this table. Nothing about order
creation, payment, or fulfilment branches on `campaign_id` — it is read
by analytics and by the promo system (a campaign can reference a `promos`
row for its welcome credit), never by the order/inventory/payment state
machine.
**Rationale.** [PROMPT §1, §7.31] exact instruction: represent the
hackathon as "launch campaign," "acquisition source," "promotion,"
"campaign metadata" — never as a parallel order system. A `campaigns` +
attribution-FK design gives PostHog/analytics everything needed to
identify the hackathon cohort (dossier §5's "the retention cohort... that
cohort's week-two behaviour is the only signal that matters") without any
core table needing to know a hackathon happened.
**Alternatives rejected.** A boolean `orders.is_hackathon_order` flag
(rejected — this is exactly the "contaminate the core order model" the
prompt forbids; campaign attribution belongs on the customer/analytics
side, not baked into every order row forever). Storing campaign config in
application code / environment variables instead of a table (rejected —
the dossier's operational reality is that queue thresholds, promo amounts,
and store hours change *during* the 30-hour launch window in response to
real conditions per the runbook §21; that has to be a database row an
admin can edit live, not a redeploy).

### D23. Idempotency key strategy: client-generated UUID, `UNIQUE` constraint, 24-hour replay window
**Decision.** `orders.idempotency_key` (UUID, client-generated at
"place order" tap, `UNIQUE NOT NULL`). `create_order` first checks for an
existing row with that key; if found, returns the existing order
unchanged instead of creating a new one (true idempotent replay, not just
duplicate-rejection). Keys are not actively purged — a `UNIQUE` index on a
UUID column has no meaningful retention cost, so there's no expiry job to
build or reason about.
**Rationale.** [DOSSIER §11, §13, §21] "`UNIQUE (idempotency_key)`... an
impatient double-tap on a weak connection charges twice [without it]."
Returning the existing order on replay (not just erroring) is what makes
retry-safe client code simple — a client that times out and retries
doesn't need special-case error handling, it just gets the same order back.
**Alternatives rejected.** Server-generated idempotency key (rejected —
defeats the purpose; the whole point is the client can safely retry an
in-flight request without knowing whether the first attempt succeeded,
which requires the client to own key generation).

---

## Phase 1.1 corrections (2026-08-29, specification consistency & correctness review)

Full narrative and per-document diff: `PHASE_1_1_CORRECTIONS.md`. These
nine entries correct three real correctness gaps (payment transaction
scope, wallet concurrency, promo concurrency) and two consistency gaps
(Edge Function terminology, runner FK model) found in the Phase 1
specification. None of the original D1–D23 entries above are edited or
deleted — where a Phase 1.1 entry changes a prior decision's conclusion,
the prior entry is left intact as history and this entry states the
change explicitly.

### D24. Payment transaction scope: three explicit phases, no Postgres transaction held across gateway network I/O
**Decision.** `create_order`'s payment-intent step is split into Phase A
(one Postgres transaction: auth, validation, locking, reservation, order/
payment row creation, commit), Phase B (gateway call, no transaction
open), and Phase C (a second, short Postgres transaction that persists
the gateway's response). A claim marker
(`payments.gateway_intent_requested_at`) prevents duplicate concurrent
gateway calls without holding a lock across the network call. Full detail:
`PHASE_1_1_CORRECTIONS.md` §4.
**Rationale.** [PROMPT, Phase 1.1 §1] Holding row locks (inventory,
potentially wallet) for the duration of an uncontrolled external HTTP
call is a direct threat to the six correctness guarantees under real
load — a slow gateway response shouldn't be able to block every other
customer's inventory reservation attempt on overlapping SKUs.
**Alternatives rejected.** Keeping the original single-transaction design
with a short gateway timeout as the mitigation (rejected — a timeout
bounds the *worst case* damage but doesn't remove the underlying design
flaw, and "make the network call fast" is not a control anyone actually
has over a third-party gateway). A saga/outbox pattern with a separate
message queue (rejected as over-engineering for four Edge Functions on a
26-day clock — the claim-marker mechanism gets the same safety property
without introducing a new infrastructure component, consistent with D19's
reasoning against unnecessary infrastructure).

### D25. Wallet concurrency: lock the `profiles` row before any balance check, fixed lock-acquisition order across all multi-lock transactions
**Decision.** Every operation that debits/credits a wallet locks the
target `profiles` row (`SELECT wallet_balance ... FOR UPDATE`) before
checking or modifying the balance, inside the same transaction as the
triggering operation. Any transaction that needs more than one of
{wallet, promo, inventory} locks acquires them in a fixed order — wallet,
then promo, then inventory (inventory rows themselves always locked in
ascending `product_id` order) — across every Edge Function, not just
`create_order`. Full detail: `PHASE_1_1_CORRECTIONS.md` §5.
**Rationale.** [PROMPT, Phase 1.1 §3] The original D10 asserted
concurrent wallet writes for one customer were unlikely — false in
general (multi-device sign-in, a wallet-funded order racing a promo
credit landing at the same moment). A fixed global lock order across all
three resource types is what prevents a deadlock between, say, a
transaction that locks inventory-then-wallet and another that locks
wallet-then-inventory — a real risk once more than one Edge Function can
touch more than one of these tables under a lock.
**Alternatives rejected.** Optimistic concurrency on `wallet_balance`
(`UPDATE ... WHERE wallet_balance >= amount`, retry on 0-rows-affected)
(rejected for the same reason as D11's rejection of the equivalent
inventory approach — under genuine contention it produces avoidable
user-facing failures a lock-and-wait resolves correctly, and wallet-spend
contention per customer is rare enough that a brief wait is the right
trade-off, not a performance risk). Per-customer application-level mutex
outside the database (e.g. a Redis lock) (rejected — reintroduces Redis
for a problem Postgres row locking already solves natively, contradicting
D18).

### D26. Promo redemption concurrency: lock the `promos` row, serializing both `max_uses` and `per_user_limit` checks under one lock; cached `uses_count` + append-only `promo_redemptions`
**Decision.** `SELECT * FROM promos WHERE code = $1 FOR UPDATE` before
any redemption check. `promos.uses_count` (new column) is the cached
aggregate; `promo_redemptions` remains the append-only detail table. Both
`max_uses` (global) and `per_user_limit` (any value, not just 1) are
enforced correctly by the same single lock, since holding it excludes
every other concurrent redeemer of that specific code for the duration
of the check-and-insert. Full detail: `PHASE_1_1_CORRECTIONS.md` §6.
**Rationale.** [PROMPT, Phase 1.1 §4] The original `DATABASE_SPEC.md` §11
explicitly flagged `per_user_limit > 1` as an unresolved concurrency
weakness rather than solving it. Locking the parent `promos` row is the
one mechanism that correctly generalizes to any `per_user_limit` value,
rather than needing a `UNIQUE` constraint for the `=1` case and a
different, weaker mechanism for `>1`.
**Alternatives rejected.** `UNIQUE(promo_id, customer_id)` on
`promo_redemptions` as the primary mechanism (rejected as a *sole*
mechanism — correctly handles `per_user_limit=1` but cannot express `>1`
at all, which was exactly the original gap). A Postgres advisory lock
keyed on the promo code instead of a real row lock (rejected — the
`promos` row already exists and is exactly the resource being contended
over; a real row lock is more direct and requires no separate lock-key
convention).

### D27. Inventory/wallet reservation lifetime: 15-minute expiry, scheduled sweep, distinct `reservation_reversal` ledger reason
**Decision.** `orders.reservation_expires_at = now() + interval '15
minutes'`, set once at order creation, never extended. A scheduled
function (`expire_stale_reservations`, cadence 1 minute, `FOR UPDATE SKIP
LOCKED` over candidates) transitions expired `created` orders to
`payment_failed`, releasing inventory and reversing any wallet debit with
a new `wallet_ledger_reason` value, `reservation_reversal` — distinct
from `refund` (which implies a payment was actually captured and later
returned). Full detail: `PHASE_1_1_CORRECTIONS.md` §4.4.
**Rationale.** [PROMPT, Phase 1.1 §8] Once D24 moves payment setup outside
the order-creation transaction, an order can sit indefinitely in
`created` with stock reserved and wallet debited unless an expiry exists.
Distinguishing `reservation_reversal` from `refund` in the ledger keeps
the audit trail honest — "we gave this back because nothing was ever
captured" and "we captured this and later returned it" are different
facts a dispute investigation would want to tell apart (echoing the
reasoning already established for `wallet_ledger`'s existence at all,
D10).
**Alternatives rejected.** No expiry, rely on the customer or an admin to
notice and cancel (rejected outright — silently locks inventory
indefinitely, directly undermining guarantee #3). A single `refund`
reason for both cases (rejected — loses exactly the audit distinction
described above for negligible implementation savings).

### D28. Runner foreign key: `orders.runner_id → runners.id`, not `profiles.id`
**Decision.** `orders.runner_id` references `runners.id`.
`runners.profile_id` continues to reference `profiles.id`, unchanged.
RLS policies and Edge Functions resolve a caller's `runners.id` from
their `profile_id` (`auth.uid()`) rather than comparing `auth.uid()`
directly against `orders.runner_id`. Full detail:
`PHASE_1_1_CORRECTIONS.md` §7.
**Rationale.** [PROMPT, Phase 1.1 §6] The original design (`orders.
runner_id → profiles.id`) meant the schema itself could not guarantee an
order was ever assigned to an actual onboarded, active runner — only
application logic (the `claim_job` role check) prevented it. Targeting
`runners.id` makes "assigned only to a real runner" a foreign-key-level
guarantee, not merely a convention every future Edge Function has to
remember to uphold.
**Alternatives rejected.** Keeping `profiles.id` as the FK target and
adding a `CHECK`-via-trigger that validates a matching `runners` row
exists at write time (rejected — solves the same problem with more
machinery than simply pointing the FK at the right table in the first
place; a trigger-based re-implementation of what a foreign key already
does natively is unjustified complexity).

### D29. Payments table redesign: strict 1:1 with orders, always created, refunds tracked via a dedicated append-only table
**Decision.** `payments.order_id UNIQUE` (exactly one payment row per
order, always — even a fully wallet-covered order gets a `payments` row,
created already `status='captured'`, `gateway=null`). Refunds are tracked
via a new `refunds` table (`payment_id`, `amount`, `reason`,
`idempotency_key UNIQUE`, `gateway_refund_ref`, `actor_id`, `created_at`)
plus a cached `payments.refunded_amount` (`CHECK (refunded_amount <=
amount)`) — the same cached-aggregate-plus-ledger pattern as `wallet_
ledger` (D10) and `promo_redemptions`/`uses_count` (D26), now named and
recognized as a recurring idiom in this codebase rather than three
independent designs. Full detail: `PHASE_1_1_CORRECTIONS.md` §8.
**Rationale.** [PROMPT, Phase 1.1 §7] "One logical payment per order" is
only actually true if the schema enforces it; a nullable/optional
`payments` row for wallet-only orders was an unnecessary special case
this redesign removes by always creating the row. A dedicated `refunds`
table (rather than overloading `payments.status` alone) is what makes
"duplicate refunds are impossible" a real, idempotency-keyed guarantee
instead of an informal expectation, and correctly supports the
partial-refund-then-later-top-up-to-full sequence a stock-out followed by
a cancellation produces.
**Alternatives rejected.** Multiple `payments` rows per order (one per
attempt) (rejected — complicates "which row is authoritative" for no
benefit once D24's phasing already makes a single row's lifecycle
well-defined across retries). Tracking refunds as `wallet_ledger` rows
alone with no dedicated table (rejected — `wallet_ledger` correctly
records the *effect* on the customer's wallet, but doesn't, by itself,
give `payments` its own "how much of this specific payment has been
refunded so far" invariant, which is what the `refunded_amount <= amount`
CHECK needs a home for).

### D30. Payment/order state consistency: a validating trigger as backstop, Edge Functions write both together as the primary mechanism
**Decision.** A documented table of valid `(orders.status,
payments.status)` combinations (`PHASE_1_1_CORRECTIONS.md` §9) is
enforced by extending the existing `enforce_order_transition` trigger to
also check the paired `payments.status` for transitions where the two are
coupled, raising a new `PAYMENT_ORDER_STATE_MISMATCH` error if violated.
Primary responsibility for keeping the pair correct stays with the Edge
Functions that write both columns together in one transaction — the
trigger is a backstop assertion, matching the division of responsibility
already established for `orders.status` transitions alone
(`ORDER_STATE_MACHINE.md` §4).
**Rationale.** [PROMPT, Phase 1.1 §10] Two independently-writable status
columns without a documented, enforced relationship between them is
exactly the kind of gap that produces silent, hard-to-debug contradictory
states (e.g. a `cancelled` order sitting with `payments.status='pending'`
forever). A late-arriving webhook for an already-terminal order is
handled by the same mechanism (auto-refund via the reconciliation path,
`PHASE_1_1_CORRECTIONS.md` §8/§9) rather than a separate special case.
**Alternatives rejected.** A single combined status enum spanning both
concerns (e.g. `'confirmed_captured'`, `'cancelled_refunded'`) (rejected
— collapses two genuinely independent dimensions — logistics state and
money state — into one enum whose value count grows combinatorially and
whose transitions become harder to reason about than two separate,
narrower state machines kept consistent by a checked relationship).

### D31. Edge Function terminology: "four mutation categories," not "four functions"
**Decision.** The dossier's "four contended writes" (describing its own
MVP-scope shorthand) is superseded, in this spec set, by **four mutation
categories** — Order & Payment Lifecycle, Fulfilment Claim & Handoff,
Store-Side Reconciliation, Administrative/Privileged — with every one of
the (now 16, after D24/D27 added `expire_stale_reservations` and the
Phase B/C split didn't add a new public function since it's internal to
`create_order`) Edge Functions classified into exactly one category, plus
`validate_promo` called out explicitly as a non-mutating advisory
function outside the category scheme. Full classification:
`API_CONTRACTS.md` §0 (new).
**Rationale.** [PROMPT, Phase 1.1 §5] The spec set inherited dossier
language describing a deliberately minimal MVP shape while Phase 1 had
already specified far more functions than four — never reconciled,
producing an internally contradictory document set. "Four mutation
*categories*" preserves the *reason* the dossier's original framing
mattered (a small number of reviewable, correctness-critical write paths,
as opposed to dozens of ad hoc mutating routes) without the now-false
literal function count.
**Alternatives rejected.** Reducing the actual function count back down
to four by merging functions (rejected — the functions are separately
named because they have genuinely different actors, request shapes, and
error conditions per `API_CONTRACTS.md`; merging them for the sake of a
number would harm the "reviewable, single-purpose function" property the
dossier's original design was actually going for).

### D32. Audit log and webhook payload handling: write-only for clients, redacted at write time, bounded retention for raw gateway payloads
**Decision.** `audit_logs`: no client (customer/packer/runner/admin) ever
writes to it directly — every row is written by an Edge Function running
as the service role, inside the same transaction as the business change
it's recording. `actor_id` is nullable only for genuinely system-
initiated rows (`expire_stale_reservations`, a late-webhook
reconciliation). `metadata jsonb` on `audit_logs` never contains a raw
gateway payload, a card/UPI identifier, or a delivery code — only
structurally necessary fields (e.g. `{from_status, to_status,
reason}`). `payments.raw_event` (the webhook payload store) retains the
gateway's event **with payment-instrument identifiers redacted** (VPA,
masked card number, bank reference beyond what's needed for
reconciliation) at write time, not after the fact, and is scoped to
`admin`-only read (`RBAC_MATRIX.md`, unchanged from Phase 1 — reconfirmed
here). Retention: raw webhook payloads (`webhook_events.payload`,
`payments.raw_event`) are retained 180 days (a reconciliation/dispute
window, matching typical card-network chargeback windows) then purged by
a scheduled job — `audit_logs` itself (the redacted, structural record)
is retained indefinitely, since it never held the sensitive detail in the
first place.
**Rationale.** [PROMPT, Phase 1.1 §11/§12] An audit log or a payment-
event store that silently accumulates sensitive gateway detail forever is
a liability disproportionate to the diagnostic value it provides past the
reconciliation window a real dispute would need.
**Alternatives rejected.** Storing raw, unredacted webhook payloads
indefinitely "for safety" (rejected — directly contradicts the least-
data-retention principle this decision exists to establish, and expands
the blast radius of any future database compromise for no corresponding
benefit past the 180-day reconciliation window). No `raw_event`/`payload`
storage at all (rejected — a real reconciliation/dispute investigation
does need the actual gateway event within the retention window; the
answer to "is storing this appropriate" is "yes, bounded and redacted,"
not "no").

## Phase 4 (2026-08-30, order creation + inventory correctness)

### D33. Promo effect model + `orders.discount` column; wallet applied partially, `INSUFFICIENT_BALANCE` only at zero balance
**Decision.** (a) `orders` gains a first-class `discount integer not null
default 0` column. `subtotal` stays the GROSS goods total
(`= Σ order_items.unit_price*qty`); the two money-math CHECK constraints
become `payable = subtotal - discount + delivery_fee - wallet_applied`
and `wallet_applied <= subtotal - discount + delivery_fee`, plus
`discount <= subtotal`. (b) `promos.type` maps to effect as: `flat` →
`discount = min(value, subtotal)`; `percent` → `discount =
floor(subtotal * value / 100)` capped at subtotal; `wallet_credit` →
`discount = 0`, and redemption instead writes a `wallet_ledger` credit of
`value` (`reason='promo_credit'`) + `profiles.wallet_balance += value` in
the same Phase A transaction — the "welcome credit" mechanism (§7, D22),
spendable on a future order, not the current one. All three types still
increment `promos.uses_count` and write a `promo_redemptions` row under
the `promos` row lock (D26). `promos` has no `min_order` column, so
"minimum order" validation is a documented no-op. (c) `create_order`'s
`useWallet: boolean` means "apply as much wallet as this order needs, up
to the locked balance" — partial wallet + gateway is supported.
`INSUFFICIENT_BALANCE` is raised only when `useWallet: true` and the
locked `wallet_balance` is `0` (nothing to apply — typically a stale
client after a concurrent spend). (d) `orders.idempotency_request_hash`
(SHA-256 of the normalized request) makes a same-`idempotencyKey` /
different-payload replay a deterministic `ORDER_ALREADY_EXISTS` (409)
conflict rather than a silent return of an unrelated order
(`API_CONTRACTS.md` §5, `INVALID_PROMO`/`PROMO_LIMIT_REACHED`/
`VALIDATION_FAILED` also added to the catalogue here).
**Rationale.** [PHASE 4 PROMPT §7/§12/§14/§22] The schema had no way to
record a promo discount and `API_CONTRACTS.md` never nailed
`promos.type` → checkout effect or the exact `INSUFFICIENT_BALANCE`
trigger. A gross `subtotal` + explicit `discount` keeps the order row
honest (`Σ line prices` still equals `subtotal`) and gives an admin /
analytics a real "promo discount given" figure, unlike storing a net
subtotal.
**Alternatives rejected.** Net `subtotal` with no `discount` column
(rejected — makes `subtotal` diverge from the line-items sum whenever a
promo applies, and the confirmation screen would have to reconstruct the
discount). `useWallet` meaning "wallet-only, fail if it can't cover the
whole order" (rejected — contradicts the response contract's separate
non-zero `walletApplied` and `payable`, and the dossier's "wallet is
store credit on top of real payment"). A `UNIQUE` payload constraint
instead of a hash column (rejected — a request payload isn't a natural
key and can't be expressed as one).

### D34. `create_order` Phase A is a plpgsql function; the Edge Function orchestrates the three phases
**Decision.** Phase A (`PHASE_1_1_CORRECTIONS.md` §4.1 steps 1-14) is one
plpgsql function, `create_order_phase_a(...)`, invoked by the
`create_order` Edge Function via `supabase.rpc()` with the service role.
A single SQL function invocation is one transaction, so all of Phase A's
`FOR UPDATE` locks, the inventory reservation, the wallet debit, the
promo redemption, the `orders`/`order_items`/`payments` inserts, and the
deferred `check_payment_order_consistency` trigger commit or roll back
atomically. The Edge Function then runs Phase B/C (the gateway call and a
short persistence transaction) in TypeScript with NO Postgres
transaction held — D24 unchanged. `claim_payment_intent` and
`persist_gateway_ref` are two further small plpgsql functions for the
Phase B claim marker and Phase C write.
**Rationale.** [D24, D19] supabase-js gives no client-side transaction
control; putting Phase A in a plpgsql function is the direct,
infrastructure-free way to get "one transaction spanning all the
locking/writes" while still keeping the gateway network call outside any
transaction. Matches D19's "PostgREST + Edge Functions is the entire
backend, no extra service."
**Alternatives rejected.** Doing Phase A as multiple statements from the
Edge Function over one pooled connection (rejected — supabase-js issues
each `.from()/.rpc()` as an independent PostgREST request; there is no
"BEGIN … COMMIT" it can wrap them in). An outbox/saga (rejected — same
over-engineering call as D24).

### D35. Latent Phase 2/3 bugs found and fixed in Phase 4's migration 0004
**Decision.** Three pre-existing issues, undetected because Phase 2/2A's
pgTAP runs as the `postgres` superuser and Phase 3 exercised no
service-role Edge Function write path, are fixed in migration 0004:
(a) the actor-guarded triggers (`enforce_order_transition`,
`trg_profiles_self_edit`, `trg_runners_self_edit`) treated a
service-role RPC caller (`auth.jwt()->>'role' = 'service_role'`) as a
client and wrongly rejected the trusted Edge Function write path — now
`'service_role'` is treated the same as "no JWT context", which is what
0002's own comment always intended; (b) `custom_access_token_hook` (0002,
SECURITY INVOKER, runs as `supabase_auth_admin`) could never actually
read `staff_roles` because that table has FORCE RLS with zero policies,
so EVERY user — staff included — fell through to the `role='customer'`
branch; fixed with one RLS policy letting exactly `supabase_auth_admin`
SELECT `staff_roles` (hosted-safe, no SECURITY DEFINER / superuser
dependency); (c) `create_order_phase_a` additionally clears
`request.jwt.claims` at the top as belt-and-suspenders for (a).
**Rationale.** [PHASE 4 PROMPT §31, RBAC_MATRIX.md §4] Phase 4 is the
first phase to sign in as a non-customer and the first to write
`orders`/`profiles` through a service-role RPC — both preconditions for
surfacing these. Fixing them in 0004 (not a separate migration) keeps
the change atomic with the phase that needs it.
**Alternatives rejected.** Making the hook SECURITY DEFINER (rejected —
works locally where `postgres` is a superuser, but on hosted Supabase
`postgres` does not bypass FORCE RLS, so the policy is the portable
fix). Granting `staff_roles` SELECT to `authenticated` (rejected —
directly contradicts RBAC_MATRIX.md §5's "no client-facing policy on
this table").

## Phase 5 (2026-08-30, real payments + webhook + refunds)

### D36. Late-capture reconciliation records the money without transitioning `payments.status` out of terminal `failed`
**Decision.** When `payment_webhook` receives a genuine `captured` event
for an order that is already terminal (`payment_failed` after the
reservation-expiry sweep, or `cancelled`) and whose `payments.status` is
`failed`, the reconciliation (`process_payment_webhook`, migration 0005)
does **not** move `payments.status`. It records: a `refunds` row
(`reason='late_capture_reconciliation'`, `actor_id=null`),
`payments.refunded_amount` bumped to the captured amount (keeping the D29
`refunded_amount == SUM(refunds.amount)` invariant), `payments.raw_event`
= the redacted capture payload, `payments.gateway_payment_ref` set, a
`wallet_ledger` credit (`reason='refund'`) + `profiles.wallet_balance`
increment, an `audit_logs` row, and a Sentry alert from the handler.
`orders.status` is never touched. Resting pair: `payment_failed + failed`.
**Rationale.** `PHASE_1_1_CORRECTIONS.md` §9 sketched a
`payment_failed + refunded` resting pair, but migration 0002's
`enforce_payment_transition` (and its pgTAP guard,
`07_order_state_machine_curated_test.sql`) makes a `failed` payment
strictly terminal *by design* — `failed → *` is illegal so a genuinely
failed payment can never later look captured. Phase 5 prompt §6 ("all
transitions must comply with `enforce_payment_transition`") and §21
("never weaken a test") make keeping that invariant intact non-negotiable.
The `refunds` row + `refunded_amount` + redacted `raw_event` + wallet
credit are a complete, auditable record that money was captured late and
returned — the customer is made whole and never receives an order that
was already safely expired/cancelled (§12), which is the actual
requirement. The `payment_order_consistency_rules` entries for
`payment_failed + captured` / `payment_failed + refunded` (migration
0002) are consequently only reachable as within-transaction transients,
never as this path's resting state.
**Alternatives rejected.** Adding `('failed','captured')` to
`payment_transition_rules` (rejected — directly contradicts the "a failed
payment is terminal" invariant the reviewer approved in Phase 4, and would
require rewriting an approved pgTAP assertion). Adding `('failed','refunded')`
directly (same objection). A combined-status enum (already rejected in D30).

### D37. Gateway selected: Razorpay; the real adapter is a drop-in behind the unchanged D12 interface; the mock is production-impossible
**Decision.** Razorpay (not Cashfree) is the Phase 5 gateway.
`supabase/functions/_shared/gateway/razorpay.ts` implements the
**unchanged** `PaymentGatewayAdapter` contract
(`packages/api-contracts/src/gateway.ts`): `createPaymentIntent` → POST
`api.razorpay.com/v1/orders` (Basic auth, 10s abort timeout,
`GatewayError` on any fault); `buildCheckoutParams` → the pure Razorpay
Checkout options object (publishable key id only, never the secret);
`verifyWebhookSignature` → synchronous HMAC-SHA256 (`node:crypto`) over
the **raw** body, constant-time compared to `X-Razorpay-Signature`;
`parseWebhookEvent` → normalizes `payment.captured` / `payment.failed` /
`order.paid`, deriving a stable `gatewayEventId` from the body (the
handler prefers the `x-razorpay-event-id` header when present), and
throwing an `UNSUPPORTED_EVENT:` sentinel for event types Craavee does
not act on. `getGateway()` (`_shared/gateway/index.ts`) is the only
switch: `PAYMENT_GATEWAY=razorpay` (or unset) requires all three
`RAZORPAY_*` secrets and throws if any is missing; `PAYMENT_GATEWAY=mock`
is refused unless `CRAAVEE_ALLOW_MOCK_CONTROL=1` **and** `CRAAVEE_ENV` is
neither `production` nor `staging`; an unset gateway with no creds falls
back to the mock **only** in that same explicitly-permitted dev/CI
context. `create_order`'s Phase A/B/C control flow is unchanged.
**Rationale.** [Phase 5 prompt §2/§3/§25] D12's preferred order is
Razorpay then Cashfree; Razorpay is the more widely-integrated Indian
gateway, its Checkout shape is exactly what the Phase 4 mock already
emulated (`name='razorpay'`, `order_id` shape, `checkoutParams` keys), and
a free test-mode account exercises Orders + webhooks with no KYC. The
project owner confirmed the gateway choice and that no sandbox
credentials are provisioned yet — so the adapter is verified by
deterministic mock fault-injection + direct unit tests of the real
HMAC/parse code, with live-sandbox verification and production KYC
documented as external blockers (`PHASE_5_IMPLEMENTATION_REPORT.md` §2).
**Alternatives rejected.** Cashfree (rejected — Razorpay is D12's first
choice and there is no signal Cashfree KYC clears first). Widening the
`verifyWebhookSignature` return type to `Promise<boolean>` for WebCrypto
(rejected — `node:crypto`'s synchronous `createHmac` keeps the D12
interface byte-for-byte unchanged, which §3 requires). Adding a `refund()`
method to the adapter interface for gateway-instrument refunds (rejected
this phase — see D38).

### D39. Delivery-code plaintext lives in `order_delivery_codes`, not on `orders` (Phase 7)
**Decision.** `orders.delivery_code_hash` keeps the bcrypt hash and stays
the only thing `verify_delivery_code` reads. The 4-digit plaintext is
written to a separate `order_delivery_codes` table whose single RLS
policy is a customer read, and is deleted on `delivered` and on release.
**Why this was needed.** D14 requires two things that cannot both hold
against a hash-only column: the customer must be able to *read* the
plaintext after `assigned` (RBAC_MATRIX.md §5's "Delivery code
(plaintext)" row gives the customer "R (own order, once, after
assigned)"), and the code must never be stored in plaintext. A hash
cannot be un-hashed, so with only `delivery_code_hash` the customer could
never be shown their code and delivery could never complete. Raised with
the owner and decided before implementation.
**Why a separate table rather than a column on `orders`.** Migration 0003
grants `select on orders to authenticated` table-wide, and
`orders_select` already lets a runner read every `packed` row at their
store plus their own assignment. A plaintext column on `orders` would
therefore be readable by the runner — exactly what D14 forbids ("the
runner only submits a guess; they don't get to read the answer"). With a
separate table the runner has no policy at all, so the guarantee is
structural rather than a column-grant detail that a later `select *`
could quietly undo.
**What is preserved from D14.** Hashed at rest for verification; never
visible to the runner, packer or admin; never logged, never in an audit
row, never in Sentry; rate-limited to 5 attempts per order per 15
minutes; minted at assignment and re-minted on reassignment so a replaced
runner cannot complete a delivery they no longer own.

### D38. Phase 5 `refund` is wallet-destination only; a full refund of a live order also cancels it
**Decision.** `refund` (`process_refund`, migration 0005) credits the
customer's **wallet** (`wallet_ledger` `reason='refund'` +
`profiles.wallet_balance`), one transaction, no network I/O. It is
idempotency-keyed (`refunds.idempotency_key UNIQUE` — replay returns the
original, concurrent duplicate resolves to exactly one, same key + a
different amount is a deterministic `ORDER_ALREADY_EXISTS` conflict).
`amount` (optional; omit = full remaining) is bounded by
`payments.amount - payments.refunded_amount` (`REFUND_EXCEEDS_CAPTURED`
otherwise); a non-captured payment gives `PAYMENT_FAILED`. A partial
refund leaves the order where it is (`captured → partially_refunded`,
`orders.payment_status` kept in step). A **full** refund of a still-live
order (`confirmed` / `assigned` / `delivery_failed`) additionally
releases the still-held inventory reservation and transitions the order
to `cancelled` — because `confirmed + refunded` is not a valid resting
pair (`ORDER_STATE_MACHINE.md` §2.1) and every full-refund transition in
that document (#5/#6/#9/#14) is paired with `orders.status → 'cancelled'`.
A full refund of a `packed` / `picked_up` / `delivered` order is rejected
(`INVALID_ORDER_TRANSITION`) — those need the post-pack cancellation flow
(a later phase). **Gateway-instrument refunds are not implemented this
phase.**
**Rationale.** [Phase 5 prompt §13; project owner's Phase 5 decision]
Dossier §18: "Refunds to wallet rather than source ... keep money inside
the system" is the default, and a gateway-instrument refund is "a policy/
support decision per refund," i.e. a later-phase support tool. It also
needs a `PaymentGatewayAdapter` interface addition Phase 5 §3 says not to
make, plus the Razorpay Refunds API + KYC. Every Phase 5 acceptance-gate
refund case (partial, full, over-refund, duplicate, refund-after-full,
refund-on-failed) is fully covered by the wallet path. The project owner
was asked directly and chose "full refund also cancels the order," which
is the only option that keeps the payment/order state pair always valid
without inventing a new resting combination.
**Alternatives rejected.** Refund is payment-only, a full refund needs an
already-terminal order (rejected by the project owner — would leave a
`confirmed` order un-cancellable after a full refund until a later
phase). Adding `confirmed + refunded` etc. to
`payment_order_consistency_rules` (rejected — directly contradicts
`ORDER_STATE_MACHINE.md` §2.1). Building the gateway-refund Phase A/B/C
split now (rejected — YAGNI for this phase's scope, and needs the
interface change §3 forbids).

---

## Decisions explicitly deferred (not resolved here, and not blocking Phase 2)

These are real open questions, listed here rather than silently assumed
answers, per this phase's instruction not to leave unresolved questions
implicit:

- **Referral credit mechanics** (dossier §18 lists referral as a retention
  lever; exact amount/limits are a growth/product decision, not an
  architecture one — the schema in D-10/D-22 supports it via
  `wallet_ledger` + `campaigns` without needing the specific numbers now).
- **Exact OTP rate-limit thresholds** — Supabase Auth has built-in SMS
  rate limiting; whether the defaults are sufficient for an 800-signup-in-
  5-minutes spike (dossier §14 failure mode #1) needs a conversation with
  Supabase support / a plan upgrade, not an architecture decision.
- **Runner shift scheduling structure** — dossier scopes this to Phase P1
  ("scheduled store hours... ratings" — §19), out of scope for the P0
  spec this document covers.
- **Post-delivery goodwill refund** (added Phase 1.1) — no state
  combination or transition supports `delivered` + `refunded`;
  deliberately unmodeled rather than guessed at, see
  `PHASE_1_1_CORRECTIONS.md` §9/§11.
- **Reservation expiry duration (15 minutes)** (added Phase 1.1) — an
  engineering default, not a measured value; see D27 and
  `PHASE_1_1_CORRECTIONS.md` §4.4.
- **`expire_stale_reservations` scheduling mechanism** (`pg_cron` vs. a
  Supabase scheduled Edge Function) (added Phase 1.1) — mechanically
  equivalent for this spec's purposes, left to whoever implements Phase 5.

See `PHASE_PLAN.md` for how these map onto phases; see
`ENGINEERING_SPECIFICATION.md` §L and `PHASE_1_1_CORRECTIONS.md` §11 for
the final open-decisions list.
