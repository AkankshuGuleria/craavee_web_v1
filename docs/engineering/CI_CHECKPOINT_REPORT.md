# CI Checkpoint Report

Repair of the GitHub Actions configuration for the five-PR review stack.
Companion documents: `GIT_CHECKPOINT_AUDIT.md`, `PR_PLAN.md`.

Date: 2026-08-30. **No PR was merged.**

---

## 1. Problem

Both workflows declared:

```yaml
on:
  pull_request:
    branches: [main]
```

The review stack is five stacked PRs, only the first of which targets
`main`:

```
main ← #1 ← #2 ← #3 ← #4 ← #5
```

So four of the five PRs never matched the trigger. GitHub reported
**"no checks reported"** rather than a failure, which is why the gap was
invisible — a red X gets noticed, an absence does not.

The base PR was no better off: `#1` is documentation-only and its branch
predates both workflow files, so nothing ran there either. In practice
**not one of the five PRs had ever been validated by CI**, and the
workflows had never executed at all.

## 2. Root cause

`branches:` under `pull_request` filters on the PR's **base** branch.
Scoping it to `main` is the common default and is correct for a flat
branching model; it silently excludes every stacked PR.

That was the whole of the reported problem. It was not the whole of the
defect: because the workflows had never run, four further faults were
sitting behind it, each of which only became visible once CI actually
executed. They are documented in §3 and §8 because they materially
change what "CI is fixed" means.

## 3. Workflow changes

### 3.1 The trigger (the reported fix)

Both workflows now run on every pull request regardless of base:

```yaml
on:
  push:
    branches: [main]
  pull_request:            # no branches: filter
```

`push` stays scoped to `main` deliberately — feature branches are
already covered by their PR, and widening it would double every run.

`database.yml` keeps its `paths` filter. It provisions a full
Postgres/Supabase Docker stack plus the Supabase CLI and Deno, so
scoping it to changes that can affect database correctness is a genuine
requirement rather than an accident. Its existing paths (`supabase/**`,
`scripts/**`, `apps/customer-runner/__tests__/**`, `packages/**`,
`.github/workflows/database.yml`) already match every PR in this stack.

### 3.2 `supabase start` failed on the earlier branches

`config.toml` was committed once in final form, declaring all five Edge
Functions. `supabase start` validates every declared function's
entrypoint while parsing config, so on the database PR — where
`supabase/functions/` does not exist yet — it aborted:

```
failed to read file: open supabase/functions/create_order/index.ts:
no such file or directory
```

The order PR hit the same fault on `payment_webhook`.

Excluding the container (`supabase start -x edge-runtime`) does **not**
help; the entrypoint check happens before container selection. Verified
by reproducing both the failure and the non-fix locally.

Each function is now declared in the PR that adds it. The declarations
themselves are untouched, and **`config.toml` at the top of the stack is
byte-identical to before this repair** — only the intermediate branches
changed.

### 3.3 `supabase migration list` failed everywhere

With no target the CLI resolves against a linked remote project and
exits 1 with `Cannot find project ref. Have you run supabase link?`.
Nothing in CI is linked. Because this step sits before the real checks,
every check after it reported **skipped**, not passed. Now
`supabase migration list --local`.

### 3.4 Deno was installed one PR too late

The order integration suite spawns the real handlers through
`supabase/functions/_dev/serve.ts`, which runs under Deno, but
`denoland/setup-deno@v2` had been placed in the payments PR. Every test
in the suite failed with `edge function server did not come up at
http://127.0.0.1:8791/...`. Deno setup moved to the order PR, which is
the PR that introduces `supabase/functions/`. `functions:check` and
`functions:test` stay in the payments PR — `npm run functions:check`
names all five functions, so it cannot pass until the last two exist.

### 3.5 The Supabase CLI was unpinned

`setup-cli` was on `version: latest`, so CI tracked whatever CLI and
Postgres image were newest that morning. It is now pinned to `2.113.0`,
the version this work was verified against. **This is the fix with real
consequences — see §8.1.**

