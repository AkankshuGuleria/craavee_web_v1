# Phase 0 — Repository Discovery & Engineering Audit

Craavee · craavee_web_v1 · Audit date 2026-08-29 · Auditor: Claude (Agent OS
v3, Phase 0: Discover)

Companion documents (read alongside this one, not duplicated here):
`REPOSITORY_MAP.md`, `IMPLEMENTATION_GAP_MATRIX.md`, `SECURITY_AUDIT.md`,
`BACKEND_READINESS.md`.

Legend used throughout: **[FACT]** observed in code/git. **[DOSSIER]**
required by Craavee Product & Engineering Dossier v2.0. **[RECOMMENDATION]**
engineering judgment, not a decision. **[DECISION NEEDED]** open question
for the founder.

---

## 1. Project location on external SSD

`/Volumes/T7 Shield/Craavee/craavee_web_v1` (working tree). **[FACT]**

Note on structure: the T7 Shield SSD is formatted **exFAT**, and macOS's
current exFAT driver corrupts git's pack-index files and litters the tree
with AppleDouble (`._*`) sidecar files when `.git` is stored on it directly
— confirmed by reproducing `non-monotonic index` errors on a first clone
attempt. To keep git fully functional while still satisfying "work from the
SSD," the actual `.git` object database lives at
`~/.craavee-git/craavee_web_v1.git` (internal disk) and the SSD holds only
the working tree, linked via git's standard `--separate-git-dir` mechanism
(a `.git` *file*, not folder, points to it). `core.filemode` is set to
`false` locally since exFAT can't preserve Unix permissions (this was
producing a false 70-file "modified" diff with zero content changes — mode
bits only — now resolved). This was confirmed with the user before
proceeding (three options offered; this was the recommended and selected
one). Day-to-day, all files are edited and browsed on the SSD as normal;
only git's internal bookkeeping is elsewhere.

## 2. Git state

- Remote: `https://github.com/AkankshuGuleria/craavee_web_v1.git` **[FACT]**
- Branch: `main`, tracking `origin/main` **[FACT]**
- Working tree: clean, no local uncommitted changes at clone time **[FACT]**
- Original GitHub repository: untouched — only cloned, never pushed to
  **[FACT]**

## 3. Current commit

`d079294c7f2c3a23587a925c97f99f9fc0c5b0dc` — 2026-08-26 21:54:10 +0530 —
"Theme non-landing pages to dark aurora/glass system; rebuild immersive
homepage" **[FACT]**

2 commits total. Prior commit: `ef26121f` (2026-08-25) "Craavee
quick-commerce web app: fresh-tech spatial redesign." Both commits are
front-end/visual work; no commit touches backend, database, or auth logic.
**[FACT]**

## 4. Tech stack actually found

Next.js 16.3.2 (App Router, Turbopack) · React 19.2.8 · TypeScript 7.0.2
strict · Tailwind CSS v4 · Motion (Framer Motion) + GSAP · Phosphor/Lucide
icons. **No Supabase, no Expo/React Native, no payment gateway, no Sentry,
no PostHog, no k6, no Redis, no database client of any kind.** Full
side-by-side against the dossier's locked stack (§12) is in
`REPOSITORY_MAP.md`. **[FACT]**

## 5. Repository structure

71 tracked files, single Next.js app, no monorepo, no mobile app package.
Full tree in `REPOSITORY_MAP.md`. **[FACT]**

## 6. What my friend has already implemented

A visually complete, well-crafted **front-end prototype** of an in-venue
ordering product: landing page, fake sign-in, product catalog with cart,
order tracking UI, a packing queue, a runner queue/active-job flow, and an
admin live-ops board and catalog editor — nine screens total, all rendering
real, thoughtful UI (see `DESIGN.md` for the design system: "clay" tactile
surfaces, glass panels, spring animation, a considered color system). Three
Next.js API routes exist with in-memory mock data. A SQL schema file exists
describing a plausible (if SQLite-flavored) schema for this domain. This
represents real, non-trivial front-end engineering effort — the build and
typecheck both pass cleanly, the component architecture is sensible, and
the design system shows genuine product taste. **[FACT]**

**The single most important finding of this audit:** the domain this
prototype implements — venues, tables, seats, event credits — is not a
partially-built version of the campus hyperlocal quick-commerce product in
the v2.0 dossier. It is a complete UI prototype of a *different, earlier*
product shape. The dossier's own front matter says exactly this: "Supersedes
v1.1, which scoped Craavee as a single-event tool." **[DOSSIER, corroborated
by FACT]** This repository appears to be that v1.1 artifact (or very close
to it) — table/seat ordering for a single venue/event, paid for with event
credits, matches "single-event tool" precisely, down to the seed data
(`"seat": "Table B-2"`, `"VIP Lounge 1"`). This is not a criticism of the
work — it's accurate, useful prior work for a different product brief. But
it means the correct mental model for Phase 1 is **"reuse the design
system and the web-app skeleton, rebuild the domain model and the entire
backend,"** not "extend what's here."

