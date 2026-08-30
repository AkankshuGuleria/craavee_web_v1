# Git Checkpoint Audit

Forensic record of the repository state at the point the accumulated
Phase 0–5 work was partitioned into reviewable pull requests. Produced
before any Git state was modified. Companion document: `PR_PLAN.md`.

Date of audit: 2026-08-30.

---

## 1. Repository state

| Property | Value |
| --- | --- |
| Working tree | `/Volumes/T7 Shield/Craavee/craavee_web_v1` |
| Git directory | `/Users/soumyadebtripathy/.craavee-git/craavee_web_v1.git` (via `.git` gitdir pointer file) |
| Remote `origin` | `https://github.com/AkankshuGuleria/craavee_web_v1.git` (public) |
| Current branch | `main` |
| `HEAD` | `d079294c7f2c3a23587a925c97f99f9fc0c5b0dc` |
| `origin/main` | `d079294c7f2c3a23587a925c97f99f9fc0c5b0dc` |
| Common ancestor | `d079294` — identical; the local branch is **0 ahead, 0 behind** |
| Local-only commits | none |
| Staged changes | none |
| Other branches | none (only `main`, `origin/main`, `origin/HEAD`) |

The `.git` entry is a **file**, not a directory, containing
`gitdir: /Users/soumyadebtripathy/.craavee-git/craavee_web_v1.git`. This
is deliberate: the working tree lives on an exFAT-formatted external SSD
whose macOS driver corrupts git pack-index files, so the object database
was relocated to the internal APFS disk (see
`docs/audit/PHASE_0_REPOSITORY_AUDIT.md` §1). This is an environment
detail, not a repository defect, but it means **the git directory is not
inside the working tree** and is not covered by any backup of the SSD.

### Existing history

```
* d079294 (HEAD -> main, origin/main) Theme non-landing pages to dark aurora/glass system; rebuild immersive homepage
* ef26121 Craavee quick-commerce web app: fresh-tech spatial redesign
```

Two commits. Both belong to the **original single-app Next.js
prototype** — the visual/design prototype that predates the v2.0
engineering effort. No part of Phase 0–5 has ever been committed.

---

## 2. Worktree status — the central finding

**The entire Phase 0–5 body of work exists only as uncommitted working
tree state.** Nothing is staged; nothing is on a branch.

| Category | Count |
| --- | --- |
| Tracked files at `HEAD` | 70 |
| Tracked files **deleted** in the worktree | 66 |
| Tracked files **modified** in the worktree | 4 |
| **Untracked** new files | 244 |
| Ignored paths (non-AppleDouble) | 16 |

`git diff --stat` on tracked files alone: **70 files changed, 14,451
insertions(+), 10,087 deletions(-)**.

The four modified files are `.gitignore`, `README.md`, `package.json`,
and `package-lock.json`. The 66 deletions are the whole root-level
Next.js prototype (`src/app/**`, `src/components/**`, `next.config.ts`,
`postcss.config.js`, `tailwind.config.ts`, `DESIGN.md`, …).

A large share of those deletions are not losses but **moves**: the
prototype's `src/components/**` becomes `packages/ui/src/components/**`,
and its app shell becomes `apps/store` / `apps/console`. Staging the
deletions and the additions in the *same commit* lets git's rename
detection present them as renames rather than as ~4,600 lines of
delete-plus-add. This is a material constraint on how the work may be
partitioned (see §6).

---

## 3. Untracked work, grouped

