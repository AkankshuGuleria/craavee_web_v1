# Pull Request Plan — Git Checkpoint

How the accumulated Phase 0–5 work was partitioned for review, why these
boundaries and not others, and exactly how each PR is verified.

Companion document: `GIT_CHECKPOINT_AUDIT.md` (repository forensics,
secret sweep, verification baseline).

**No PR in this series is to be merged by automation. Human review and
merge decisions come after.**

---

## 1. Dependency graph

A linear stack. Each PR targets the branch below it.

```
main
 └── PR 1  docs/engineering-specification        (spec + audit; no code)
      └── PR 2  feat/repo-foundation             (monorepo + apps + packages)
           └── PR 3  feat/database-rls-foundation (0001–0003, RLS, pgTAP 00–10)
                └── PR 4  feat/order-inventory    (0004, create_order, pgTAP 11)
                     └── PR 5  feat/payments-refunds (0005, webhook, refund, pgTAP 12)
```

**Merge order: 1 → 2 → 3 → 4 → 5.** Each PR is a strict superset of the
state its predecessor establishes; none can be merged out of order
without conflicts.

Retargeting a PR to `main` after its base merges is a **human decision**
and has deliberately not been automated.

---

## 2. Summary table

| # | Branch | Target | Commits | Primary review surface |
| --- | --- | --- | --- | --- |
| 1 | `docs/engineering-specification` | `main` | 3 | Phase 1 specification, RBAC/RLS design, decision log |
| 2 | `feat/repo-foundation` | PR 1 | 6 | Monorepo structure, shared packages, three app surfaces |
| 3 | `feat/database-rls-foundation` | PR 2 | 4 | Schema, triggers, RLS policies, pgTAP |
| 4 | `feat/order-inventory` | PR 3 | 4 | Transactional order creation, reservation correctness |
| 5 | `feat/payments-refunds` | PR 4 | 4 | Webhook idempotency, refunds, gateway verification |

---

## 3. Why this partition

The candidate partition in the checkpoint brief was one PR per phase:
foundation → database → auth/catalog → orders → payments. That mapping
was tested against the actual diff and the actual import graph before
being adopted, and it **does not survive contact with the code** at two
of its five boundaries. The findings are recorded in
`GIT_CHECKPOINT_AUDIT.md` §6; the consequences are:

**The auth/catalog boundary does not exist.** `apps/customer-runner`'s
catalog screen — nominally Phase 3 — imports `lib/cart/store` and renders
a cart FAB, and the customer route layout registers the checkout, address
and order-confirmation screens. Those are Phase 4 artefacts. There is no
subset of the current files that constitutes "auth and catalog"; a
Phase 3 PR would require **writing new versions of those files that are
not the reviewed code**, shipping them for review, and deleting them one
PR later. That is worse for review quality, not better, so the customer
client ships whole, with the monorepo it lives in.

**The order/payment boundary exists in the database and the functions,
and that is where it is drawn.** `0004`/`0005`, pgTAP `11`/`12`, and the
`create_order` / `payment_webhook` + `refund` handlers are genuinely
separable, with no shared file needing an invented intermediate version
except `_dev/serve.ts` (a dev-only test harness; PR 4 registers three
handlers, PR 5 registers five). These are the highest-value review
surfaces in the repository — transactional inventory, webhook
idempotency, refund invariants — and each gets its own focused PR.

**The specification is separated from the implementation.** Phase 1's
specification documents (`DATABASE_SPEC`, `RBAC_MATRIX`,
`SECURITY_MODEL`, `ORDER_STATE_MACHINE`, `API_CONTRACTS`,
`ENGINEERING_SPECIFICATION`, `DECISION_LOG`, …) describe what PRs 2–5
implement. Reviewing them first is the correct reading order, and it
keeps ~5,000 lines of prose out of the code PRs. This is not the
"giant documentation-only PR" the brief warns against — that warning is
about sweeping leftover docs into a dumping ground. Phase implementation
*reports* are not here; each ships with the phase it reports on.

**Two constraints are deliberately absorbed rather than engineered
around:**

