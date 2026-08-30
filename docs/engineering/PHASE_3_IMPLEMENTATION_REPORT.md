# Phase 3 — Real Authentication + Live Catalog Implementation Report

First real product-feature phase. A real customer can now open the app,
sign in with a real phone OTP, land on a route-protected customer
experience, read the live product catalog from Postgres, and log out —
all through the actual Supabase Auth + PostgREST HTTP path, not a mock.

**Formal gate: REAL PHONE OTP WORKS + SESSION IS A REAL SUPABASE SESSION +
ROLE COMES FROM A VERIFIED JWT CLAIM + ROUTE PROTECTION WORKS + CATALOG IS
LIVE + RLS PROVEN OVER THE REAL API + 218/218 DATABASE ASSERTIONS STILL
GREEN — MET.** Full acceptance checklist in §13. One limitation carried
forward, unresolved and explicitly not hidden: §12.

---

## 1. Authentication architecture

Supabase Auth, phone OTP, exactly as specified (`SECURITY_MODEL.md` §1) —
no custom OTP, no passwords, no magic link, no NextAuth, no localStorage
identity.

**`apps/customer-runner/lib/supabase.ts`** — the one Supabase client this
app uses. `signInWithOtp({ phone })` → `verifyOtp({ phone, token, type:
"sms" })`, both called from `app/(auth)/phone.tsx` and `app/(auth)/
verify.tsx`. `phone.tsx` fixes the country code to `+91` (the dossier's
campus/India market) rather than half-building a country picker nothing
asked for; flagged in that file's own comment as a real, scoped
simplification.

## 2. Session architecture

Native (iOS/Android): `LargeSecureStore` — the pattern documented at
`supabase.com/docs/reference/javascript/initializing`'s React Native
section, fetched and read in full before writing this. Expo `SecureStore`
(iOS Keychain / Android Keystore) can't hold values over 2048 bytes, which
a session (access + refresh token + user object) regularly exceeds, so a
random AES-256 key is generated per storage key and kept in SecureStore,
while the session JSON itself is AES-encrypted and persisted in
AsyncStorage. This is not "an arbitrary custom JSON object in
localStorage" (the explicit prohibition) — the persisted value is
ciphertext, unreadable without the Keychain/Keystore-protected key.
`react-native-get-random-values` (real CSPRNG for the AES key) and
`react-native-url-polyfill` are wired per Supabase's own documented
requirement for this pattern.

Web: falls back to `storage: undefined`, which makes `@supabase/
supabase-js` use its own default browser persistence (`localStorage`) —
the Supabase-supported browser mechanism the instruction calls for
explicitly. `AppState`-driven `startAutoRefresh()`/`stopAutoRefresh()`
wired for native only (browsers don't need it; confirmed this is a
documented Supabase RN-specific requirement, not a web one).

`apps/store`/`apps/console` (Next.js): `@supabase/ssr`'s browser/server
client split (`src/lib/supabase/{client,server}.ts`), cookie-based —
plumbing only, no operational auth flow yet (§9 below).

## 3. Role claim integration — and a real bug this phase found and fixed

`AuthProvider` (`lib/auth/AuthProvider.tsx`) never reads `session.user`
for role — it calls `supabase.auth.getClaims()`, which **verifies** the
JWT before handing back its claims (confirmed by reading `@supabase/
auth-js`'s own `getClaims()` implementation, not assumed: for this
project's local/HS256 setup, `getClaims()` falls back to a `getUser()`
round-trip against the Auth server, since there's no public key to verify
an HS256 signature client-side; for a production project on asymmetric
signing keys it verifies the signature locally instead). Either way, by
the time `role` reaches `resolveRouteAccess`, it has been through real
verification — never a client-trusted decode, never a client-supplied
field.