## 7. What works

- `npm run build` and `npx tsc --noEmit` both succeed cleanly on a fresh
  install (Node v25.5.0, npm 11.8.0). Zero type errors, zero build errors.
  **[FACT]**
- All nine UI screens render and are visually polished. **[FACT]**
- The three mock API routes respond correctly to GET/POST/PATCH against
  their in-memory arrays (verified by reading the route handler code — not
  live-tested against a running server in this audit, but the logic is
  simple enough to verify by inspection). **[FACT]**

## 8. What is UI-only

`/shop`, `/shop/cart`, `/shop/track`, `/catalog`, `/live-ops`, `/packing`,
`/queue`, `/active` — all nine operational screens render either static
hardcoded arrays inline in the page component, or (for `/shop`) a shared
mock catalog from `src/lib/products.ts`. None of the admin or runner pages
import from the API routes, `lib/products.ts`, or fetch anything at all —
confirmed by grep: only 2 files in the entire `src/` tree call `fetch()`,
and neither talks to this app's own API. **[FACT]** Full breakdown in
`IMPLEMENTATION_GAP_MATRIX.md`.

## 9. What is mocked

Sign-in (any email-shaped string, instant, `localStorage` only), cart
(`localStorage`), delivery address (`localStorage` + free-text reverse
geocode, not structured campus geography), all three API routes' data
(in-memory arrays reset on server restart — and `/api/orders` and
`/api/runner/queue` each seed their *own, divergent* copy of "orders" mock
data rather than sharing state). **[FACT]**

## 10. What is broken

Nothing crashes — the build is clean. The closest thing to "broken":
`npm run lint` fails immediately (`next lint` errors with "Invalid project
directory provided, no such directory: .../lint" — no ESLint config exists
to fall back to), and `next.config.ts` only allowlists `picsum.photos` for
`next/image` while `src/lib/products.ts`'s mock catalog uses
`loremflickr.com` URLs — those would fail to load if ever rendered through
`next/image` rather than a plain `<img>`. Neither is production-blocking
today since neither path is exercised by real usage, but both would surface
immediately once real work resumes. **[FACT]**

## 11. What is missing

Everything the dossier defines as the actual product: a real database
(Postgres/Supabase), real auth (phone OTP), real authorization (RLS), real
payments (Razorpay/Cashfree), the correct data model (stores/zones/
addresses/inventory/payments/wallet_ledger/runner_earnings/promos/
audit_logs), all six correctness guarantees, realtime for staff surfaces,
notifications, observability (Sentry/PostHog), load testing (k6), the
customer/runner mobile app (Expo — not started at all), and every backend
business rule (reservation, idempotency, state-machine enforcement, refund
automation, one-live-job-per-runner). Full inventory in
`IMPLEMENTATION_GAP_MATRIX.md`.

## 12–15. Current customer / store / runner / admin flows

All four flows exist as **click-through UI only**, disconnected from any
data layer, with no authentication or authorization gating any of them.
Detailed per-screen status is the Gap Matrix's four surface tables. Nothing
in any of the four flows currently persists data beyond the current browser
tab's `localStorage` (customer surface) or is real at all (store/runner/
admin surfaces render fixed arrays with no interactivity that survives a
refresh).

## 16. Existing API map

Three Next.js Route Handlers, all backed by non-persistent in-memory
arrays, none of them called by any frontend code, none authenticated, none
validated. Full per-endpoint detail (path, method, auth, validation, DB op,
production-safety) is in `SECURITY_AUDIT.md` findings #2, #3, #8. In
summary: **zero of the three endpoints are production-safe**, not because
of a specific bug, but because they implement no auth, no validation, no
idempotency, and no real persistence. **[FACT]**

## 17. Existing database map

None. One decorative SQL DDL file (SQLite syntax) that nothing executes.
Full comparison against the dossier's 14-table data model is in
`REPOSITORY_MAP.md`.

## 18. Existing authentication model

`localStorage`-only, client-side, accepts any string containing `@`, no
server round-trip, no OTP, no session, no password. Functionally
equivalent to no authentication. **[FACT]** — see `SECURITY_AUDIT.md` #5.

## 19. Existing authorization model

None. The `User`/role type exists in `src/types/index.ts` but is never read
or enforced anywhere at runtime — the fake auth context doesn't even carry
a role field. Every operational URL (`/live-ops`, `/packing`, `/catalog`,
`/queue`, `/active`) is reachable by anyone. **[FACT]** — see
`SECURITY_AUDIT.md` #1, #6.

