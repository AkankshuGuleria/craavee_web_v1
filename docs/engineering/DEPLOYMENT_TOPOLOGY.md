# Deployment Topology & Repository Structure

## 1. Repository structure (monorepo — D2, D3)

```
craavee_web_v1/                      # repo root (existing Next.js app moves under apps/store or apps/console — see §4)
├── apps/
│   ├── customer-runner/             # Expo app, role-gated at the router (D3)
│   │   ├── app/                     # Expo Router file-based routes
│   │   │   ├── (customer)/          # customer route group
│   │   │   └── (runner)/            # runner route group — gated on role claim, not a URL guess
│   │   └── ...
│   ├── store/                       # Next.js — packer surface
│   └── console/                     # Next.js — admin surface
├── packages/
│   ├── types/                       # generated Supabase types + hand-written domain types
│   ├── validation/                  # Zod schemas, imported by clients AND Edge Functions
│   ├── api-contracts/               # request/response TS types for every Edge Function (API_CONTRACTS.md is the source of truth; these are derived)
│   └── ui/                          # shared design-system primitives IF Store/Console end up sharing components beyond what copy-paste from the existing repo already gives them (not assumed necessary yet — see ENGINEERING_SPECIFICATION.md §I)
├── supabase/
│   ├── migrations/                  # numbered SQL migrations, DATABASE_SPEC.md is source, these are the applied artifacts
│   ├── functions/                   # Edge Functions — create_order/, claim_job/, payment_webhook/, refund/, mark_packed/, mark_stock_out/, mark_picked_up/, verify_delivery_code/, mark_delivery_failed/, release_job/, admin_cancel_order/, admin_reassign/, validate_promo/, assign_staff_role/, settle_runner_earnings/
│   ├── tests/                       # pgTAP RLS + trigger tests (TEST_STRATEGY.md)
│   └── seed.sql                     # dev-only seed data (never run against staging/prod)
├── load-tests/
│   └── k6/                          # scenario scripts (TEST_STRATEGY.md §Load testing)
├── .github/workflows/                # CI (§3 below)
├── .agent-os/                       # Agent OS artifacts (unchanged location from Phase 0)
└── docs/
    ├── audit/                       # Phase 0 artifacts, untouched
    └── engineering/                 # this document set
```

## 2. What happens to the existing repository content

Per `docs/audit/BACKEND_READINESS.md`'s reuse assessment, restated here as
a concrete move plan for Phase 2:

- The existing `src/app/`, `src/components/`, `src/styles/`, `DESIGN.md`
  content **moves into `apps/console/`** (its route groups already match
  Console's feature set most closely — live-ops, catalog, packing are all
  admin/operational screens) or is split between `apps/store/` (packing-
  specific pages) and `apps/console/` (admin-specific pages) once the
  monorepo scaffold exists — an exact file-by-file split is a Phase 2
  implementation task, not a Phase 1 decision (the design system and
  component library move as a unit either way).
- `src/lib/products.ts`, `src/db/*`, `src/server/*`, `src/app/api/*`,
  `src/components/providers.tsx`'s auth/cart/address contexts, and
  `src/types/index.ts` are **retired**, not moved (`BACKEND_READINESS.md`
  "What NOT to reuse").
- The customer-facing pages currently in `src/app/shop/*` and `src/app/
  (auth)/*` are **not moved into the Expo app as code** — Expo/React
  Native and Next.js/React DOM are different rendering targets, so this
  is a from-scratch rebuild of the *screens*, informed by (not copy-
  pasted from) the existing UI's visual language via the shared design
  tokens in `DESIGN.md`.

## 3. CI/CD

GitHub Actions (matches the existing repo's GitHub hosting). Pipeline,
per Phase 1 prompt §7.28:

| Check | Runs on | Blocks merge |
|---|---|---|
| Typecheck (`tsc --noEmit`, all workspaces) | every PR | yes |
| Lint | every PR | yes — note: the existing repo's `next lint` is currently broken with no ESLint config (`docs/audit/PHASE_0_REPOSITORY_AUDIT.md` §10); Phase 2 must add a working flat-config ESLint setup as part of the monorepo scaffold, not carry the broken state forward |
| Unit tests | every PR | yes |
| Build (`apps/store`, `apps/console`) | every PR | yes |
| Migration check (`supabase db diff` against the migrations directory produces no unexpected drift; migrations apply cleanly to a fresh shadow database) | every PR touching `supabase/migrations` | yes |
| pgTAP RLS/trigger tests | every PR touching `supabase/migrations` or `supabase/functions` | yes |
| E2E (Playwright against `apps/store`/`apps/console`; Expo/Detox for `apps/customer-runner` once Phase 10 exists) | every PR touching the relevant app, plus nightly full run | yes for the touched-app subset; nightly is informational until it's proven stable |
| k6 smoke (small VU count, not the full 1,600-VU scenario) | nightly against staging, not on every PR (too slow) | no — informational, full run is a manual pre-launch gate (`TEST_STRATEGY.md`) |

No Docker, no Kubernetes, no custom backend infra — consistent with D19.

## 4. Deployment targets

| Surface | Target | Notes |
|---|---|---|
| `apps/store`, `apps/console` | Vercel | Two separate Vercel projects (independent deploy cadence, independent env vars per D-decision in `SECURITY_MODEL.md` §3), both pointing at the same Supabase project per environment tier |
| `apps/customer-runner` | EAS (Expo Application Services) | EAS Build for native binaries (TestFlight/Play internal track per `docs/audit/PHASE_0_REPOSITORY_AUDIT.md`'s distribution findings — unchanged by this spec, that's a dossier §16 concern, not re-litigated here), EAS Update for OTA JS-only updates between binary releases |
| `apps/customer-runner` (PWA/web) | Vercel (third project) | Per dossier §16, "the web build is a first-class product surface" — Expo's web output deploys like any other static/SSR Next-adjacent build |
| Database, Auth, Realtime, Edge Functions, Storage | Supabase | One project per environment tier (dev/staging/production — `SECURITY_MODEL.md` §3); migrations applied via `supabase db push` in CI, never hand-run against production |

## 5. Environment tiers

Three fully isolated Supabase projects (dev, staging, production) —
rationale and secret handling already specified in `SECURITY_MODEL.md`
§3, not repeated here. Vercel/EAS environment variable sets mirror the
same three-tier split.