| Group | Files | Notes |
| --- | --- | --- |
| `apps/customer-runner/` | 64 | Expo client: auth, catalog, cart, checkout, order, payment UI + tests |
| `packages/ui/` | 27 | Shared UI, largely moved from the prototype's `src/components` |
| `supabase/functions/` | 24 | Edge Functions + `_shared` platform incl. the Razorpay gateway adapter |
| `apps/console/` | 23 | Ops console (Next.js) |
| `apps/store/` | 21 | Store app (Next.js) |
| `docs/engineering/` | 17 | Phase 1 specification + phase implementation reports |
| `supabase/tests/` | 13 | pgTAP suites `00`–`12` |
| `.agent-os/specs/` | 13 | Agent OS per-concern specs |
| `packages/validation/` | 7 | Zod-style request schemas |
| `packages/api-contracts/` | 7 | Canonical error codes + function contracts |
| `supabase/migrations/` | 5 | `0001`–`0005` |
| `docs/audit/` | 5 | Phase 0 repository audit |
| `packages/types/` | 4 | Generated `database.ts` + exports |
| `supabase/` (root files) | 3 | `config.toml`, `seed.sql`, `.gitignore` |
| `scripts/` | 3 | pgTAP runner, function dev server, perf harness |
| `.github/workflows/` | 2 | `ci.yml`, `database.yml` |
| `.agent-os/` (other) | 4 | product mission, tech-stack dossier, standards |
| root files | 2 | `eslint.config.js`, `.env.example` |

Source lines in the highest-value review surfaces:

| Area | Lines |
| --- | --- |
| `supabase/migrations/` | 2,604 |
| `supabase/tests/` (pgTAP) | 2,350 |
| `supabase/functions/` | 1,592 |
| `packages/ui/` | 2,309 (mostly moved) |
| `apps/customer-runner/app/` | 1,151 |

---

## 4. Files excluded from commits

Nothing was force-added. The following are ignored and stay ignored:

| Path | Reason |
| --- | --- |
| `._*` (380 entries) | macOS AppleDouble sidecars, created by the exFAT driver next to every touched file. Covered by the `._*` rule added to `.gitignore`. Confirmed harmless: `supabase db reset` explicitly logs `Skipping migration ._0001_init.sql…` for each. |
| `node_modules/`, `packages/validation/node_modules/`, `apps/customer-runner/node_modules/` | dependencies |
| `apps/store/.next/`, `apps/console/.next/` | Next.js build output |
| `apps/customer-runner/.expo/` | Expo local state |
| `supabase/.branches/`, `supabase/.temp/` | Supabase CLI local state |
| `*.tsbuildinfo` (5) | TypeScript incremental build caches |
| `apps/customer-runner/.env.local` | **real local env file** — correctly ignored, never staged |
| `load-tests/` | contains only an empty `k6/` directory and an AppleDouble sidecar; nothing trackable exists yet |

`load-tests/` was checked specifically because a whole directory
reported as ignored can indicate an over-broad pattern hiding real
source. It is not: `git check-ignore -v` matches no rule against any
file in it, and the directory is empty apart from an `._k6` sidecar.

### `.gitignore` review

The only `.gitignore` change in the worktree adds two justified blocks:
Expo/React Native signing artefacts (`*.jks`, `*.p8`, `*.p12`, `*.key`,
`*.mobileprovision`, `.expo`) and the `._*` AppleDouble pattern. Both are
narrow and neither can mask legitimate source. `.env` / `.env*.local`
coverage, `node_modules`, `.next`, `dist`, `build`, `*.tsbuildinfo`,
`.DS_Store`, `*.pem` and `.vercel` were already present. Per-package
`.gitignore` files exist for `supabase/` and `apps/customer-runner/` and
are appropriately scoped. **No changes required.**

---

## 5. Secret and security sweep

Performed against **both** the working tree and the complete object
history before any push.

### Working tree

Searched recursively (excluding `node_modules`, `.next`, `.expo`,
AppleDouble files) for: `rzp_test_`/`rzp_live_` keys, `sk_live_`, AWS
`AKIA…` ids, PEM private-key headers, GitHub `ghp_` tokens, Slack `xox…`
tokens, JWT-shaped strings, and non-empty assignments to any
`*SERVICE_ROLE_KEY`, `*KEY_SECRET`, `*WEBHOOK_SECRET`, `*_TOKEN`,
`*_PASSWORD`, `*JWT_SECRET` name.

**Result: no real secret found.** Seven matches, all the same two
values, all benign:

- `apps/customer-runner/__tests__/{auth-catalog,order,payment}.integration.test.ts`
- `scripts/perf-create-order.mjs`

