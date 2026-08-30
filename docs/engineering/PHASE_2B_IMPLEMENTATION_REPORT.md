# Phase 2B — Repository / Workspace / Tooling Completion Report

Closes the outstanding items from `PHASE_2_IMPLEMENTATION_REPORT.md` §14/§15:
npm workspaces, the Store/Console split, the Expo scaffold, the three new
shared packages, TypeScript/ESLint configuration across the monorepo, CI,
and a full-stack build/test/lint verification. Database work (schema, RLS,
pgTAP) is untouched from Phase 2/2A — re-verified green in §9, not redone.

**Formal gate: WORKSPACES TYPECHECK + LINT PASSES + STORE BUILDS + CONSOLE
BUILDS + EXPO SCAFFOLD VALIDATES (with one documented exception, §8) + CI
FOUNDATION EXISTS + DATABASE GATE STILL MET — MET.** Full checklist in §11.

---

## 1. Monorepo / workspace structure

Root `package.json` declares an npm workspaces array (not pnpm/yarn/
Turborepo/Nx, per D2):

```
apps/customer-runner   apps/store   apps/console
packages/types   packages/validation   packages/api-contracts   packages/ui
```

Root scripts (`typecheck`, `lint`, `test`, `build`, `db:start`, `db:stop`,
`db:reset`, `db:test`, `gen`) drive every workspace via `--workspaces
--if-present` or explicit `-w` flags. Documented in the rewritten
`README.md` (§7 below — the previous README described the retired
in-venue prototype and a `src/` tree that no longer exists on disk;
verified gone, not just git-deleted).

## 2. Store / Console split

The single prototype Next.js app audited in Phase 0 was split into two
apps, preserving its design system rather than redesigning it:

- **`apps/store`** — store-staff ops surface. Migrated `(admin)/packing`
  (Phase 0 flagged this as mis-grouped under admin; it is store-staff
  functionality) with full content; `orders`/`inventory` are placeholder
  routes.
- **`apps/console`** — admin back office. Migrated `(admin)/catalog` and
  `(admin)/live-ops` with full content; `users`/`runners`/`promos`/
  `settings`/`inventory`/`orders` are placeholder routes.
- **`packages/ui`** — the shared design system (Craavee "fresh-tech spatial
  commerce": `OpsShell`, `Button`/`Card`/`Input`/`StatusChip`, the
  aurora/glass/liquid-text components, `interactive.tsx` motion
  primitives, magicui components) both apps consume via `transpilePackages`.

Both apps build successfully (Next.js 16.3.3, Turbopack):

```
apps/store    → /, /_not-found, /inventory, /orders, /packing
apps/console  → /, /_not-found, /catalog, /inventory, /orders,
                /promos, /runners, /settings, /users
```

All routes statically prerender (`○ (Static)`). No phone OTP UI, no live
catalog, no order creation, no payments, no runner claim flow exist in
either app — placeholder routes are empty shells, matching the explicit
hard stop.

Retired the original monolith's fake customer-auth/cart state, in-memory
order/product services, and its own `/api/orders`, `/api/products`,
`/api/runner/queue` route handlers — none were migrated (verified: `apps/
store/src/app/api` and `apps/console/src/app/api` do not exist). See §6
for the full legacy-retirement sweep.

## 3. `apps/customer-runner` (Expo)

Scaffolded via `create-expo-app@latest --template blank-typescript` (D4:
resolve the SDK version at scaffold time, never pin in advance). Resolved
to **Expo SDK 57**, Expo Router 57.0.17, React Native 0.86.3, React 19.2.3
— all pinned by the scaffold itself, not hand-picked.

Dependencies added (all from Phase 2B's approved foundation list, nothing
else): `expo-router`, `expo-notifications`, `expo-image`, `expo-haptics`,
`react-native-reanimated`, `react-native-gesture-handler`,
`react-native-screens`, `react-native-safe-area-context`,
`@gorhom/bottom-sheet`, `@shopify/flash-list`, `@supabase/supabase-js`,
`@tanstack/react-query`, `zustand`, `moti`, `nativewind` + `tailwindcss@^3`.

**Structure built this phase** (all placeholder — no business logic):

