# Existing Codebase Facts [FACT]

Every line below is directly observed in the repository at commit
`d079294c7f2c3a23587a925c97f99f9fc0c5b0dc` (2026-08-26). Nothing here is a
recommendation. See `docs/audit/PHASE_0_REPOSITORY_AUDIT.md` for narrative
and `docs/audit/REPOSITORY_MAP.md` for the full file tree.

## Actual stack

- Next.js 16.3.2, App Router, Turbopack, `type: "module"` package.
- React 19.2.8, TypeScript 7.0.2 strict mode (`tsconfig.json`).
- Tailwind CSS v4 via `@tailwindcss/postcss`, custom design tokens (no
  shadcn/ui, no NativeWind).
- Animation: `motion` (Framer Motion) + `gsap`. Icons: Phosphor + Lucide.
- No Expo, no React Native, no mobile app of any kind — customer and
  runner surfaces are Next.js web routes, not the dossier's Expo apps.
- No Supabase dependency (`@supabase/supabase-js` absent from
  `package.json`).
- No auth library of any kind (no Supabase Auth, no NextAuth, no JWT
  library, no `middleware.ts`).
- No payment library (`razorpay`, `cashfree-pg`, or equivalent — absent).
- No Sentry, PostHog, or k6.
- No Redis (consistent with dossier's deferral, though for a different
  reason — nothing in this repo needs caching yet).
- One static SQL file (`src/db/migrations/001_initial_schema.sql`),
  SQLite-flavored DDL (`TEXT PRIMARY KEY`, `datetime('now')`). Never
  executed against any database — no DB client, connection string, or ORM
  exists anywhere in the repo.
- Three Next.js Route Handlers (`src/app/api/{orders,products,runner/queue}
  /route.ts`), each backed by a `let`-declared in-memory array reset on
  every server restart. Two of the three seed different, inconsistent copies
  of "orders" mock data.
- `src/db/repositories/*.ts` and `src/server/services/*.ts` exist as named
  classes with every method stubbed to return `[]`, `null`, or
  `{ success: false, error: "Not implemented" }`. No method contains logic.
- Auth is `localStorage`-only: `Providers.signIn(email)` accepts any string
  containing `@` and signs the user in client-side with no server
  round-trip. No OTP, no password, no session cookie, no role assignment.
- Cart and delivery address are also `localStorage`-only
  (`craavee_cart`, `craavee_address` keys), never sent to a server.
- Operational route groups `(admin)` and `(runner)` do not add a URL
  prefix (Next.js route-group convention) — they resolve to bare
  `/catalog`, `/live-ops`, `/packing`, `/queue`, `/active`, indistinguishable
  in the URL from customer routes, with no auth check anywhere in the
  request path.
- No `middleware.ts`, no server-side or client-side role gate found on any
  route.
- No `.env` or `.env.example` file in the repo; no code reads
  `process.env` for any integration.
- No tests (`*.test.*` / `*.spec.*`: zero matches).
- No CI/CD config (no `.github/workflows`, no other CI YAML).
- No deployment config (no `vercel.json`, no Dockerfile).
- `next lint` is non-functional in this Next.js version/config combination
  (errors out immediately); no ESLint config file exists to fix it with.
- `npm run build` and `npx tsc --noEmit` both succeed cleanly on a fresh
  install — the code that exists compiles and type-checks correctly.
- `.gitignore` contains a `.kilo/` entry — evidence a different AI coding
  tool (Kilo Code) was used on this repo previously; that workspace was
  never committed.
- Domain model in code (`venues`, `tables`, `seat`, `credits`,
  `credit_ledger`, order `location` = table label like "Table B-2") matches
  an in-venue/event-ordering product, not campus hyperlocal delivery. This
  matches the dossier's description of the superseded v1.1 scope, not v2.0.

## Git state at audit time

- Origin: `https://github.com/AkankshuGuleria/craavee_web_v1.git`
- Branch: `main`, tracking `origin/main`, clean working tree, no local
  uncommitted changes at clone time.
- 2 commits total: `ef26121f` (2026-08-25, initial build) and
  `d079294c` (2026-08-26, dark theme restyle).
- No tags, no other branches.