These hardcode the **standard Supabase local-development demo keys**
(`iss: supabase-demo`, `exp 1983812996`) as `??` fallbacks behind
`process.env`, pointed at `http://127.0.0.1:54321`. They were verified
byte-identical to the `ANON_KEY` and `SERVICE_ROLE_KEY` printed by
`supabase status` on this machine. These values are published in
Supabase's own documentation and are the same for every developer who
runs `supabase start`; they grant nothing outside a local container.
**Classification: safe, no rotation required.** They are called out here
so a reviewer who greps the diff and finds a `service_role` JWT is not
alarmed.

### `.env` discipline

Four `.env.example` files exist (root, `apps/store`, `apps/console`,
`apps/customer-runner`). **Every variable in all four has an empty
value** — they document the variable catalogue and its
PUBLIC / SERVER_ONLY / EDGE_FUNCTION_ONLY / CI_ONLY classification, and
carry no values. The single exception is the root file's
`DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, which
is the well-known local `supabase start` connection string and is
labelled as such. `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and the Cashfree
slots are all present but empty.

The one real environment file on disk,
`apps/customer-runner/.env.local`, is ignored and was never staged.

### Git history

Every object in the repository was enumerated
(`git rev-list --objects --all` → 164 objects, 97 blobs) and **every
blob was decoded and scanned** with the same pattern set.

**Result: zero hits. No secret has ever been committed to this
repository.** Additionally, `git log --all --name-only` over `*.env`,
`*.env.*`, `*credentials*`, `*.pem`, `*.key` returns nothing — no
environment or credential file has ever been tracked.

**No credential rotation is required.**

### Other security notes

- The repository is **public**. Nothing found above changes that
  calculus, but it raises the cost of any future mistake; the `.env`
  discipline above should be treated as load-bearing.
- No file over 1 MB is being added. The largest tracked additions are
  `package-lock.json` (529 KB, unavoidable) and the shared
  `IndieFlower-Regular.ttf` webfont, duplicated once per Next.js app.

---

## 6. Constraints discovered that shape the partition

These were established empirically, not assumed. They are the reason the
final partition departs from a naive one-PR-per-phase split; the full
argument is in `PR_PLAN.md` §3.

1. **`main` contains none of this work.** There is no earlier commit to
   build a phase-by-phase history on top of. Every PR is created from the
   current accumulated state.

2. **The prototype removal and the monorepo creation are one change.**
   Splitting them destroys rename detection and turns a set of file moves
   into thousands of lines of unreviewable delete-plus-add.

3. **Phase boundaries do not survive inside the application code.** The
   catalog screen `apps/customer-runner/app/(customer)/index.tsx` — Phase
   3 work — imports `lib/cart/store` and renders a cart FAB, which is
   Phase 4 work. `app/(customer)/_layout.tsx` registers the `cart`,
   `checkout`, `address/new` and `order/[id]` screens. Producing a
   "Phase 3 only" PR would require **authoring new versions of these
   files that never existed and are not the reviewed code**, only to
   delete them one PR later.

4. **Several single files span every phase**: root `package.json` (its
   `db:test`, `functions:check`, `test:integration` scripts),
   `package-lock.json`, `packages/types/src/database.ts`,
   `supabase/functions/_shared/validation.ts` and
   `_shared/gateway/index.ts`. They are committed once, in final form,
   which means an early PR necessarily carries forward references to
   paths a later PR introduces. This is disclosed in each PR body.

5. **`create_order` depends on the payment gateway.**
   `supabase/functions/create_order/handler.ts` imports
   `_shared/gateway/index.ts`, which imports `razorpay.ts`. The gateway
   adapter therefore cannot be deferred to the payments PR without
   rewriting security-critical fail-closed selection logic. It ships with
   the order PR, and the §17 "implemented, not gateway-verified" caveat
   is carried by **both** the order and payments PRs.

6. **Only `pull_request: branches: [main]` triggers CI.** Both workflows
   are scoped to PRs targeting `main`, so in a stacked series only the
   base PR runs CI today. `database.yml` also triggers on `packages/**`,
   so it is introduced **with the database PR** rather than the
   foundation PR — otherwise the foundation PR would trip a workflow that
   runs `supabase start` before `supabase/config.toml` exists.