- *The foundation PR is large.* Removing the prototype and creating the
  monorepo is one change: split them and git's rename detection breaks,
  turning ~4,600 lines of moved UI into unreviewable delete-plus-add.
  Deferring the customer client would additionally require editing the
  root `package.json` workspaces array and regenerating
  `package-lock.json` into a state that never existed, risking unrelated
  transitive-dependency drift. The size is mitigated with six atomic
  per-concern commits, reviewable one at a time.
- *Early PRs forward-reference later paths.* Root `package.json` carries
  `db:test`, `functions:check` and `test:integration` scripts, and
  `packages/types/src/database.ts` carries generated schema types, before
  the migrations and functions they refer to land. Committing these files
  once, in final form, is preferable to fabricating per-PR variants of
  shared configuration. Each affected PR body says so explicitly.

**No PR fabricates historical chronology.** Phases 0–5 were implemented
before this checkpoint, uncommitted. Every PR describes the change it
actually makes to the branch it targets, and says plainly that it is a
clean checkpoint of previously-developed work rather than a replay of
how it was written.

---

## 4. The PRs

### PR 1 — `docs/engineering-specification` → `main`

**Summary.** The Phase 0 repository audit, the Agent OS product and
per-concern specs, and the complete Phase 1 engineering specification.
No executable code.

**Included.** `.agent-os/**` (17); `docs/audit/**` (5 — repository map,
backend readiness, security audit, implementation gap matrix);
`docs/engineering/`: `ENGINEERING_SPECIFICATION.md`, `DECISION_LOG.md`,
`DATABASE_SPEC.md`, `RBAC_MATRIX.md`, `SECURITY_MODEL.md`,
`ORDER_STATE_MACHINE.md`, `API_CONTRACTS.md`, `DEPLOYMENT_TOPOLOGY.md`,
`TEST_STRATEGY.md`, `PHASE_PLAN.md`, plus this plan and
`GIT_CHECKPOINT_AUDIT.md`.

**Verification.** No build or test surface. `git diff --check` clean; no
workflow is triggered (neither workflow file exists on `main`, and this
PR adds none).

**Reviewer focus.** `RBAC_MATRIX.md` and `SECURITY_MODEL.md` — every RLS
policy in PR 3 is generated from them. `ORDER_STATE_MACHINE.md` — pgTAP
`07`/`08` in PR 3 test it exhaustively. `DECISION_LOG.md` D37/D38 (gateway
selection, refunds) govern PR 5.

**Note.** `DECISION_LOG.md` is a single cumulative file and therefore
already contains decisions (D37, D38) about work that lands in PR 5.

---

### PR 2 — `feat/repo-foundation` → `docs/engineering-specification`

**Summary.** Replace the single-app Next.js prototype with an
npm-workspaces monorepo: four shared packages and three application
surfaces.

**Included.** Removal of the root prototype (66 files); root
`package.json` (workspaces), `package-lock.json`, `.gitignore`,
`.env.example`, `eslint.config.js`, `README.md`;
`.github/workflows/ci.yml`; `packages/{ui,types,validation,api-contracts}`;
`apps/store`, `apps/console` (ops shells); `apps/customer-runner`
(complete Expo client); `docs/engineering/PHASE_2B_IMPLEMENTATION_REPORT.md`
and `PHASE_3_IMPLEMENTATION_REPORT.md`.

**Commits.** (1) remove prototype + move shared UI into `packages/ui`
— staged together so the moves render as renames; (2) workspace root and
tooling; (3) shared packages; (4) ops app shells; (5) customer client;
(6) CI workflow and phase reports.

**Verification.**