### What did not change

No check was removed, weakened, or added. `npm ci`, typecheck, lint,
unit tests, the Store and Console builds, migrations, pgTAP, the Edge
Function type-check, the gateway tests and the integration suites all
run exactly as before. No job logic, no test, no migration, no
application code, no authentication and no payment code was touched. No
secret, credential or repository secret was added, and neither workflow
deploys anything.

## 4. Commits

Eight commits, plus forward merges to carry them down the stack. No
rebase, no force push, no branch deletion.

| Commit | Branch | Change |
| --- | --- | --- |
| `12563d7` | `feat/repo-foundation` | ci: run checks on all pull requests |
| `6f2f009` | `feat/database-rls-foundation` | ci: run database checks on all pull requests |
| `a1c3a22` | `feat/database-rls-foundation` | ci: list local migrations in the database workflow |
| `0e5121b` | `feat/database-rls-foundation` | fix(supabase): declare Edge Functions only where they exist |
| `1c10f72` | `feat/database-rls-foundation` | ci: pin the Supabase CLI so database results are reproducible |
| `b251885` | `feat/order-inventory` | fix(supabase): declare this PR's Edge Functions in config.toml |
| `e501d14` | `feat/order-inventory` | ci: install Deno for the order integration suite |
| `442fe1b` | `feat/payments-refunds` | fix(supabase): declare this PR's Edge Functions in config.toml |

Propagation was by forward merge (`git merge <base>`), which is what
GitHub's own "Update branch" does. Rebasing would have required a force
push, which is prohibited. The merges carry no content of their own, so
each PR's diff against its base still shows only that PR's work — the
trigger fix does not leak downstream.

## 5. Branch

The fix could not go on PR #1's branch, and a dedicated CI PR against
`main` would have been worse.

Both options put the workflows on a tree that is still the original
prototype, whose `package.json` has only `dev`, `build`, `start` and
`lint` — no `typecheck`, no `test`. `ci.yml` there fails at its third
step by construction, and `database.yml` has no `supabase/` directory to
act on. Either option produces a permanently red PR that validates
nothing.