## 20. Security findings

Full detail in `SECURITY_AUDIT.md`. Headline: enforcement currently lives
nowhere (not client, not server, not database), which is the dossier's
explicitly-forbidden state taken to its extreme. Not exploitable for real
harm *today* only because nothing real (money, private data) is connected
yet — this is a build-it-right-the-first-time situation, not a
hardening-pass situation.

## 21. Correctness guarantee findings

All six dossier-mandated guarantees (§13) are **MISSING**, not partially
implemented: no idempotency key, no payment dedup, no inventory reservation
(products have a single flat `stock` int, decremented by nothing), no
locking on runner assignment, no one-live-job constraint, no order
transition validation (`PATCH /api/orders` accepts any status string
unconditionally). Full table in `IMPLEMENTATION_GAP_MATRIX.md`.

## 22. Payment readiness

Zero. No gateway dependency, no payment routes, no webhook endpoint, no
signature verification, no ledger table wired to anything. The one
money-shaped table that exists (`credit_ledger`) implements the event-credit
model the dossier explicitly says is the *wrong* call for this product
(§7, "Promo credit is a growth instrument, not the currency"). Payments are
not a partial feature here — they are a ground-up build, and per dossier
§17 the gateway KYC lead time (3–7 days) makes this the most time-sensitive
external dependency in the whole plan.

## 23. Realtime readiness

Zero. No Supabase Realtime, no polling loop anywhere (even `/shop/track`'s
order-status UI is fully static once rendered — it doesn't even fake
polling).

## 24. Notification readiness

Zero. No push notification code, and no Expo app for `expo-notifications`
to run inside even if it existed.

## 25. Performance / load readiness

No caching, no pagination, no rate limiting, no retry logic, no indexes
(no DB to index), no k6 scripts. Correctly absent of Redis, but for the
wrong reason — the dossier defers Redis *because a load test hasn't proven
it's needed yet*; this repo has no load test and no load-bearing backend to
test in the first place, so the absence isn't evidence of the disciplined
"deferred" stance, just of nothing existing yet.

## 26. Deployment readiness

No CI/CD, no `vercel.json`, no environment variable handling anywhere in
the codebase (no `.env.example`, no `process.env` reads), no Dockerfile.
`npm run build` succeeds, so a bare static/Vercel deploy of the current
UI-only app is technically possible today, but it would deploy nine screens
with no working backend behind any of them.

## 27. Agent OS state

No Agent OS installation existed anywhere on this machine or in this
repository prior to this session — confirmed by a filesystem search of the
repo and the user's home directory. The repo's `.gitignore` has a `.kilo/`
entry, indicating a different AI tool (Kilo Code) was used previously, but
that workspace was gitignored and its contents are not recoverable.
**[FACT]**

Initialized this session at `.agent-os/`:
- `product/mission.md` — condensed pointer to the dossier's product thesis
  **[DOSSIER]**, explicitly flagged against the current code's different
  domain model.
- `product/tech-stack-dossier.md` — the dossier's locked stack, verbatim
  reference.
- `standards/existing-codebase-facts.md` — evidence-only facts about the
  current repo, each traceable to a specific file. No invented standards.
- `specs/` — intentionally empty; per dossier §24, the engineering
  specification is explicitly the *next* artifact, not something to
  generate speculatively during discovery.

## 28. Dossier requirement coverage

Near-total gap. Of the dossier's headline requirements (one auth system,
Postgres/Supabase/RLS, real payments, six correctness guarantees, Expo
customer/runner app, Next.js store/console, structured campus addressing,
multi-store-ready `store_id`, phase-gated freeze discipline) — **zero are
implemented in the current codebase.** What exists is adjacent, reusable
infrastructure: a working Next.js/TypeScript/Tailwind toolchain, a genuine
design system, and proof that the founder's collaborator can ship clean,
typed, well-structured front-end code quickly. That's a real asset for
Phase 1 — it's just not the same asset as "campus commerce backend is 40%
done," which is the assumption this audit was commissioned to test and
disprove.

## 29. Critical blockers

