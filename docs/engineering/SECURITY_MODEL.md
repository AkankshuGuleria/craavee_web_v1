# Security Model

Governing rule throughout: **the database is the final enforcement layer.**
Every mechanism below exists because a client, however well-behaved most
of the time, is an untrusted input source.

## 1. Authentication flow (Supabase Auth, phone OTP)

**Sign-in (new or returning user, same flow — Supabase Auth doesn't
distinguish):**
1. Client submits phone number to Supabase Auth's OTP-send endpoint.
2. Supabase sends an SMS OTP (rate-limited by Supabase itself at the
   project level — see §5 on the OTP-throughput risk from dossier §14).
3. Client submits the OTP; Supabase Auth verifies and issues a session
   (access JWT + refresh token).
4. A Postgres trigger (`handle_new_user`, `AFTER INSERT ON auth.users`)
   creates the matching `profiles` row on first sign-in — `phone` copied
   from `auth.users.phone`, `wallet_balance = 0`, no `staff_roles` row
   (so the new user is a `customer` by default, per D8). Returning users
   skip this — the trigger only fires on `auth.users` insert, not every
   sign-in.
5. The Custom Access Token Auth Hook (D8) runs on every token mint/
   refresh, looks up `staff_roles` by the authenticating user's ID, and
   injects `role` into the JWT's claims (`'customer'` if no row found).

**First-time profile creation:** exactly step 4 above — no separate
"complete your profile" flow blocks ordering; `full_name` can be filled
in later (or never) without blocking checkout, since nothing in the order
flow requires it beyond having *an* address on file.

**JWT/session behavior:** standard Supabase — short-lived access token
(default 1 hour), long-lived refresh token, client SDK (`@supabase/
supabase-js` on web, `@supabase/supabase-js` + secure storage on Expo)
handles silent refresh. No custom session handling is built — Supabase's
default is sufficient and re-implementing it is exactly the kind of
unnecessary custom auth code this spec avoids.

**Role acquisition:** exclusively through `assign_staff_role`
(`API_CONTRACTS.md`), callable only by an existing `admin`. There is no
self-service path to `packer`/`runner`/`admin` — a runner recruit is
onboarded by an admin creating their `staff_roles` row after (outside the
system) confirming their identity, consistent with dossier §5's "runners:
students, paid per delivery" being a real-world recruitment process, not
a signup form.

**Refresh behavior:** on `role` change (an admin promotes/demotes staff
mid-session), the change takes effect on the *next token refresh*, not
instantly — an already-issued JWT is valid until it expires (max 1 hour
exposure window). Acceptable for this product's stakes; flagged here so
it's a documented decision, not a surprise.

**Logout:** standard Supabase `signOut()` — revokes the refresh token
server-side, client clears local session storage.

