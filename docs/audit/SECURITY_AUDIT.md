# Security Audit — craavee_web_v1

Audit date: 2026-08-29. Scope: current repository only (pre-implementation).
Dossier's governing rule: **"Enforcement never lives in the client."**
[DOSSIER]

## Headline finding

Enforcement currently lives **nowhere** — not the client, not a server, not
a database. This is a different (worse) starting condition than "client-only
checks that a network inspector can bypass," because there is no check to
bypass in the first place. [FACT]

## Findings

### 1. Operational surfaces are public, unauthenticated URLs
`/live-ops` (ops console), `/packing` (store queue), `/catalog` (admin
catalog CRUD UI), `/queue` and `/active` (runner app) are all reachable by
any anonymous visitor who knows or guesses the URL. Next.js route groups
`(admin)`/`(runner)` do not create a URL prefix, so there is no namespace
separation either. No `middleware.ts` exists. No route contains a role
check of any kind, client or server. [FACT] — **Critical**, though these
pages currently render only hardcoded mock data, so the practical impact
today is limited to "anyone can see what the admin console will eventually
look like," not real data exposure.

### 2. Client-provided totals are trusted (by the API stub, in principle)
`POST /api/orders` reads `body.totalCredits || 0` directly from the request
body and stores it as the order total with no server-side price
computation. [FACT: `src/app/api/orders/route.ts:40`] This is the exact
anti-pattern the dossier's payment rules forbid: "Amounts are computed
server-side. The client never sends a price. Ever." [DOSSIER §9] Not
exploitable for real money today (no payment is wired to this endpoint),
but it demonstrates the pattern would need to be rebuilt, not extended, when
payments are added.

### 3. No idempotency anywhere
Order IDs are generated as `String(Date.now())` client-request-time on the
server. [FACT: `src/app/api/orders/route.ts:37`] Two rapid submissions (a
retried request, a double-tap) create two separate orders with no
deduplication. No `idempotency_key` field exists on the `Order` type or the
static schema.

### 4. No signature verification / webhook handling exists
There is no payment gateway integration of any kind, so there is nothing to
verify yet — but flagging explicitly since dossier §9 treats "signature
verification on every webhook" as non-negotiable and it must be designed in
from the first payment-handling code, not retrofitted.

### 5. Fake auth is fully client-side and unauthenticated
`Providers.signIn(email)` accepts any string containing `@`, derives a
display name from it, and stores `{ email, name }` in `localStorage` with
no network call. [FACT: `src/components/providers.tsx:172-187`] There is no
password, no OTP, no session token, and nothing prevents a user from
hand-editing `localStorage.craavee_user` to claim any identity — moot today
since no server ever reads this value, but it means the "auth" system as it
exists provides zero actual identity assurance and cannot be extended,
only replaced.

### 6. No role/capability model exists at all
The `User` type includes a `role: "customer" | "runner" | "admin"` field
[FACT: `src/types/index.ts:4`], but nothing in the running application ever
reads or sets it — the fake auth context (`AuthUser`) doesn't even include a
`role` field. There is no mechanism, client or server, that currently
distinguishes a customer from an admin.

### 7. No secrets in source
No `.env` file, no hardcoded API keys, no service-role tokens found in a
full-repo grep. [FACT] This is good, but it's an absence-of-integration
finding, not an absence-of-vulnerability finding — there is nothing to leak
yet because nothing is connected yet.

### 8. No input validation
API routes destructure `request.json()` with no schema validation (no zod,
no manual shape-checking beyond a try/catch around JSON parsing). A
malformed or malicious payload (e.g. `status: "delivered"` sent directly on
a freshly-placed order, or a negative `quantity`) is accepted without
question by `PATCH /api/orders`. [FACT: `src/app/api/orders/route.ts:58-84`]
This directly maps to dossier correctness guarantee #6 ("no illegal order
transitions") — currently there is no transition table enforcement of any
kind, illegal or otherwise.

### 9. No rate limiting / abuse controls
Nothing prevents rapid repeated calls to any route. Not urgent today (no
real traffic, no cost-bearing operations wired up) but relevant once OTP
send or payment creation exist (dossier §14 flags OTP throughput as a
launch-day failure mode).

## Not applicable / no findings

- No RLS to audit (no database).
- No exposed service-role key (no Supabase client exists to hold one).
- No CORS misconfiguration found (no cross-origin API consumers exist yet).

## Net assessment

There is no security regression to "fix" in this phase — there is no
security model to audit because there is no real backend yet. The correct
framing is: **build authorization, validation, and payment-trust rules
correctly the first time**, per dossier §13, rather than treating this as a
hardening pass on existing logic. See `BACKEND_READINESS.md` for sequencing.