1. **[DECISION NEEDED]** Domain-model resolution: confirm the venue/table
   framing is being fully discarded in favor of campus/store/hostel
   addressing before any schema work starts (see `BACKEND_READINESS.md`
   #1).
2. **[DOSSIER §24]** The engineering specification (complete DDL, RLS
   policies, role→capability matrix, API contracts, state machine,
   webhook/idempotency rules, env/secrets, deployment topology,
   per-phase definition of done) does not exist yet and is a prerequisite
   for coding, per the dossier's own working method.
3. **[DOSSIER §17, UNKNOWN status]** Payment gateway KYC, university
   permission, FSSAI registration, and business entity/bank account are
   all off the engineering critical path but gate launch entirely, and
   their current status can't be verified from the repository — the
   founder should confirm these directly and urgently, since the dossier
   flags university permission in particular as "the single most
   underrated risk" and all four should have started "day one" of the
   26-day plan (i.e., around 2026-08-19/20 if the plan started at dossier
   compile date — today, 2026-08-29, is roughly day 10 of that clock).
4. The Expo customer/runner mobile app has not been started at all — only
   the Next.js web surfaces exist.

## 30. Recommended implementation sequence

Not to be started yet — sequence only, pending the spec:

1. Resolve the domain-model decision (blocker #1 above) with the founder.
2. Write the engineering specification per dossier §24's freeze checklist.
3. Provision Supabase, write the full DDL + RLS policies as a reviewable
   migration (all 14 tables, `store_id` everywhere, correctness-guarantee
   constraints from dossier §13).
4. Phone-OTP auth end-to-end for the customer surface, deployed, catalog
   reading from the live database — this is the dossier's own Day 1–6 gate.
5. Order creation + payment flow (Day 7–12 gate): real gateway, server-
   computed amounts, signature-verified idempotent webhook.
6. Fulfilment loop — store pack, runner claim/deliver, delivery code
   (Day 13–20 gate).
7. Feature freeze (Day 21), then k6 + live dry run verification (Day 22–26).

Full reasoning and what's safe to start immediately (infra, not schema) is
in `BACKEND_READINESS.md`.

---

## Final summary

**A. Current state.** A visually polished, fully disconnected front-end
prototype of a *different* Craavee (v1.1, in-venue/event ordering) sits in
this repository. It builds and typechecks cleanly. It has no database, no
real auth, no payments, no authorization, and none of the dossier's six
correctness guarantees. Roughly 10 days into the dossier's own 26-day
clock, zero of the engineering phase gates have been met.

**B. What your friend built.** A clean Next.js 16/TypeScript/Tailwind v4
web app skeleton, a genuine and well-thought-out design system, and nine
fully-designed (if disconnected) screens covering customer, store, runner,
and admin surfaces for an in-venue ordering product. Real, reusable
front-end craft — just aimed at last year's product brief.

**C. What you need to build.** Essentially the entire backend and data
model from scratch (Supabase/Postgres/RLS/Edge Functions/payments/
realtime), a rebuilt domain model (campus/store/address, not venue/table/
seat), the Expo customer+runner app (currently 0% started), and every one
of the dossier's six correctness guarantees. The existing Next.js web
shell and design system are worth keeping for the Store/Console surfaces.

**D. Top 10 technical risks** (ordered by how much they threaten the
mid-September launch):
1. University permission status unknown — dossier's own "most
   underrated risk," and unverifiable from code.
2. Payment gateway KYC status unknown — 3–7 day lead time, blocks the
   dossier's own Day 7–12 gate.
3. Domain-model ambiguity (venue vs. campus) could stall Phase 1 if not
   resolved explicitly before schema work starts.
4. Zero of the six correctness guarantees exist — overselling and
   double-assignment are trivial to trigger in the current shape of the
   code if it were connected to a real database as-is.
5. No engineering specification exists yet, and the dossier is explicit
   that starting to code without one is how 26-day launches die.
6. The Expo mobile app hasn't been started — customer and runner surfaces
   currently exist only as web pages, a real platform gap versus dossier
   §12.
7. No idempotency anywhere in the current API shape — needs to be
   designed in from the first real endpoint, not bolted on.
8. No environment/secrets handling exists — needs to be established before
   the first real integration (Supabase, gateway) to avoid ad hoc secret
   management under time pressure.
9. Clock pressure: today is roughly day 10 of the dossier's 26-day plan
   with 0 of the phase gates met; the "money moves" gate (day 7–12) is
   already at risk without immediate focus.
10. exFAT/SSD git incompatibility (environment-level, now resolved) is a
    reminder to keep `.git` off exFAT for any future clone/worktree setup
    on this machine.

**E. Recommended next phase.** Do not proceed to Build. The next phase is
writing the **engineering specification** (dossier §24's freeze checklist),
starting with the domain-model decision in blocker #1 above — that decision
gates every table, every route, and every screen that follows.

**F. Gate before proceeding.** Per the dossier's own words (§24): *"Do not
start coding until every box [on the freeze checklist] is ticked."* Applied
here specifically: do not begin Phase 1 implementation until (1) the
founder has explicitly resolved the venue-vs-campus domain question, and
(2) a reviewable engineering specification exists covering schema, RLS,
API contracts, the state machine, and webhook/idempotency rules — matching
what this audit found completely absent from both the repository and the
rest of this machine.
