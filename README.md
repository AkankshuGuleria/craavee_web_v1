# Craavee

Hyperlocal quick-commerce for university campuses. npm workspaces monorepo.

> Product and engineering context lives in `docs/engineering/` (specification,
> decision log, database spec, RBAC matrix, order state machine, API
> contracts, security model, deployment topology, test strategy, phase
> plan) and `docs/audit/` (Phase 0 repository audit of the pre-existing
> codebase). Start there for *why*; this file covers *how to run things*.

## Workspace layout

```
apps/
  store/              Next.js 16 — store-staff ops console (packing, inventory, orders)
  console/            Next.js 16 — admin back office (catalog, users, runners, promos, settings)
  customer-runner/    Expo (SDK 57) — customer + runner mobile app, Expo Router
packages/
  types/              Generated Supabase types (`database.ts`) — never hand-edited
  validation/         Zod request schemas, shared across apps and Edge Functions
  api-contracts/      Typed request/response contracts matching API_CONTRACTS.md
  ui/                 Shared web design system (Craavee "fresh-tech spatial commerce")
supabase/
  migrations/         Schema, triggers, RLS policies (0001–0003)
  tests/              pgTAP test suite
  seed.sql            Dev-only seed data
scripts/
  run-db-tests.sh     pgTAP runner (see its header — works around a pg_prove/path bug)
```

`apps/store` and `apps/console` are two Next.js apps split from a single
prototype (see `docs/audit/PHASE_0_REPOSITORY_AUDIT.md`); both consume the
shared design system in `packages/ui`. `apps/customer-runner` is a separate
native app — it does **not** consume `packages/ui` (that package is
web/DOM-only); its own design tokens live in
`apps/customer-runner/lib/theme.ts` and `tailwind.config.js`, hand-mirrored
from `packages/ui/DESIGN.md`.

## Getting started

```bash
npm install                 # installs every workspace
npm run typecheck           # tsc --noEmit, every workspace
npm run lint                # ESLint (flat config, root eslint.config.js)
npm run test                # unit tests, every workspace (--if-present)
npm run build               # next build for apps/store + apps/console
```

### Database (local Supabase)

```bash
npm run db:start            # supabase start (Postgres 17, Auth, Realtime, Studio, ...)
npm run db:reset            # apply all migrations + supabase/seed.sql
npm run db:test             # scripts/run-db-tests.sh — full pgTAP suite (314 assertions)
npm run db:stop             # supabase stop
npm run gen                 # regenerate packages/types/src/database.ts from the local DB
```

### Edge Functions (Phase 4+)

```bash
npm run functions:check     # deno check — create_order / validate_promo / expire_stale_reservations / payment_webhook / refund
npm run functions:test      # deno test — gateway adapter + getGateway() production-safety branching
npm run functions:serve     # scripts/serve-functions.sh — serves them locally on :8790
```

Phase 5 adds `payment_webhook` (Razorpay signature verification + the
`webhook_events` dedup + the D30/D36 late-capture reconciliation) and
`refund` (wallet destination, idempotency-keyed, D38). The gateway
adapter is selected by `PAYMENT_GATEWAY` — see `.env.example`; the mock
adapter is impossible to activate in `staging`/`production`.

`supabase functions serve` (the CLI's edge-runtime container) fails to boot
on the maintainer's machine ("failed to determine entrypoint" — a CLI/image
issue, not a function-code issue). `npm run functions:serve` runs the SAME
handler code via `deno run`, routing `/functions/v1/<name>` exactly as the
deployed edge runtime does — see `PHASE_4_IMPLEMENTATION_REPORT.md` §20.
Requires Deno.

Requires the Supabase CLI and Docker (or a Docker-compatible runtime, e.g.
colima) running locally. `npm run db:test` drives `psql` directly rather
than `supabase test db` — see `scripts/run-db-tests.sh`'s header comment for
why (a `pg_prove`/Docker bind-mount bug tied to a space in this repo's path).

### Store / Console (Next.js apps)

```bash
npm run dev -w @craavee/store       # http://localhost:3000
npm run dev -w @craavee/console     # http://localhost:3000 (run one at a time, or pass -p)
npm run build -w @craavee/store
npm run build -w @craavee/console
```

### Customer-runner (Expo app)

```bash
cd apps/customer-runner
cp .env.example .env.local   # fill in with `supabase status`'s API_URL / ANON_KEY (after db:start)
npm run start                # expo start — scan the QR code with Expo Go, or press i/a for a simulator
npm run typecheck
npm run doctor                # npx expo-doctor — project health checks
npm run test                  # unit tests (pure logic, no network)
npm run test:integration       # real auth + catalog tests against the local Supabase instance — see below
```

### Testing phone OTP sign-in locally

1. `npm run db:start` then `npm run db:reset` (repo root) — seeds three
   ready-to-use test accounts at `9990000001`/`02`/`03`, matching
   `supabase/config.toml`'s `[auth.sms.test_otp]` block (fixed code
   `123456`, real SMS never sent). **Never** enable/commit real SMS
   provider credentials for local or CI use — production-only, set via
   `supabase secrets set`.
2. In the app's phone screen, enter `9990000001` (the UI already assumes
   `+91`) and submit.
3. On the OTP screen, enter `123456`.
4. You land on the catalog, signed in as a fresh customer (the DB trigger
   creates the `profiles` row on first use — no name/address is asked
   for at signup, per the dossier).

`apps/customer-runner/__tests__/auth-catalog.integration.test.ts` drives
this exact flow programmatically against the real local stack — see
`docs/engineering/PHASE_3_IMPLEMENTATION_REPORT.md` for what it proves.

## CI

- **`.github/workflows/ci.yml`** — install, typecheck, lint, unit tests, Store + Console builds. Runs on every push/PR to `main`.
- **`.github/workflows/database.yml`** — starts local Supabase, applies migrations + seed, runs the pgTAP suite via `scripts/run-db-tests.sh`, type-checks the Edge Functions with Deno, runs the Deno gateway/production-safety tests, then the customer-runner integration suites (Phase 3 auth/catalog + Phase 4 order creation + Phase 5 payment webhook/refund) against that same instance. Path-filtered to `supabase/**`, `scripts/**`, `apps/customer-runner/__tests__/**`, and `packages/**`.

## Environment configuration

See `.env.example` at the repo root for the full list of variables each app
expects (Supabase URL/anon key, etc.) and `docs/engineering/DEPLOYMENT_TOPOLOGY.md`
for how these differ across local/staging/production.

## Current phase

**Phase 5 (real payments + webhook + refunds) — complete, awaiting review.**
On top of Phase 4: the real **Razorpay** gateway adapter behind the
unchanged D12 interface (`create_order`'s Phase A/B/C control flow does
not change); `payment_webhook` (raw-body HMAC signature verification →
`webhook_events` transport dedup → server-side payment lookup →
amount/currency verification → confirm / fail / D36 late-capture
reconciliation); `refund` (admin, wallet destination, idempotency-keyed;
a full refund of a live order also cancels it). Mock gateway is
production-impossible. Customer order screen shows payment
pending/successful/failed/refunded with bounded polling. **External
blocker:** live-sandbox verification + production KYC need real Razorpay
test/live keys — see `PHASE_5_IMPLEMENTATION_REPORT.md` §2. No store
packing, runner claim, delivery, realtime, or notifications yet. See
`docs/engineering/PHASE_PLAN.md` and the `PHASE_*_IMPLEMENTATION_REPORT.md`
files.