```
app/_layout.tsx            Root layout: imports ../global.css, ErrorBoundary
                            → QueryClientProvider → AuthBoundary → <Stack>
app/index.tsx               Entry screen — links to both route groups
app/(customer)/_layout.tsx  Stack container, no screens yet
app/(customer)/index.tsx    Placeholder
app/(runner)/_layout.tsx    Stack container, no screens yet
app/(runner)/index.tsx      Placeholder
app/+not-found.tsx          Standard 404 screen
components/AuthBoundary.tsx  Structural placeholder — passes children through
                            unconditionally; documents what real
                            Supabase-session + JWT-role gating will replace
                            it with in a later phase. No client-trusted
                            role check exists anywhere.
components/LoadingScreen.tsx, components/ErrorBoundary.tsx
lib/theme.ts                Color/spacing/radii tokens, hand-mirrored from
                            packages/ui/DESIGN.md (documented why not
                            imported: packages/ui is DOM/web-only)
nativewind-env.d.ts          nativewind/types reference + a `declare module
                            "*.css"` addition (nativewind's own types don't
                            declare one; verified by reading
                            react-native-css-interop's types.d.ts directly)
```

Before writing any router code, fetched the current versioned Expo Router
docs (root/runner navigation-layouts pages) per `AGENTS.md`'s standing
instruction to check exact current API rather than rely on training data —
confirmed `Stack` from `expo-router`, root `_layout.tsx` placement, and
parenthesized route-group semantics are unchanged from what was assumed.

`npm run typecheck -w @craavee/customer-runner` passes clean. Mobile
bundling validation: see §8 — one real limitation found and documented,
not silently skipped.

## 4. New packages

- **`packages/validation`** — Zod schemas (`primitives.ts`: uuid/quantity/
  money/delivery-code primitives; `requests.ts`: 13 request schemas, one
  per `API_CONTRACTS.md` §3 function). Now has a real runtime test suite
  (§5).
- **`packages/api-contracts`** — `errors.ts` (the `ERROR_CODES` catalogue,
  `ApiError`, `ApiResult<T>`, verbatim from `API_CONTRACTS.md` §5),
  `functions.ts` (response interfaces + the full `EdgeFunctionContracts`
  map, composing request types from `@craavee/validation` and enum types
  from `@craavee/types` via `import type` — not re-declaring them, per the
  explicit "compose, don't duplicate" instruction). Implements zero
  functions — typing only, per the Phase 2B §2 hard stop.
- **`packages/types`** — unchanged from Phase 2 (`database.ts`, generated
  from the live local schema); re-verified it still typechecks clean
  against the current schema.

Both new packages' relative imports use explicit `.ts` extensions
(`allowImportingTsExtensions` enabled in their `tsconfig.json`s). This is
not cosmetic: it's what makes them loadable by Node's native ESM resolver
(used by their own test suites, §5) without a bundler, and it's also what
Deno — the Phase 4+ Edge Functions runtime `functions.ts` is written
for — requires for relative specifiers. Bundler-mode resolution
(Next.js/Metro/tsc `moduleResolution: "bundler"`) accepts this form too,
so it is the one specifier style that works across every current and
planned consumer. No app currently imports either package yet (confirmed
by grep); the first one that does will need the same one-line
`allowImportingTsExtensions` addition to its own `tsconfig.json` if it
re-exports through these packages' `.ts`-suffixed specifiers — flagged
here rather than added pre-emptively to five tsconfigs nothing currently
needs it in.

## 5. Phase 2B-scoped tests (new — not duplicating the pgTAP suite)

No workspace had a test runner before this phase; `npm run test
--workspaces --if-present` silently no-op'd everywhere. Added a real
suite using **Node's built-in test runner** (`node --experimental-strip-types
--test`) — zero new test-framework dependency, appropriate for a
foundation phase with contracts to verify but no business logic yet:

| Package | File | Assertions | Proves |
|---|---|---|---|
| `@craavee/validation` | `src/__tests__/requests.test.ts` | 7 tests | Zod schemas enforce their constraints at runtime (not just typecheck) — qty cap, UUID shape, 4-digit delivery code, staff-role enum, non-empty items array |
| `@craavee/api-contracts` | `src/__tests__/errors.test.ts` | 3 tests | `ERROR_CODES` is well-formed (no duplicates, non-empty strings); `ApiResult<T>` discriminates on `ok` correctly at runtime; importing the package's own `index.ts` — the same path an external consumer would take — resolves across the workspace boundary |

```
npm run test
  @craavee/validation:    7 pass, 0 fail
  @craavee/api-contracts: 3 pass, 0 fail