**Revoked/disabled users:** handled via Supabase Auth's own `banned_
until`/user-disable mechanism (admin-triggered through the Supabase
dashboard or an admin-only Edge Function wrapping the Supabase Admin API
— not built as custom Craavee logic, since Supabase already provides
this correctly). A disabled user's existing JWT remains valid until
expiry (same 1-hour window caveat as role changes) — acceptable, not
flagged as needing a custom instant-revocation mechanism at this scale.

**Staff onboarding:** admin creates the `staff_roles` row (`assign_
staff_role`) *after* the staff member has completed ordinary customer
phone-OTP sign-in at least once (so a `profiles` row exists to attach the
role to) — no separate staff sign-up flow.

**Customer onboarding:** phone OTP sign-in → land on catalog. Address
collection happens at first checkout, not at signup (dossier §7.1: "Address
is captured at checkout, not at signup").

## 2. Threat model

| Threat actor | Vector | Mitigation |
|---|---|---|
| **Malicious customer** | Tampered `create_order` payload with a fake/low price | Structurally impossible — `create_order` never reads a price from the request; price is looked up server-side from `products.sale_price` at transaction time (`API_CONTRACTS.md`) |
| | Double-submit an order to get it twice | `idempotencyKey` UNIQUE, D23 |
| | Claim a runner/admin role via a crafted JWT or request | Role is server-injected via Auth Hook (D8); no request field is ever read as a role by any RLS policy or Edge Function |
| | Read another customer's order/wallet/address | RLS `customer_id = auth.uid()` on every customer-scoped table; verified per-table in `RBAC_MATRIX.md` §5 |
| | Brute-force another customer's delivery code to falsely claim non-delivery or interfere | Code is never runner/customer cross-visible in a way that helps this; more relevantly, `verify_delivery_code` is runner-authenticated and rate-limited (5 attempts, D14) — a customer has no path to this endpoint for another customer's order at all (RLS/role check) |
| **Malicious runner** | Mark an order `delivered` without the code | Impossible via direct write — `orders.status` has no non-admin, non-EF write path at all (RBAC_MATRIX §5); `verify_delivery_code` requires the actual hash match |
| | Claim more than one job | Partial unique index (D13) — database-level, not just application logic |
| | Read a customer's payment/wallet info | No runner RLS policy on `payments`/`refunds`/`wallet_ledger` at all (RBAC_MATRIX §2) |
| | See other customers' order history via the claimable-queue read | Runner `orders` policy scopes to `status='packed' AND store_id=own` (claimable, no customer PII beyond what's needed to decide whether to claim) or `runner_id IN (own runners.id, D28)` (assigned) — never a full history |
| | Be assigned an order despite never being onboarded as a runner | Structurally impossible — `orders.runner_id` is a foreign key into `runners`, not `profiles` (D28, Phase 1.1); there is no `runners` row to reference for an account that hasn't been onboarded, so the FK constraint itself rejects it independent of any application-level check |
| **Compromised/modified client** (rooted device, intercepted+replayed request, hand-crafted API call bypassing the app entirely) | Any of the above, attempted directly against the API rather than through the UI | Every mitigation above is enforced server-side/database-side, not by "the app wouldn't let you" — this is the whole point of the RLS+Edge-Function architecture and is true regardless of client integrity |
| | Replayed request (a captured, valid request resent later) | Most mutating endpoints are idempotent or naturally reject a stale replay via the state machine (`API_CONTRACTS.md` §6); `payment_webhook` specifically is signature-verified per-request, and a replayed *old* webhook is caught by the `webhook_events` UNIQUE check regardless of how old it is |
| | Rapid repeated `create_order` calls during Phase B's 60-second claim window, attempting to force two gateway intents for one order | The claim marker (`payments.gateway_intent_requested_at`, D24) makes every retry within the window a no-op that returns `payment_setup_in_progress` rather than calling the gateway again — `PHASE_1_1_CORRECTIONS.md` §4 |
| **Forged webhook** (attacker posts a fake "payment captured" event) | Direct POST to `payment_webhook` claiming a payment succeeded | Signature verification against the raw body using the gateway's secret (D12) rejects anything not actually signed by the gateway, before any parsing happens |
| **Late/legitimate capture for a terminal order** (not an attack — a real edge case where a customer's payment actually clears after their order already expired/was cancelled) | A genuine gateway webhook confirming capture for an order already `payment_failed`/`cancelled` | Not silently resurrected — `payment_webhook`'s reconciliation branch (D30, `API_CONTRACTS.md`) captures the fact, then immediately auto-refunds the customer's wallet for the full amount in the same transaction, with an admin alert. Named here as a threat-model entry because an unhandled version of this case (money captured, order not tracking it, no refund issued) would be a real customer-harm bug, not because it's an attack |
| **OTP abuse** (spamming SMS sends, e.g. to run up a bill or as harassment via someone else's number) | Repeated OTP-send requests | Supabase Auth's built-in per-phone/per-IP rate limiting is the first line; dossier §14 flags this as a real launch-day risk at volume (800 signups in 5 minutes) — see §5 below for the operational mitigation, since this is fundamentally a capacity question, not purely a security one |
| **Enumeration** (probing which phone numbers/order IDs exist) | Sequential/guessable IDs | UUID PKs (D5) make order/profile ID guessing infeasible; OTP-send responses are deliberately generic ("code sent if this number is valid") rather than confirming/denying account existence — a Phase 3 implementation detail flagged here so it isn't missed |
| **Unauthorized admin access** | A `packer`/`runner` account attempting admin actions | Every admin-only Edge Function checks role explicitly (service role bypasses RLS, so the function's own check is the enforcement — RBAC_MATRIX §5 documents this per-function); no admin capability is reachable via a direct PostgREST write a non-admin role's RLS policy would allow |
| **Leaked client-side secrets** | Service-role key or gateway secret shipped in an app bundle | Categorically prevented by the env-var classification in §3 — service-role and gateway-webhook secrets are `EDGE_FUNCTION_ONLY`, never bundled into the Expo app or Next.js client bundle; enforced by convention + a CI check (`DEPLOYMENT_TOPOLOGY.md`) that fails the build if a `SERVER_ONLY`/`EDGE_FUNCTION_ONLY`-prefixed var is referenced from client code |

## 3. Secrets & environment configuration

| Variable | Category | Used by | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_URL` | `PUBLIC` | All clients | Project URL, not a secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `PUBLIC` | All clients | Anon key is meant to be public — RLS is what protects data, not this key's secrecy |
| `SUPABASE_SERVICE_ROLE_KEY` | `EDGE_FUNCTION_ONLY` | Edge Functions | **Never** in any client bundle, `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` prefix, or committed file |
| `RAZORPAY_KEY_ID` / `CASHFREE_APP_ID` | `SERVER_ONLY` (Next.js Store/Console, if they ever create intents server-side) or `EDGE_FUNCTION_ONLY` | Edge Functions primarily | Public-ish per gateway convention but treated as server-only here for simplicity — no client needs it directly since `create_order` returns pre-built `checkoutParams` |
| `RAZORPAY_KEY_SECRET` / `CASHFREE_SECRET_KEY` | `EDGE_FUNCTION_ONLY` | `create_order`, `refund` | Used to create payment intents / issue refunds server-side |
| `RAZORPAY_WEBHOOK_SECRET` / `CASHFREE_WEBHOOK_SECRET` | `EDGE_FUNCTION_ONLY` | `payment_webhook` | Signature verification only |
| `SENTRY_DSN` | `PUBLIC` (client-side DSNs are meant to be public by Sentry's own design) | All clients + Edge Functions | Standard Sentry convention |
| `POSTHOG_API_KEY` | `PUBLIC` | Customer/Runner/Store/Console clients | Standard PostHog convention (write-only key) |
| `SUPABASE_DB_URL` (direct Postgres connection, Supavisor pooled) | `CI_ONLY` | Migration runner in CI | Never needed by application runtime code, which talks to Supabase via the client SDK, not a raw connection string |
| `EAS_PROJECT_ID` | `CI_ONLY` | EAS build pipeline | Not runtime-relevant |

Proposed `.env.example` (values omitted, structure only — Phase 1 does not
create real secrets):

```
# Public — safe in any client bundle
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
SENTRY_DSN=
POSTHOG_API_KEY=

# Edge Function only — set via `supabase secrets set`, never in a
# committed .env file, never in a client bundle
SUPABASE_SERVICE_ROLE_KEY=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
CASHFREE_SECRET_KEY=
CASHFREE_WEBHOOK_SECRET=

# CI only
SUPABASE_DB_URL=
EAS_PROJECT_ID=
```

**Dev/staging/production separation:** three separate Supabase projects
(not schemas within one project — full isolation, since staging needs to
be safe to load-test/break without touching real customer data or real
gateway transactions). Gateway credentials: Razorpay/Cashfree test-mode
keys for dev+staging, live keys for production only, stored via each
platform's secret manager (Supabase project secrets, Vercel environment
variables, EAS secrets) — never in a committed file at any tier.