```bash
npm ci && npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: typecheck clean across 7 workspaces; lint 0 errors / 2
pre-existing warnings; **44/44** unit tests; both Next.js apps build.
This is the only PR in the stack that currently triggers CI (`ci.yml`
fires on `pull_request: branches: [main]`).

**Reviewer focus.** That `packages/ui` is a faithful move, not a rewrite
— read the rename diffs. The workspace graph in root `package.json`.
`apps/*/src/lib/supabase/*` client construction. That
`.env.example` (all four) contains no values.

**Note.** Root `package.json` ships complete, so `db:test`,
`functions:check` and `test:integration` reference scripts and functions
introduced by PRs 3–5. `.github/workflows/database.yml` is deliberately
**not** here: it triggers on `packages/**`, and would run `supabase start`
against a tree with no `supabase/config.toml`. It ships with PR 3.

---

### PR 3 — `feat/database-rls-foundation` → `feat/repo-foundation`

**Summary.** The Postgres schema, money and state-machine constraints,
auth-role infrastructure, and the complete row-level-security policy set,
with a pgTAP suite proving them.

**Included.** `supabase/config.toml`, `supabase/.gitignore`,
`supabase/seed.sql`; migrations `0001_init.sql` (358),
`0002_triggers_and_functions.sql` (360), `0003_rls_policies.sql` (589);
pgTAP `00`–`10`; `scripts/run-db-tests.sh`;
`.github/workflows/database.yml`;
`apps/customer-runner/__tests__/auth-catalog.integration.test.ts`;
`docs/engineering/PHASE_2_IMPLEMENTATION_REPORT.md`,
`PHASE_2_TEST_PROVENANCE.md`.

**Verification.**

```bash
npm run db:reset && npm run db:test
```

Expected: `0001`→`0003` apply in order, seed applies, **219/219** pgTAP
assertions across 11 files (`00`:82 `01`:24 `02`:14 `03`:14 `04`:14
`05`:10 `06`:16 `07`:24 `08`:4 `09`:3 `10`:14). Plus the auth/catalog
integration suite against the live local stack.

**Reviewer focus.** `0003_rls_policies.sql` against `RBAC_MATRIX.md` —
every table, every role, deny-by-default. Whether any policy can be
satisfied by client-supplied claims. `07`/`08` state-machine coverage.
Money columns are integer minor units with check constraints (`01`).

---

### PR 4 — `feat/order-inventory` → `feat/database-rls-foundation`

**Summary.** Transactional order creation with reservation-based
inventory correctness, promo validation, reservation expiry, and the
Edge Function platform they run on.

**Included.** `supabase/migrations/0004_order_creation.sql` (806); pgTAP
`11_order_creation_test.sql` (325); `supabase/functions/`: `deno.json`,
`deno.lock`, `_shared/**` (context, errors, http, redact, sentry,
validation, **and `gateway/**` including the Razorpay adapter — see
below**), `_dev/serve.ts` (three handlers), `create_order/`,
`validate_promo/`, `expire_stale_reservations/`;
`scripts/serve-functions.sh`, `scripts/perf-create-order.mjs`;
`apps/customer-runner/__tests__/order.integration.test.ts`;
`docs/engineering/PHASE_4_IMPLEMENTATION_REPORT.md`.

**Verification.**

```bash
npm run db:reset && npm run db:test && npm run functions:check && npm run functions:test
npm run test:integration
```

Expected: `0001`→`0004`; **264/264** pgTAP (adds `11`:45); `deno check`
clean; **8/8** gateway safety tests; order + auth/catalog integration
suites green, including the concurrency and over-reservation cases.

**Reviewer focus.** Reservation acquire/release under concurrency —
whether two simultaneous orders can oversell. Expiry sweep versus a
late-arriving capture. That `create_order` is atomic across order rows,
line items and reservations. Promo validation server-side only.

**Why the gateway adapter is here.**
`create_order/handler.ts` imports `_shared/gateway/index.ts`, which
imports `razorpay.ts`. Deferring the adapter to PR 5 would mean shipping
a rewritten `gateway/index.ts` whose fail-closed selection logic is not
the reviewed logic. The adapter ships here; **the verification caveat in
PR 5 §6 applies to it equally.**

---

### PR 5 — `feat/payments-refunds` → `feat/order-inventory`

**Summary.** Payment settlement: signed webhook processing with
idempotency and amount verification, and refunds with wallet
reconciliation.

**Included.** `supabase/migrations/0005_payment_webhook_refunds.sql`
(491); pgTAP `12_payment_webhook_refund_test.sql` (317);
`supabase/functions/payment_webhook/`, `supabase/functions/refund/`;
`_dev/serve.ts` updated to register both;
`apps/customer-runner/__tests__/payment.integration.test.ts`;
`docs/engineering/PHASE_5_IMPLEMENTATION_REPORT.md`.

**Verification.**

```bash
npm run db:reset && npm run db:test && npm run functions:check && npm run functions:test
npm run test:integration
```

Expected: `0001`→`0005`; **314/314** pgTAP (adds `12`:50) — matching the
recorded Phase 5 baseline; `deno check` across all five functions;
**8/8** gateway tests; **83/83** integration tests.

**Reviewer focus.** Webhook idempotency under concurrent identical
delivery. HMAC verification against the **raw** body. Amount
verification (a capture for the wrong amount must not confirm). Refund
idempotency keyed on `idempotencyKey`, and the same key with a different
amount producing a deterministic conflict. Late capture after the expiry
sweep crediting the wallet rather than confirming.

---

## 5. Per-PR pre-flight checklist

Run for every PR before it is opened:

```bash
git diff --check                 # whitespace / conflict markers
git diff --stat <base>...HEAD    # size and shape
git diff --name-status <base>...HEAD
git status --porcelain           # nothing unintended left behind
```

Confirm: no `.env`, no `node_modules`, no `.next`/`.expo`, no
`*.tsbuildinfo`, no `._*` AppleDouble file; `package-lock.json` appears
exactly once (PR 2) and is not re-touched afterwards; migrations and the
code that depends on them are in the same PR; the PR's own tests were
actually executed, not assumed.

---

## 6. Payments: implemented vs. verified

Stated here once and repeated in PR 5's body, because the distinction is
easy to lose.

**Implemented and tested deterministically:**

- Real Razorpay adapter — order creation, checkout parameter
  construction, refund calls (`_shared/gateway/razorpay.ts`)
- Real HMAC-SHA256 webhook signature verification against the raw body,
  with tamper rejection
- Fail-closed gateway selection: the mock adapter is unreachable in
  `staging`/`production`, and missing credentials are a hard startup
  failure rather than a silent downgrade
- `payment_webhook`: idempotency, amount verification, replayed and
  concurrent delivery, unknown order refs, late capture after sweep
- `refund`: full, partial, duplicate, concurrent-duplicate,
  same-key-different-amount, over-refund, refund-after-refund, authz
- 50 pgTAP assertions + 8 Deno gateway tests + the payment integration
  suite, all green

**NOT verified:**

- **No transaction has ever been executed against a real Razorpay
  sandbox.** No `rzp_test_` credentials were available. Every payment
  path above was exercised against the deterministic mock adapter and
  against unit tests of the real adapter's pure functions.
- No real webhook has been delivered by Razorpay to a deployed endpoint.
- Production `rzp_live_` keys and merchant KYC are unverified; no live
  configuration has been exercised.

**Exact remaining verification steps:**

1. Obtain `rzp_test_` key id + secret from the Razorpay dashboard.
2. `supabase secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=…
   RAZORPAY_WEBHOOK_SECRET=…`, with `PAYMENT_GATEWAY=razorpay` and
   `CRAAVEE_ENV=staging` (which makes the mock adapter unreachable).
3. Deploy `create_order`, `payment_webhook`, `refund` to a staging
   Supabase project.
4. Register the deployed `payment_webhook` URL in the Razorpay dashboard
   for `payment.captured` and `payment.failed`; record the signing
   secret used.
5. Drive one real sandbox checkout end to end; confirm the order reaches
   `confirmed` and exactly one `webhook_events` row exists.
6. Replay the same webhook from the dashboard; confirm no second effect.
7. Issue a partial and then a full refund through the deployed `refund`
   function; confirm `partially_refunded` → `refunded`, the reservation
   releases, and the wallet credit matches.
8. Force a failed payment; confirm `payment_failed` and inventory
   release.
9. Only then evaluate `rzp_live_` keys, which additionally require
   completed merchant KYC.

---

## 7. Status

Git checkpoint prepared. Branches created and pushed; PRs opened for
review; **nothing merged**. Phase 6 has not started and must not start
until this stack is reviewed and integrated.