```

Workspace resolution and cross-package type composition are additionally
proven by `npm run typecheck` succeeding for every workspace (tsc follows
the actual `@craavee/*` package imports through node_modules symlinks,
not stubs) — not re-tested separately, since that would just be
reimplementing what tsc already verifies authoritatively.

## 6. Legacy code retirement sweep

Searched the full source tree (excluding `node_modules`/`.next`/build
output) for: venue/table/seat/event-credit terminology, localStorage-based
fake auth, mock products, in-memory orders, old `/api` route handlers,
stub repositories, `Not implemented` markers.

**Every match is category A or B (legitimate history or design copy) —
zero category C/D (dead code or leftover migration reference) found:**

- All venue/table/seat/event-credit hits are in `docs/audit/`,
  `docs/engineering/DECISION_LOG.md`, `DATABASE_SPEC.md`,
  `ENGINEERING_SPECIFICATION.md` — documenting the retired prototype and
  the decisions that replaced it (category A).
- One "seat" hit: `packages/ui/src/components/Footer.tsx`'s marketing
  copy ("delivered to your seat") — a tagline, not a domain model
  reference (category B).
- `apps/console/src/app/layout.tsx` and `packages/ui/src/index.ts` contain
  comments explaining that the retired fake-auth/cart state was
  deliberately **not** carried over (category A — the comment documents
  an absence, it isn't itself legacy code).
- No old `/api` routes exist in either new app (confirmed: the
  directories don't exist).
- No mock-product/in-memory-order/stub-repository/`Not implemented`
  patterns found anywhere in `apps/`/`packages/`.
- The original monolith's root-level `src/`, `DESIGN.md`, `next.config.ts`,
  `postcss.config.js`, `public/fonts/` are confirmed **gone from disk**
  (not just `git rm`'d with orphaned files still present) — `ls src`
  returns "No such file or directory".

Nothing required deletion this phase; the sweep is recorded here as
evidence it was actually run, not assumed clean.

## 7. TypeScript / ESLint / environment / README

- **TypeScript**: strict mode on every workspace; zero `: any`, zero
  `as any`, zero `eslint-disable`, zero hand-written `@ts-ignore`/
  `@ts-expect-error` anywhere in `apps/`/`packages/` (verified by grep;
  the only `@ts-ignore` hits in the whole tree are inside Next.js's own
  auto-generated `.next/types/validator.ts`, not our code).
- **ESLint**: unchanged from Phase 2A's working flat config
  (`@babel/eslint-parser`-based, documented typescript-eslint/TS7
  incompatibility) — re-verified passing (0 errors, 4 documented
  warnings scoped to preserved design-system code) after all the
  dependency changes below.
- **`.env.example`**: already existed and is coherent (four-category
  PUBLIC/SERVER_ONLY/EDGE_FUNCTION_ONLY/CI_ONLY split matching
  `SECURITY_MODEL.md` §3); no changes needed.
- **`supabase/config.toml`**: re-read in full — coherent with
  Phase 2/2A state (phone OTP as sole sign-in, `custom_access_token_hook`
  registered, Edge Functions correctly disabled with a comment explaining
  why, fixed test OTPs for local/CI only). No changes needed.
- **`README.md`**: fully rewritten (previous version described the
  retired in-venue prototype's `src/` tree, which no longer exists) —
  now documents the actual workspace layout, every root dev script, the
  local-Supabase workflow, per-app dev commands, and what CI runs.
- **`.gitignore`**: added Expo/React-Native entries (`.expo`, signing-key
  extensions) and an exFAT AppleDouble (`._*`) pattern at the root level
  — `apps/customer-runner` already had its own scaffolded `.gitignore`
  covering the same ground, but the root previously had neither.

## 8. Dependency-resolution bugs found and fixed (real bugs, not style)

Phase 2B's tooling changes surfaced three genuine, reproducible dependency
bugs — each diagnosed to a root cause and fixed there, not routed around:

1. **`nativewind`/`react-native-css-interop` resolved the wrong major
   version of `tailwindcss`.** `apps/customer-runner` needs `tailwindcss@3`
   (NativeWind v4's hard requirement) while `apps/store`/`apps/console`
   need `tailwindcss@4`. npm hoists `nativewind` to the workspace root
   (nothing else in the tree depends on it, so nothing forces it to
   nest), and Node's module resolution for `nativewind`'s *own*
   `require("tailwindcss")` then walked up from its root-level location
   and found the root's v4 — confirmed directly by requiring
   `metro.config.js` in isolation and reading the thrown error and stack.
   `npm ls tailwindcss` independently confirmed this as an `invalid`
   peer resolution. **Fixed** with a scoped `overrides` entry in the root
   `package.json` (`nativewind`/`react-native-css-interop` →
   `tailwindcss@^3.4.19` specifically), which forces npm to nest a
   correct local copy for exactly those two dependents — verified via
   `npm ls tailwindcss` showing no more `invalid` markers, and via
   `metro.config.js` loading cleanly afterward.
2. **`tailwindcss@3.4.19`'s own dependency on `sucrase` was silently
   absent from the installed tree** despite being declared in its
   `package.json` and correctly listed in `package-lock.json` — an npm
   resolution gap most plausibly triggered by the interaction with the
   `overrides` entry above (a package placed via a forced override
   didn't get its own transitive dependencies walked). Confirmed via
   direct `require()` of `metro.config.js` throwing
   `Cannot find module 'sucrase'` from inside tailwindcss's own
   `load-config.js`, and via `npm ls sucrase` showing it installed
   nowhere in the tree. **Fixed** by installing it explicitly into
   `apps/customer-runner`'s own `dependencies` — re-verified
   `metro.config.js` then loads without error.
3. **`@babel/eslint-parser`/`@babel/preset-react`/`@babel/preset-typescript`
   had been installed unpinned (`^8.0.1`)**, which resolved to a Babel 8
   pre-release the instant `legacy-peer-deps` was removed (see below) —
   `@babel/eslint-parser@8` requires `@babel/core@^8`, but the entire
   Expo/RN toolchain (`babel-preset-expo` and everything under it) needs
   `@babel/core@^7`. **Fixed** by pinning all three to the `^7.29.7` line
   (the newest real Babel 7 release), which is what the ESLint config's
   own toolchain was actually designed against.

**Also removed `.npmrc`'s `legacy-peer-deps=true` and the unused
`typescript-eslint` devDependency** that had made it necessary. That flag
was added in Phase 2B to route around `typescript-eslint`'s
`typescript <6.1.0` peer cap — but `typescript-eslint` was never actually
wired into the active ESLint config (only referenced in commented-out
future-re-enablement code, confirmed by grep), and blanket
`legacy-peer-deps` was the direct cause of bug #1 above: it suppresses
*all* peer-conflict-driven nesting decisions monorepo-wide, not just the
one conflict it was meant to route around, and had been silently
mis-resolving `tailwindcss` this whole time. `npm install` now runs
**without** `legacy-peer-deps`, with only expected/harmless
`ERESOLVE overriding peer dependency` warnings (from `eslint-config-next`'s
own nested, TS7-agnostic copy of `typescript-eslint`, which is not our
dependency and not our concern), and exits 0.

**One React duplicate remains, and is not being "fixed":**
`expo-doctor` reports two `react` installations — `19.2.3` (nested under
`apps/customer-runner`, exactly matching what Expo SDK 57 pins for
`react-native@0.86.3`) and `19.2.8` (root, used by `apps/store`/
`apps/console`'s Next.js 16). This is inherent to a monorepo mixing an
Expo/RN app with Next.js apps under different peer-locked React
versions — unifying them would either break Expo (which peer-locks its
React version exactly to its React Native version) or downgrade the
Next.js apps' React off current stable. `expo-doctor` now reports
**20/21 checks passed**, with this one documented, understood, and
intentionally not "fixed."

## 9. CI

**`.github/workflows/ci.yml`** — `npm ci`, `npm run typecheck`,
`npm run lint`, `npm run test`, `npm run build` (Store + Console). Runs
on every push/PR to `main`.

**`.github/workflows/database.yml`** — `supabase/setup-cli`, `supabase
start`, `supabase db reset` (migrations + seed), `supabase migration
list`, then the pgTAP suite via `bash scripts/run-db-tests.sh`. Path-
filtered to `supabase/**` and the script itself so app-only changes don't
pay for a Postgres spin-up. Invoked through `bash` explicitly rather than
as a direct executable: `git add` on this exFAT-hosted checkout was
verified (via a stage/inspect/unstage cycle, nothing committed) to record
the file at mode `100644`, not `100755` — the executable bit does not
survive `git add` reliably from this filesystem, so a CI runner checking
it out would otherwise hit `Permission denied`.

Both workflow files are new; the directory existed (from an earlier
session) but was empty.

## 10. Full verification — commands run, this phase (representative)

```
npm install                              → clean, no legacy-peer-deps, exit 0
npm ls tailwindcss                        → exit 0, no `invalid` markers
npm run typecheck                         → 7/7 workspaces, 0 errors
npm run lint                              → 0 errors, 4 documented warnings
npm run test                              → 10/10 new assertions pass
npm run build                             → apps/store + apps/console, both succeed
npx expo-doctor (apps/customer-runner)    → 20/21 (§8's documented exception)
npx supabase status                       → DB/API/Studio running
scripts/run-db-tests.sh                   → 218/218 pgTAP assertions, ALL GREEN (unchanged from Phase 2A)
```

## 11. Phase 2B gate — exact status

- [x] npm workspaces configured, all 7 workspaces resolve
- [x] `apps/store` builds (Turbopack, 5 routes, all static)
- [x] `apps/console` builds (Turbopack, 9 routes, all static)
- [x] design system preserved, not redesigned (packages/ui ported as-is; 4 pre-existing lint findings downgraded to warnings, not silently fixed — §7)
- [x] `apps/customer-runner` scaffolded (Expo SDK 57, Expo Router, NativeWind v4) with root layout, both route groups, auth-boundary placeholder, loading/error boundaries, shared theme tokens
- [x] `apps/customer-runner` typechecks clean
- [x] `apps/customer-runner` — `expo-doctor` 20/21 (1 documented, understood, not-fixable-without-regression exception)
- [ ] `apps/customer-runner` — full Metro bundle/export verified — **NOT MET, see §12 limitation**
- [x] `packages/validation` — 13 request schemas, real runtime test suite (7/7)
- [x] `packages/api-contracts` — full contract map, real runtime test suite (3/3)
- [x] `packages/types` re-verified against current schema
- [x] TypeScript strict everywhere, zero `any`/`eslint-disable`/`@ts-ignore` in hand-written code
- [x] ESLint flat config passes (0 errors)
- [x] environment configuration (`.env.example`) verified coherent
- [x] `supabase/config.toml` re-verified coherent
- [x] CI workflows exist (`ci.yml`, `database.yml`)
- [x] root dev scripts documented (`README.md` rewritten)
- [x] legacy-retirement sweep run, zero dead code found
- [x] Phase 2B-scoped tests written and passing, not duplicating the pgTAP suite
- [x] database gate still met (218/218, unchanged)
- [x] no secrets committed
- [x] no phone OTP UI, no live catalog, no order creation, no payments, no runner claim, no Realtime implementation anywhere in this phase's code

**Formal gate (workspaces typecheck + lint passes + Store builds + Console
builds + Expo scaffold validates + CI foundation exists + database gate
still met): MET, with §12's one limitation carried forward explicitly
rather than hidden.**

## 12. Known limitation — Metro bundling could not be verified in this session

`npx expo export --platform android` (and `--platform ios`) reproducibly
hangs indefinitely immediately after printing `Starting Metro Bundler`,
across five separate attempts (both platforms; with and without
`CI=1`/`EXPO_NO_TELEMETRY=1`; up to a 5-minute bound; with
`DEBUG=metro:*` set). Diagnosis performed, not skipped:

- `metro.config.js` loads correctly and fast when required directly in
  isolation (rules out a config-time error — this is the same check
  that caught and fixed the tailwindcss-version bug in §8).
- A raw filesystem crawl of the full `node_modules` tree (140,574 files)
  completes in 2.3 seconds — rules out slow exFAT directory traversal as
  the cause.
- Process CPU time stayed flat (~1.2s) across a 5-minute wait — the
  process is genuinely idle/blocked, not slowly computing.
- `DEBUG=metro:*` produced zero additional output, meaning the hang
  occurs in Expo CLI's own startup path before Metro's internals begin
  logging at all.
- Metro 0.84.5's declared `engines` field explicitly includes
  `>= 25.0.0` (this environment's Node version), so this isn't a bare
  version mismatch on paper.

Most likely explanation, not confirmed: this bash tool's command
execution has no attached TTY, and some part of Expo CLI's startup path
may be waiting on a TTY/stdin-dependent check that a real interactive
terminal would satisfy immediately. This is a plausible, not certain,
root cause — flagged as such rather than asserted.

**What *is* verified for `apps/customer-runner`:** `tsc --noEmit` passes
clean, and `expo-doctor` — which independently loads and validates the
Metro config, the full dependency tree, and app.json — passes 20/21
checks (§8). The router file structure, NativeWind wiring, and package
versions are correct by every check available; only the live
bundle/export step itself could not be exercised in this session.

**Recommended next step**: run `npx expo start` (or `expo export`)
interactively on a real terminal outside this sandboxed batch-command
environment before treating the mobile app as bundle-verified. If it
hangs there too, that rules out the TTY hypothesis and points back at a
genuine Metro/Node 25 or Metro/exFAT interaction worth its own focused
investigation.

## 13. Explicit stop condition

No phone OTP UI, no live catalog, no `create_order`, no payments, no
runner claim flow, no Realtime implementation was written this phase.
Phase 3 does not begin until a human has reviewed this report and §12's
limitation.
