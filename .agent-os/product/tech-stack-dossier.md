# Tech Stack — Locked [DOSSIER]

Reproduced from Craavee Product & Engineering Dossier v2.0 §12. This is the
target stack, not the current stack — see
`../standards/existing-codebase-facts.md` for what's actually in the repo,
and `docs/audit/IMPLEMENTATION_GAP_MATRIX.md` for the delta.

| Layer | Choice | Rationale |
|---|---|---|
| App (customer, runner) | Expo · React Native · Expo Router | One codebase for Android/iOS/web; real store listings need a native binary |
| SDK version | Current stable at project init | Resolve via `create-expo-app`, never pin in advance |
| Language | TypeScript, strict | Shared types across app, web, Edge Functions |
| Styling (app) | NativeWind v4 | One Tailwind token set across native and web |
| Animation | Reanimated 3 · Moti | UI-thread animation |
| Server state | TanStack Query v5 | Optimistic mutations, polling, cache invalidation |
| Client state | Zustand | Cart only |
| Store & console (web) | Next.js 15 · shadcn/ui · TanStack Table | Operational screens belong on the web |
| Database | PostgreSQL via Supabase | System of record; transactions/constraints carry correctness |
| Auth | Supabase Auth · phone OTP | Standard Indian consumer pattern, no password |
| Authorisation | Row-Level Security | Enforced in the database, never in the client |
| Business logic (contended writes) | Supabase Edge Functions (Deno) | `create_order()`, `payment_webhook()`, `claim_job()`, `refund()` — the only contended writes |
| Payments | Razorpay or Cashfree | UPI-first, webhook-driven confirmation |
| Realtime | Supabase Realtime | Store/runner/console only — customers poll their own order |
| Pooling | Supavisor, transaction mode | Single most important production setting |
| Notifications | expo-notifications | Status updates, no persistent sockets per customer |
| Observability | Sentry · Supabase logs | One dashboard across app, web, functions |
| Analytics | PostHog | Funnels, cohort retention |
| Load testing | k6 | Full journey against production before launch day |
| Cache | **Redis — deferred.** Added only when a load test proves a bottleneck. Not before. |
| Deployment | Vercel · EAS · Supabase | Three managed targets, no servers to patch |

## Why no separate API service [DOSSIER]

Four mutating endpoints don't justify a deployment target, container
registry, and a second set of secrets on a 26-day clock. Edge Functions +
RLS cover the surface. Revisit only when the product outgrows it
(multi-store, dynamic pricing, routing optimisation) — NestJS on Railway
drops in behind identical client contracts without touching a screen.