**A genuine, pre-existing bug, found only because this phase exercised
the real Auth+PostgREST HTTP path for the first time (Phase 2/2A's 218
pgTAP assertions all run directly over `psql`, which never goes through
PostgREST's request pipeline at all):** `custom_access_token_hook`
(0002) overwrites the JWT's top-level `role` claim with the app-level
value (`'customer'`/`'packer'`/`'runner'`/`'admin'`) — this is the exact
pattern Supabase's own Custom Access Token Hook documentation shows
(`claims['role'] = claims.app_metadata.role`). What that pattern
*requires*, which nothing before this phase had done, is a matching real
Postgres role for every value the claim can take — PostgREST reads that
same top-level `role` claim to `SET ROLE <value>` for the request, not
merely to make it available to `auth.jwt()` inside policies, and fails
the whole request with `role "customer" does not exist` if none exists.
Confirmed by reading GoTrue's own source (`internal/api/verify.go`,
`internal/models/user.go`, v2.195.0) after reproducing the failure
directly against the local stack.

**Fix** (`supabase/migrations/0003_rls_policies.sql`, new §-1 block):
creates `customer`/`packer`/`runner`/`admin` as real, `NOLOGIN` Postgres
roles, each granted `authenticated`'s existing privileges via `GRANT
authenticated TO <role>` (every table grant in this file still targets
`authenticated` only — unchanged, not duplicated), and grants all four to
`authenticator` (the role PostgREST itself connects as) so it's actually
allowed to switch to them. `auth_role()` and every RLS policy are
untouched and unaffected — the JWT payload's `role` value is identical to
before; only the *session's actual Postgres role* now successfully
becomes that value instead of erroring. Verified: `npm run db:test` still
218/218 green after this change (§8).

A second, smaller, related gap surfaced seeding realistic phone-OTP test
users to exercise this at all — see §5's seed-data section.

## 4. Auth routing

`lib/auth/resolveRouteAccess.ts` — a pure function, zero dependency on
Supabase/Expo Router/React, unit-tested exhaustively (8 cases,
`lib/auth/__tests__/resolveRouteAccess.test.ts`) including the
redirect-loop-shaped edge cases: an authenticated `packer`/`admin`
session (real roles, RBAC_MATRIX.md §1 — just not ones this app has a
route group for; Store/Console are their surfaces) resolves to a
dedicated `/unsupported-role` screen that is itself a stable, allowed
destination for them, not a further redirect target. `AuthBoundary`
(mounted once, at the root layout, above the route-group `<Stack>`) reads
the current top-level segment via `useSegments()` and does exactly what
this function says — it holds no routing logic of its own.

No client-supplied role/localStorage/URL param/request field is ever
read as authorization anywhere in this app — confirmed by construction
(role only ever flows from `AuthProvider`, which only ever gets it from
`getClaims()`) and by grep (no other read of a `role` value exists in
`apps/customer-runner`).

## 5. Profile integration

`hooks/useProfile.ts` reads the caller's own `profiles` row through the
existing `profiles_select` RLS policy — no new profile-creation API, as
instructed. The row is created by `handle_new_user` (unchanged from
Phase 2) on first `auth.users` insert, which phone verification triggers
naturally.

**Seed data gap found and fixed** (`supabase/seed.sql`): the configured
local test-OTP phones (`config.toml`'s `[auth.sms.test_otp]`,
`9990000001`–`03`) had no matching `auth.users` rows at all — configured
but unusable. Fixing this to actually test phone OTP locally surfaced
three more real, structural gaps in every seeded `auth.users` row (not
just the ones this phase added — the same gap existed for the nine
demo customers/staff/runners already seeded in Phase 2, previously
undetected because nothing had ever signed in as them through the real
Auth API):

1. No matching `auth.identities` row (`provider='phone'`) — a real
   signup writes one.
2. `aud`/`role`/`instance_id` left NULL — GoTrue's `FindUserByPhone
   AndAudience` filters on `instance_id = <uuid.Nil> and aud = ?`, and a
   NULL `instance_id` never equals the nil UUID.
3. `confirmation_token`/`recovery_token`/`email_change_token_new`/
   `email_change` left NULL with no column default — GoTrue's Go struct
   scans these as plain (non-nullable) `string`, and NULL crashes the
   whole `/verify` request with a 500.

Each was root-caused by reading GoTrue's actual source (v2.195.0) after
reproducing the exact failure locally, not guessed at — see the extensive
comments left in `seed.sql` at each fix, which double as the record of
how this was diagnosed. Also added: `00000000-...-1901`/`1902`/`1903`,
three intentionally-undecorated `auth.users` rows (no `full_name`, no
address, no wallet credit) for `9990000001`–`03` themselves, so the
configured test-OTP mechanism is actually usable, not configured-but-
dangling.

Verified end-to-end against the real API (integration test suite, §7):
own profile readable with the correct shape; a second signed-in customer
cannot read the first's profile row (RLS hides it — zero rows, not an
error); a signed-out client's profile read is denied outright (`anon` has
no grant on `profiles` at all, RBAC_MATRIX.md §5).

## 6. Catalog integration

`hooks/useCatalog.ts` reads `products_with_availability` (existing view,
`0003_rls_policies.sql` — not a new one, per the instruction to use it if
the spec already defines one). Selected columns: `id, name, brand,
image_url, mrp, sale_price, unit_label, category, is_available` — no
supplier/admin-only/internal-inventory field is even in the select list,
let alone exposed; `is_available` is the view's own server-computed
boolean (`qty_on_hand - qty_reserved > 0`), never an exact count. Typed
via `@craavee/types`' generated `Database` type — no hand-recreated
product type. `packages/types` was not modified.

The view is granted to `authenticated, anon` (`0003_rls_policies.sql`) —
RBAC_MATRIX.md's "own store" note for a customer is a UX/app-level
scoping concern here, not an RLS restriction; the seed data has exactly
one store, so no store filter is applied this phase (a real multi-store
selector depends on the customer's address/zone, which is explicitly out
of scope — "cart persistence changes beyond what is needed for catalog
integration"). Flagged in `useCatalog.ts`'s own comment. This app still
only ever calls the catalog query from behind the auth-gated `(customer)`
route group, even though the database itself would also permit a
pre-auth read — a deliberate product-flow choice (§6 of the phase
objective), not a security assumption resting on it.

No mock product array remains anywhere in `apps/customer-runner` —
confirmed by grep (no `mock`/hardcoded product literal exists in `app/`,
`components/`, or `hooks/`).

## 7. Availability, UX, and TanStack Query

`components/catalog/ProductCard.tsx` — `expo-image` (approved image
architecture), sold-out products rendered dimmed with a "Sold out" label
rather than hidden (proven against a real seeded zero-stock product,
"Bananas" — §8's integration tests). `components/catalog/CatalogStates.tsx`
— loading skeleton, empty state, error state with a retry action wired to
`refetch()`. `FlashList` (v2 API — no `estimatedItemSize`, confirmed
against its shipped type declarations before using it) renders the list
with pull-to-refresh.

TanStack Query: `queryKey: ["catalog"]`, `staleTime: 60_000`, `retry: 2`
(also set as the `QueryClient`'s own defaults in the root layout, with
`refetchOnWindowFocus: false` — a mobile app has no "window focus" in the
browser-tab sense, and the catalog doesn't need a full refetch on every
screen transition). Cache invalidation strategy: none built yet, by
design — nothing in this phase mutates catalog/inventory data, so there
is nothing to invalidate against; the moment `create_order`/`mark_stock_
out` exist (Phase 4+), those call sites own the resulting `queryClient.
invalidateQueries(["catalog"])`, not this phase's read-only screens.
Zustand was not used for catalog state, per the explicit instruction.

## 8. Tests

**Unit (no network, `npm run test`, both new this phase):**

| File | Tests | Proves |
|---|---|---|
| `lib/auth/__tests__/resolveRouteAccess.test.ts` | 8 | Every routing-decision branch, incl. the redirect-loop-shaped unsupported-role cases |
| `lib/auth/__tests__/errors.test.ts` | 6 | Supabase/network errors map to the canonical `AuthErrorCode` set, never surfacing raw internals |
| `packages/validation`'s new `primitives.test.ts` | 6 | `phoneE164Schema`/`otpCodeSchema` format checks |

**Integration (real local Supabase, `npm run test:integration`, new this
phase, `apps/customer-runner/__tests__/auth-catalog.integration.test.ts`,
11 tests):** every one of Phase 3 §20's AUTH/PROFILE/CATALOG items that
can only be proven against a real backend — a real phone-OTP round-trip
issuing a session with a verified `customer` role claim; wrong-OTP
rejection; session refresh; own-profile read; cross-customer profile
isolation; post-logout access revocation; live catalog with the exact
column shape (and the absence of internal fields) proven directly, not
asserted; the seeded out-of-stock product reported unavailable; an
empty-result-set query; an unreachable-endpoint query surfacing a real,
retryable error. Item §20.1 (unauthenticated → redirected) and §20.7
(runner routed away from customer routes) are covered by the unit-tested
`resolveRouteAccess` above, deliberately not re-proven over the network —
that would just be a slower, less precise repeat of the same assertions
already proven exhaustively as pure logic.

Not mocking the Supabase client for these, per the explicit instruction —
`freshClient()` is the real `@supabase/supabase-js`, pointed at the real
local stack.

```
lib/auth/__tests__/*.test.ts        → 14 pass, 0 fail
packages/validation                 → 13 pass, 0 fail (7 pre-existing + 6 new)
packages/api-contracts              → 3 pass, 0 fail (unchanged)
__tests__/auth-catalog.integration  → 11 pass, 0 fail
```

## 9. Store/Console auth foundation (utilities only)

`apps/{store,console}/src/lib/supabase/{client,server,updateSession}.ts` +
`apps/{store,console}/proxy.ts`. **`proxy.ts`, not `middleware.ts`** —
Next.js 16.0+ deprecated and renamed the middleware file convention;
confirmed against the current Next.js docs before writing this (the
project's own `apps/customer-runner/AGENTS.md` standing instruction to
verify current API applies equally here). `proxy.ts` only refreshes the
session cookie (`updateSession.ts`, `@supabase/ssr`'s documented Next.js
pattern, `getClaims()` not `getSession()` for the same
verified-vs-trusted reason as `AuthProvider`) — no route guards, no login
screen, no protected page, per the explicit "do NOT build their
operational functionality yet." Smoke-tested: `next dev` with real local
Supabase env vars set, `GET /` → 200, proxy ran without error against the
live Auth server for an unauthenticated request.

## 10. Auth error handling

`lib/auth/errors.ts` — `AUTH_ERROR_CODES`: `INVALID_PHONE`,
`OTP_SEND_FAILED`, `INVALID_OTP`, `OTP_EXPIRED`, `SESSION_EXPIRED`,
`NETWORK_ERROR`, `RATE_LIMITED`, `UNKNOWN`. Matches on HTTP `status` first
(stable across SDK versions), message substring only as a fallback,
never the reverse. No raw Supabase/Postgres error ever reaches the UI —
every call site in `phone.tsx`/`verify.tsx` routes through `toAuthUiError`
first. No invented business-error codes (`API_CONTRACTS.md`'s
`ErrorCode` catalogue) for a feature with no Edge Function involved —
this is a deliberately separate, smaller set for a deliberately
different concern.

## 11. Rate limiting

No custom rate limiter (Redis or otherwise) — Supabase Auth's own
project-level limits are the real control (`SECURITY_MODEL.md` §5).
UI-level spam prevention only, not claimed as a security boundary:
`phone.tsx`'s send button disables while a request is in flight;
`verify.tsx`'s resend button is disabled during a 30-second countdown and
while a resend request is in flight.

## 12. Known limitation — Expo Metro bundling still not verified in this sandbox

Phase 2B documented `expo export` hanging indefinitely right after
"Starting Metro Bundler." This phase re-tested it (platform `android`,
then `web`, after installing `react-native-web`/`react-dom`/`@expo/
metro-runtime` for the web target §16 asks for) and it still hangs
identically, platform-independent.

**One thing this phase corrects from the Phase 2B report:** that
report's "most likely explanation" was a missing TTY. This phase tested
that hypothesis directly — re-ran the export wrapped in `script -q
/dev/null` (allocates a real pseudo-TTY) — and it hung identically. **The
TTY hypothesis is now disproven, not just untested.** The actual cause
remains undiagnosed; what's newly established is that it is not that.

Everything short of the live bundle continues to check out: `tsc
--noEmit` passes clean (re-verified after every dependency added this
phase, including the web-target packages), `expo-doctor` passes 20/21
(the sole failure is the same understood-and-not-fixable-without-
regression React/React-DOM version duplicate documented in Phase 2B —
now also reporting the react-dom pair for the same reason). Per the
explicit instruction not to spend this phase solving it absent a real
project-configuration finding, and having found none, this is documented
rather than chased further.

**Recommended next step, unchanged in substance from Phase 2B:** run
`npx expo start` (or `expo export`) on a real interactive terminal outside
this sandboxed batch-command environment. If it also hangs there, the
cause is something about this exact dependency/Node-version combination
rather than the sandbox itself, and is worth its own focused
investigation with real Metro debug tooling attached (a debugger, not
just `DEBUG=metro:*`, which — also re-confirmed this phase — produces
zero output at all, meaning the hang is upstream of Metro's own internals
ever starting to log).

## 13. Phase 3 acceptance criteria — exact status

- [x] real phone OTP works (verified end-to-end against the real local Auth API, §8)
- [x] authenticated session is a real Supabase session (`@supabase/supabase-js`, no custom session object)
- [x] customer role comes from the server-issued JWT claim (`getClaims()`, verified not trusted — §3)
- [x] customer route protection works (`resolveRouteAccess`, 8/8 unit tests)
- [x] logout works (session cleared, subsequent profile read denied — proven, §8)
- [x] profile is created by the DB trigger (`handle_new_user`, unmodified from Phase 2)
- [x] customer can read own profile
- [x] customer cannot read another profile
- [x] catalog reads from live PostgreSQL (`products_with_availability`)
- [x] no old mock catalog path remains
- [x] availability comes from real inventory (`is_available`, server-computed)
- [x] loading/error/empty states work
- [x] catalog tests pass (integration suite, real data)
- [x] auth tests pass (unit + integration)
- [x] existing 218 database assertions remain green (re-verified after the Postgres-role fix and the seed-data fixes)
- [x] typecheck passes (all 7 workspaces)
- [x] lint passes (0 errors, same 4 pre-existing documented warnings)
- [x] Store build passes
- [x] Console build passes
- [x] Expo typecheck/doctor passes (doctor: 20/21, documented React/React-DOM duplicate, unchanged class of issue from Phase 2B)
- [x] no secrets committed (`.env.local` files gitignored; only the well-known local-dev anon key ever used, never service-role)
- [x] no Phase 4 business logic was implemented (no `create_order`, no payment, no wallet spend, no promo, no runner claim, no store/console operational pages, no Realtime, no push notifications)

**Formal gate: MET**, with §12's Metro-bundling limitation carried
forward explicitly, not hidden, exactly as Phase 2B's was.

## 14. Recommended Phase 4 starting point

Per the explicit stop condition, none of the following was started this
phase: cart checkout changes, order creation, payment, wallet redemption,
promo redemption, runner claim, packing, Realtime, push notifications.
`create_order` (`API_CONTRACTS.md` §3) is the natural Phase 4 entry
point — it now has a real, verified customer session and a real,
authenticated catalog to build a cart/checkout flow on top of, and every
Postgres-role/seed-data fix this phase made means Phase 4's own
integration tests (order placement, wallet spend, promo redemption) will
hit the same real Auth+PostgREST path this phase's tests do, not a path
that silently only worked over `psql`.