7. **`npm run test` is workspace-wide.**
   `apps/customer-runner`'s `test` script globs
   `lib/**/__tests__/*.test.ts`. If that workspace is declared in the
   root `workspaces` array but its `lib/` is absent, the root test script
   fails. The customer client therefore cannot be deferred to a later PR
   without editing the root `package.json` and regenerating
   `package-lock.json` into a state that never existed — rejected in
   favour of keeping the lockfile untouched.

---

## 7. Verification baseline (recorded before partitioning)

Captured on the full accumulated worktree, so that any change in these
numbers during partitioning is visible and explainable.

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — all 7 workspaces, no errors |
| `npm run lint` | **PASS** — 0 errors, 2 warnings |
| `npm run test` | **44/44 pass** (customer-runner 26, validation 15, api-contracts 3) |
| `npm run db:reset` | **PASS** — migrations `0001`→`0005` applied in order, seed applied |
| `npm run db:test` | **314/314 assertions**, 13 pgTAP files, ALL GREEN |
| `npm run functions:check` | **PASS** — `deno check` on all 5 functions + dev server |
| `npm run functions:test` | **8/8 pass** — gateway adapter + production-safety |
| `npm run test:integration` | **83/83 pass** |
| `npm run build` | **PASS** — store + console, after `rm -rf .next` (see below) |

pgTAP assertions per file: `00`:82, `01`:24, `02`:14, `03`:14, `04`:14,
`05`:10, `06`:16, `07`:24, `08`:4, `09`:3, `10`:14, `11`:45, `12`:50 —
**314 total**, matching the recorded Phase 5 baseline exactly.

The 2 lint warnings are pre-existing `react-hooks/set-state-in-effect`
warnings in `packages/ui/src/hooks/use-motion-preference.ts` and
`packages/ui/src/components/ui/handwriting-svg.tsx`. They are carried
forward untouched — fixing them here would be an unrelated drive-by
change.

### Known environment limitations (carried forward, not fixed here)

- **Next.js build on exFAT.** `npm run build` fails with
  `Failed to open database / Loading persistence directory failed /
  invalid digit found in string` unless `.next` is removed first.
  Turbopack's persistent build-cache database does not survive on the
  exFAT dev volume. `rm -rf apps/*/.next && npm run build` succeeds and
  was verified. CI runs on ext4 and is unaffected.
- **Metro/Expo.** The Expo dev server limitation recorded in
  `PHASE_2B_IMPLEMENTATION_REPORT.md` §"Metro" is unchanged. No Expo
  runtime validation was performed as part of this checkpoint.
- **Supabase local Edge Functions.** The CLI edge-runtime container is
  not used; integration suites spawn handlers through
  `supabase/functions/_dev/serve.ts` (rationale in
  `PHASE_4_IMPLEMENTATION_REPORT.md` §20). Unchanged.
- **Executable bit.** exFAT does not preserve the executable bit, so
  `scripts/run-db-tests.sh` commits as mode `100644`. `database.yml`
  already invokes it via `bash` for exactly this reason.
- **Razorpay.** No live sandbox transaction has been executed; no
  `rzp_test_` credentials were available. See `PR_PLAN.md` §6.

---

## 8. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| The git object database lives outside the working tree, on a different disk, and is not backed up with the SSD | High | Recorded here; the branches created by this checkpoint are pushed to `origin`, which removes the single point of failure for this work |
| The foundation PR is large (prototype removal + monorepo + apps) | Medium | Irreducible without fabricating states (§6.2, §6.7); mitigated by rename detection and by splitting it into atomic per-concern commits |
| Early PRs forward-reference paths later PRs add (§6.4) | Low | Disclosed in each PR body; the stack is merged in order |
| Repository is public | Low | Full history + worktree secret sweep clean (§5) |
| Razorpay never exercised against a live sandbox | Medium (product) | Explicitly scoped out and documented in the payments PR; not a code defect |
| A reviewer greps a `service_role` JWT in test files and assumes a leak | Low | Documented in §5 and repeated in the relevant PR bodies |