For a `pull_request` event GitHub resolves workflows from the PR's merge
ref — base merged with head — so a workflow present on the **head**
branch runs even when the base does not have it. The fix therefore
belongs on the branches that own the workflows: `ci.yml` in
`feat/repo-foundation` (#2), `database.yml` in
`feat/database-rls-foundation` (#3), propagated forward. That is why
every PR from #2 down now has checks.

## 6. PRs affected

No new PR was needed; no PR changed its base.

| PR | Branch | Base | Effect |
| --- | --- | --- | --- |
| #1 | `docs/engineering-specification` | `main` | none — see §8.2 |
| #2 | `feat/repo-foundation` | #1 | now runs CI |
| #3 | `feat/database-rls-foundation` | #2 | now runs CI + Database |
| #4 | `feat/order-inventory` | #3 | now runs CI + Database |
| #5 | `feat/payments-refunds` | #4 | now runs CI + Database |

## 7. GitHub check results

These are results GitHub actually executed, not local runs.

| PR | `build-and-test` | `db-test` |
| --- | --- | --- |
| #1 | *no checks* (§8.2) | *no checks* |
| #2 | **pass** (56s) | n/a — no `database.yml` on this branch |
| #3 | **pass** (1m02s) | **pass** (3m39s) |
| #4 | **pass** (1m01s) | **pass** (3m28s) |
| #5 | **pass** (56s) | **pass** (3m40s) |

What the green runs actually asserted, read from the run logs:

| PR | pgTAP | Deno | Integration |
| --- | --- | --- | --- |
| #3 | 10 files, **137/137** | — | **11/11** |
| #4 | 12 files, **264/264** | — | **54/54** |
| #5 | 13 files, **ALL GREEN** (314) | **8/8** gateway | **83/83** |

Every number matches the local clean-worktree verification recorded in
`GIT_CHECKPOINT_AUDIT.md` §7 exactly. CI independently reproduces the
baseline on ext4/ubuntu.

## 8. Remaining CI limitations

### 8.1 Deny-by-default rests on inherited grants, not explicit REVOKEs

**This is the substantive finding of this task and it needs a decision.**

On the unpinned `latest` toolchain, 7 pgTAP assertions across
`05_rls_staff_roles_and_admin_test.sql` and
`06_rls_profiles_and_staff_test.sql` flipped from *denied with 42501* to
*no exception* — for example "a customer cannot read `staff_roles` at
all", "no DELETE path for `authenticated`", and "an unauthenticated
session cannot query `profiles` at all".

Cause. Postgres applies the default ACL of whichever role creates a
table, and the Supabase image ships two for schema `public`:

```
owner            | schema | anon / authenticated get
-----------------+--------+--------------------------
postgres         | public | Dxtm       (no SELECT/INSERT/UPDATE/DELETE)
supabase_admin   | public | arwdDxtm   (full DML)
```

Locally all 23 public tables are owned by `postgres`, so
`anon`/`authenticated` hold no DML grant and the suite's GRANT-level
denials hold. Under the newer CLI the tables pick up the permissive
default instead, the grants exist, and denial falls back to RLS — which
returns **0 rows** for SELECT and DELETE rather than raising. That is
precisely the set of assertions that flipped. INSERT kept passing
because an RLS insert violation raises 42501 either way.

**No data was exposed.** RLS still denied every one of those reads and
writes. What was lost is the second layer `RBAC_MATRIX.md` §4/§5
asserts: that these tables carry no grant at all.

The migrations never `REVOKE` these privileges; they inherit them. So
the property holds by environment, not by construction.

Pinning the CLI (§3.5) makes CI deterministic and reproduces the
verified environment — all 137/264/314 assertions still run and still
must pass — but it is **not the fix**. The fix is explicit `REVOKE`
statements in a migration, which is a change to database behaviour and
therefore out of scope for a CI task. Recommended follow-up:

1. Add explicit `REVOKE ALL ON <table> FROM anon, authenticated` plus
   the intended narrow `GRANT`s, in a new migration.
2. Re-run the suite against both toolchains.
3. Unpin `setup-cli` once the assertions hold independently of the
   creating role.

Until then the pin is load-bearing and should not be removed casually.

### 8.2 PR #1 has no checks, and should not

Its branch is documentation-only on top of the unmigrated prototype.
Adding a workflow there would run the monorepo pipeline against a
`package.json` with no `typecheck` and no `test` script — a guaranteed
failure that validates nothing, and adding a trivially-green placeholder
would be worse than no check at all. PR #1 is reviewed by reading it.

### 8.3 Path filtering can leave `db-test` absent

`database.yml` is path-filtered, so a PR touching only documentation
gets no `db-test` run at all. GitHub records that as *absent*, not
*passed*. If `db-test` is later made a **required** status check, such a
PR will block forever waiting on a check that will never report. Decide
that before enabling branch protection.

### 8.4 CI status is per-commit

Pushing to any of these branches supersedes the results in §7. A green
row is evidence about one commit, not a standing property of the PR.

### 8.5 The stack is validated as a stack

Each PR is tested with its ancestors merged in, which is the correct
question for a stacked series. It is not evidence that any PR would pass
in isolation against `main` — and it should not be, since none of them
is intended to land that way.

### 8.6 Edge runtime is still not exercised

Integration suites spawn `_dev/serve.ts` rather than the CLI
edge-runtime container (`PHASE_4_IMPLEMENTATION_REPORT.md` §20).
Unchanged by this work. Handler code, database and auth path are
identical; the process wrapper is not.

### 8.7 Razorpay is still unverified

Unchanged and unrelated to CI: no live Razorpay sandbox transaction has
been executed. `PR_PLAN.md` §6 carries the remaining steps.

---

## Status

CI now runs on every pull request in the stack, and PRs #2–#5 are green
on GitHub's own infrastructure. Nothing was merged. Phase 6 has not
started.