## 4. Audit log and webhook payload handling (new, Phase 1.1 — `DECISION_LOG.md` D32)

Reviewed explicitly in the Phase 1.1 correctness pass — full rationale in
`PHASE_1_1_CORRECTIONS.md` §2/§8 and D32; specified here as the canonical
security-relevant detail.

**`audit_logs` — who can read/write:**
- **Write:** service role only, always. No customer, packer, runner, or
  admin session ever writes a row directly — every row is written by an
  Edge Function, inside the same transaction as the business change it
  records (`RBAC_MATRIX.md` §5 confirms no `authenticated` `INSERT`
  policy exists on this table at all).
- **Read:** `admin` only (`RBAC_MATRIX.md` §5).
- **`actor_id` nullability:** non-null for every human-initiated action;
  null **only** for genuinely system-initiated rows — `expire_stale_
  reservations`' sweep transitions, and `payment_webhook`'s late-capture
  reconciliation branch (§ Threat model below).
- **What it never contains:** a raw gateway webhook payload, a card
  number, a UPI VPA, or a delivery code in plaintext. `metadata jsonb`
  holds only structurally necessary fields (e.g. `{from_status,
  to_status, reason}`) — an audit log's job is to answer "what changed
  and who changed it," not to be a second copy of sensitive payment
  detail.

**Webhook payload storage (`webhook_events.payload`,
`payments.raw_event`):**
- **What's stored:** the gateway's event payload, **redacted at write
  time** (before the row is ever committed, not as an after-the-fact
  cleanup pass) — payment-instrument identifiers (VPA, masked card
  number beyond the last 4 digits, bank account/IFSC detail) are
  stripped; whatever remains is enough for reconciliation (amount, gateway
  order/payment references, status, timestamps) without being enough to
  reconstruct a customer's payment instrument.
- **Retention:** 180 days, then purged by a scheduled job — matching a
  typical card-network chargeback/dispute window, past which the
  diagnostic value no longer justifies retaining the sensitive detail.
  `audit_logs` itself is retained indefinitely, since (per above) it
  never held the sensitive detail to begin with.
- **Who can access it:** `admin` only, same as `audit_logs` — see
  `RBAC_MATRIX.md`'s `payments`/`webhook_events` entries.
- **Not appropriate:** indefinite, unredacted retention "just in case" —
  rejected explicitly in D32 as expanding the blast radius of any future
  database compromise for no benefit past the reconciliation window.

## 5. Notes carried over from `docs/audit/SECURITY_AUDIT.md`

Every finding in that Phase 0 document is addressed by this spec's
architecture: client-trusted totals (§1 above, `create_order`), missing
idempotency (D23), missing role model (D8), missing RLS (`RBAC_MATRIX.md`
throughout), and unauthenticated operational URLs (resolved structurally —
Store/Console/Runner surfaces will require an authenticated session with
the matching role before rendering any real data, enforced by both
Next.js middleware/Expo routing at the UI layer *and* RLS at the data
layer, per this document's "never client-only" rule applying to the UI
gate too, not just the API).
