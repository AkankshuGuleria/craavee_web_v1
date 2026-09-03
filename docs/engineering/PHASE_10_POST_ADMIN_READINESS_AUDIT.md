# Post-Admin Production Readiness Audit

**Audit date:** 2026-09-03
**`main` at audit time:** `b1e18bef0f07af068cf97c757752635f80fbe20f`
**Product tree actually audited:** `32b685c1e54f0e2bc387c9c8d5584a369a567957`
(`feat/admin-operations-9b`)
**Branch:** `audit/post-admin-readiness` (documentation only)

---

## 0. Precondition — FAILED, and why this audit continued anyway

The Phase 10 brief instructed: *"verify Phase 9A merge is present, verify
Phase 9B merge is present ... Confirm PR #16 and PR #17 are actually
merged before proceeding. Do NOT assume."*

Verified, and **the precondition does not hold**:

| Check | Expected | Actual |
|---|---|---|
| PR #16 (Phase 9A) | merged | **`OPEN`**, `mergedAt: null` |
| PR #17 (Phase 9B) | merged | **`OPEN`**, `mergedAt: null`, base `feat/admin-operations-9a` |
| `supabase/migrations/0011_admin_operations.sql` on `main` | present | **absent** |
| `supabase/migrations/0012_admin_administration.sql` on `main` | present | **absent** |
| `main` working tree | clean | clean (0 modified files) |

`main` ends at Phase 8. The complete post-Phase-9 product exists only on
the stacked branch `feat/admin-operations-9b` (`32b685c`), which contains
9A + 9B.

**Decision taken.** Merging is the project owner's call and was not
delegated, so nothing was merged. The audit was instead performed against
`32b685c` — the tree that actually represents "the now-complete Craavee
product" the brief asks about. Auditing `main` would have produced a
report about a product two phases behind reality.

**Consequence for this document.** Every statement below describes
`32b685c`. Anything specific to 9A/9B is *not on `main`*, and the audit
branch itself is cut from `main` so its diff is documentation only.

---

## 1. Executive current-state summary

Craavee is **architecturally complete and internally verified** across
all four surfaces, and **externally unverified in every direction that
touches the outside world**.

What is genuinely strong:

- The **database is the boundary**, consistently. 23 tables with RLS
  (20 also `FORCE`), 42 functions, 12 `SECURITY DEFINER`, a transition
  table (`order_transition_rules`) read by both the trigger and the UI,
  and money as integer paise throughout.
- **Test depth is real, not decorative.** 570 pgTAP assertions across 18
  files, 211 integration tests, 44 unit, 8 gateway — and the two most
  dangerous invariants (refund/inventory release, catalog price snapshot)
  have regression tests *proven* to fail when the regression is
  reintroduced, not merely to pass today.
- **Concurrency correctness** is designed and tested: `FOR UPDATE SKIP
  LOCKED` on every contended write, partial unique indexes, idempotency
  keys on order creation and refunds.

What is genuinely not ready:

- **No deployment pipeline exists.** `DEPLOYMENT_TOPOLOGY.md` §4
  describes Vercel × 3 + EAS + Supabase × 3 tiers and says migrations are
  applied "via `supabase db push` in CI". There are exactly two
  workflows, `ci.yml` and `database.yml`, and **neither deploys
  anything**. No staging environment exists.
- **No backup or recovery posture exists.** A repo-wide search for
  `backup|pitr|point-in-time|restore drill|disaster recovery` across
  `docs/` and `.agent-os/` returns **one** hit, and it is about the SSD
  the repo lives on. For a system with a wallet ledger, this is the
  single most serious launch gap.
- **The push notification outbox is never drained.** `dispatch_
  notifications` exists, is correct, and is scheduled by **nothing** —
  no `pg_cron` entry, no scheduled function, no workflow. By contrast
  `expire_stale_reservations` *is* scheduled (migration 0004 §8).
- **Push cannot mint a token at all.** There is no `eas.json`, and
  `app.json` has no `extra.eas.projectId`, so
  `getExpoPushTokenAsync()` fails and `usePushNotifications` reports
  `"unconfigured"` by design.
- **The UI is two unrelated products.** The native app is light
  green-on-paper; Store and Console are dark orange-on-near-black. There
  is zero use of the green brand token in either web app.
- **The design system is 92% unused.** `@craavee/ui` exports ~26
  symbols; the two production web apps import exactly **two** (`OpsShell`,
  `cn`).

---

## 2. Customer readiness

| Area | Status | Evidence |
|---|---|---|
| Authentication (phone OTP) | **DONE** (local) | `(auth)/phone.tsx`, `verify.tsx`; canonical E.164 normalisation (PR #11); fixed test OTPs in `config.toml` |
| Catalog | **DONE** | `useCatalog` → `products_with_availability`, explicit column list, FlashList, `expo-image` |
| Search | **MISSING** | No search input, no query, no screen anywhere in `apps/customer-runner` |
| Category browse | **MISSING** | Catalog is ordered by `category, sort_order` but rendered as one flat list — no section headers, no filter |
| Product detail | **MISSING** | No route exists; `ProductCard` is add-to-cart only |
| Cart | **DONE** | Zustand `cart/store.ts` + pure `cart/logic.ts` |
| Address | **PARTIAL** | `address/new.tsx` only — no list, no edit, no delete, no default |
| Checkout | **DONE** | Promo, wallet toggle, correction states, `ORDER_ALREADY_EXISTS` handling |
| Payment | **PARTIAL / UNVERIFIED** | `usePaymentCheckout` + mock gateway; **no real Razorpay transaction ever performed** |
| Order creation | **DONE** | Idempotency-keyed, concurrency-tested |
| Order tracking | **PARTIAL** | Works, but the error state is a dead end (§7) |
| Polling (D20) | **DONE** | `useOrder` `refetchInterval` 8s/30s; static source scan proves no customer Realtime |
| Order history | **MISSING** | No list of past orders — an order is reachable only right after checkout or via a push tap |
| Account / profile | **MISSING** | No screen; sign-out is a text link in the catalog header |
| Push notifications | **UNVERIFIED (blocked)** | No EAS projectId → token cannot be minted; outbox never drained |
| Failure / retry | **PARTIAL** | Checkout is excellent; tracking has no retry |
| Empty / loading states | **PARTIAL** | Catalog has skeleton/empty/error; tracking has a bare `ActivityIndicator` |
| Offline / reconnect | **MISSING** | No `NetInfo`, no `onlineManager` wiring, no stale-data indicator. A failed poll shows stale state silently and indefinitely |
| Accessibility | **PARTIAL** | 2 a11y props on catalog, 4 on cart, 1 on checkout; `order/[id].tsx` and `address/new.tsx` have **zero** — the tracking screen and the only form in the app |

---

## 3. Runner readiness

| Area | Status | Evidence |
|---|---|---|
| Authentication | **DONE** | Shared auth; `resolveRouteAccess` gates by role |
| Queue | **DONE** | `(runner)/index.tsx` + `useRunnerJobs` |
| Claim | **DONE** | `claim_job`, `FOR UPDATE SKIP LOCKED`, `idx_orders_one_live_job_per_runner`; concurrent-claim test |
| Pickup | **DONE** | `mark_picked_up` |
| Delivery code | **DONE** | D14 bcrypt hash; plaintext in a separate customer-only table; rate-limited 5/15min |
| Delivery completion | **DONE** | `verify_delivery_code` |
| Delivery failure | **DONE** | Phase 8; no automatic refund (correct per brief) |
| Reassignment | **DONE** | `admin_reassign`, code re-minted |
| Realtime | **DONE** | Per-instance topic; auth bound before JOIN (two real defects fixed in Phase 8) |
| Reconnect | **DONE** | Refetch-on-reconnect, never replay; test §27.17 |
| Notifications | **UNVERIFIED (blocked)** | Same two blockers as customer; **plus** the tap handler routes every notification to `/(customer)/order/[id]` — a runner tapping a job notification lands on the customer route |
| Earnings visibility | **MISSING / BLOCKED** | No earnings screen. `runner_earnings` rows *are* written on every delivery with `amount = orders.delivery_fee` as a **placeholder** (migration 0007 line 531) |
| Failure states | **DONE** | `live`/`connecting`/`offline` indicator |
| Accessibility | **PARTIAL** | 9 props on `active.tsx`, 3 on the queue — the best-covered surface in the app |

---

## 4. Store readiness

| Area | Status | Evidence |
|---|---|---|
| Authentication | **DONE** | `requireStaff()` + middleware session refresh |
| Fulfilment queue | **DONE** | `packing/page.tsx`, RLS-scoped, `revalidate = 15`, indexed |
| Order detail | **DONE** | `packing/[orderId]` |
| Packing | **DONE** | `mark_packed` |
| Stock-out | **DONE** | `mark_stock_out` + refund path |
| Live updates | **DONE** | `RealtimeRefresh` (D21) |
| Reconnect | **DONE** | Auth-before-JOIN fix |
| Failure states | **PARTIAL** | Errors render as a subtitle string; **no skeleton, empty-state, error-state or confirm-dialog primitives exist in `apps/store` at all** — the Console grew these in `lib/admin/ui.tsx` and the Store never received them |
| Accessibility | **UNVERIFIED** | No a11y audit has ever been run against the web apps |

---

## 5. Admin / Console readiness

| Area | Status |
|---|---|
| Overview, Orders, Failed delivery, Runners, Reassignment, Kill switch | **DONE** (9A, unmerged) |
| Inventory, Catalog, Staff/Users, Refunds, Audit | **DONE** (9B, unmerged) |
| Promos | **MISSING** — route stub only |
| Metrics | **DEFERRED BY DECISION** — see §13 |
| Staff role read-back | **PARTIAL** — `staff_roles` has no client read policy; roles can be written, not listed |
| RBAC | **DONE** — all four 9B paths refused 401 unauth / 403 wrong-role; forged `actorId` writes nothing |
| Failure states | **DONE** — the strongest surface in the product (`ui.tsx`: Skeleton, EmptyState, ErrorState, ActionResult, ConfirmDialog) |
| Accessibility | **UNVERIFIED** |

---

## 6. External integration status

Nothing in this section has ever touched a real external service.

### A. Razorpay

| Item | Status |
|---|---|
| Adapter | **DONE** — `_shared/gateway/razorpay.ts`, implements the D12 interface unchanged |
| Production-safety branching | **DONE + TESTED** — 8 Deno tests; mock refused when `CRAAVEE_ENV` is production/staging; missing creds **fail closed**, never silently mock |
| HMAC webhook verification | **IMPLEMENTED** — `verifyWebhookSignature`; unit-tested against fixtures |
| Payment capture | **IMPLEMENTED**, mock-verified only |
| **Gateway refunds** | **MISSING BY DECISION (D38)** — `PaymentGatewayAdapter` has **no refund method**. Every refund in the product is a **wallet credit**. Refund-to-source does not exist |
| Secrets configuration | **DONE** — `.env.example` documents all three keys as `EDGE_FUNCTION_ONLY` |
| Merchant / KYC | **NOT STARTED** — external, human, gates live keys |
| **Actual sandbox transaction** | **NEVER PERFORMED** |

**Verification checklist:** create a Razorpay test account → set the three
keys on a staging Supabase project → place one order through
`create_order` Phase B → complete Checkout in test mode → confirm
`payment_webhook` receives, verifies HMAC, and moves the order to
`confirmed` → replay the same webhook and confirm idempotent no-op →
send a webhook with a corrupted signature and confirm rejection →
confirm no secret appears in any log or audit row.

### B. SMS OTP

| Item | Status |
|---|---|
| Supabase Auth phone OTP | **DONE** (local) |
| E.164 handling | **DONE** — canonical normalisation (PR #11) |
| Provider integration | **NOT CONFIGURED** — `[auth.sms.twilio] enabled = false`, empty `account_sid` |
| Test OTP behaviour | **DONE** — 15+ fixed local numbers |
| Rate limits | **RISK** — `sms_sent = 30` per hour locally; the dossier's own failure mode is "800 people opening the app inside ninety seconds". `DECISION_LOG.md` explicitly defers this as needing a conversation with Supabase, not an architecture change |
| **Real SMS delivery** | **NEVER VERIFIED** |

**Verification checklist:** provision Twilio (or Twilio Verify) → set the
auth token via env substitution, never committed → confirm delivery to a
real Indian handset on a real carrier → measure end-to-end OTP latency →
confirm `max_frequency = 5s` resend behaviour → **negotiate the hourly
SMS ceiling against the launch spike before Phase 13**.

### C. Push notifications

| Item | Status |
|---|---|
| Outbox + trigger | **DONE** — migration 0010, `FOR UPDATE SKIP LOCKED` batching |
| Dispatcher | **IMPLEMENTED** — Expo push API, `DeviceNotRegistered` cleanup, attempt counting |
| **Dispatcher schedule** | **MISSING — nothing invokes it** |
| Token registration | **IMPLEMENTED** — owner set from the verified JWT, not the body |
| Sign-out token cleanup | **DONE** |
| **EAS project configuration** | **MISSING** — no `eas.json`; no `expo.extra.eas.projectId`. `EAS_PROJECT_ID` is in `.env.example` but is wired to nothing |
| APNs | **NOT STARTED** |
| FCM | **NOT STARTED** — no `googleServicesFile` |
| Tap handling | **PARTIAL** — always deep-links to the customer order route |
| **Actual handset delivery** | **NEVER VERIFIED** |

**Verification checklist:** create the EAS project → add
`extra.eas.projectId` to `app.json` → write `eas.json` build profiles →
upload an APNs key and an FCM service account → EAS build to a real
device → confirm a token reaches `push_tokens` → **schedule
`dispatch_notifications`** → confirm a real banner arrives → confirm a
tap deep-links and refetches → confirm a runner notification opens a
runner screen → confirm a dead token is cleaned up.

### D. Sentry

| Item | Status |
|---|---|
| Edge Function capture | **IMPLEMENTED** — `_shared/sentry.ts`, used by 20 handlers |
| Redaction discipline | **DONE** — identifiers only; no OTP, no gateway secrets, no delivery codes |
| **Client SDK** | **MISSING** — no `@sentry/*` dependency in **any** `package.json`. Zero visibility into customer, runner, store or console crashes |
| **`environment` tag** | **MISSING** — staging and production errors would be indistinguishable |
| **`release` tag** | **MISSING** — errors cannot be attributed to a build |
| Source maps | **NOT CONFIGURED** |
| Performance tracing | **NOT IMPLEMENTED** |
| Delivery reliability | **RISK** — the POST is fire-and-forget with `.catch(() => {})` and is never awaited; an edge isolate can be torn down before it completes, dropping the event silently |
| **Actual ingestion** | **NEVER VERIFIED** |

---

## 7. UI/UX audit

Not a redesign — a prioritised backlog. **P0** prevents production;
**P1** major quality; **P2** polish; **P3** optional.

### Visual system

| # | Finding | Pri |
|---|---|---|
| U1 | **Two unrelated visual identities.** Native = green `#178A50` on paper `#F3F5EC`. Store/Console = orange/rose on `#0a0c10`. `grep` for `bg-brand\|text-brand\|border-brand` across both web apps returns **zero** matches | **P1** |
| U2 | **Design system 92% unused.** `@craavee/ui` exports ~26 symbols; the web apps import `OpsShell` and `cn`. `Button`, `Card`, `Input`, `StatusChip`, `CraaveeLoader` all exist and are ignored | **P1** |
| U3 | **22 distinct hand-rolled button/pill class strings** across 41 `<button>` elements. No shared button primitive is used | **P1** |
| U4 | `loading.tsx` is duplicated **byte-for-byte** between Store and Console except the word "store"/"console", and hardcodes `bg-[#0a0c10]` rather than a token | **P2** |
| U5 | Native tokens are hand-mirrored in **two** places (`lib/theme.ts` and `tailwind.config.js`), both with comments admitting the duplication | **P2** |
| U6 | `packages/ui/globals.css` carries **two** token vocabularies — a dark "obsidian/ember" set and a light "paper/green/mango" set — with no documented rule for which applies where | **P2** |
| U7 | `userInterfaceStyle: "light"` locks the native app to light; the web apps are dark-only. No dark/light strategy exists on either side | **P3** |

### Interaction

| # | Finding | Pri |
|---|---|---|
| U8 | **`expo-haptics` is a dependency with zero call sites.** No haptic feedback on add-to-cart, claim, delivery confirmation — the moments that most need it | **P2** |
| U9 | **`react-native-safe-area-context` is installed and never imported.** Safe areas are hardcoded magic numbers: `pt-14` (customer), `pt-16` (runner ×2). The cart FAB is `bottom-0 pb-6` with no inset | **P1** |
| U10 | No navigation transitions configured; default stack only | **P3** |
| U11 | Sign-out is an unconfirmed text link in the catalog header | **P2** |
| U12 | No keyboard-avoiding behaviour on `address/new.tsx` or `checkout.tsx` | **P1** |

### Perceived performance

| # | Finding | Pri |
|---|---|---|
| U13 | **No query persistence.** The `QueryClient` has no AsyncStorage persister, so every cold start shows an empty catalog and refetches | **P1** |
| U14 | Order tracking's loading state is a bare centred `ActivityIndicator` — no skeleton, no layout stability | **P2** |
| U15 | Console Overview issues **16 queries per load** — 9 status counts plus 7 others, in two `Promise.all` batches. Parallel within a batch, but still 16 round trips before first paint | **P2** |
| U16 | No image placeholder/blurhash strategy in `ProductCard`; `expo-image` supports it | **P2** |

### States

| # | Finding | Pri |
|---|---|---|
| U17 | **Customer order tracking's error state is a dead end** — "We couldn't load this order." plus a link back to the catalog. **No retry button**, on the screen a customer stares at while waiting for food | **P0** |
| U18 | **No offline or stale-data awareness anywhere in the customer app.** No `NetInfo`, no `onlineManager`. The entire customer design is polling (D20); when the poll fails the screen shows stale state silently and forever | **P0** |
| U19 | **`apps/store` has no state primitives at all** — no skeleton, empty, error or confirm components. Errors render as a subtitle string | **P1** |
| U20 | No session-expired handling on the native side; an expired session surfaces as a generic query error | **P1** |

### Accessibility

| # | Finding | Pri |
|---|---|---|
| U21 | **`address/new.tsx` — the only form in the app — has zero accessibility props.** Unlabelled `TextInput`s are unusable with a screen reader | **P0** |
| U22 | **`order/[id].tsx` has zero accessibility props** | **P1** |
| U23 | No touch-target audit; several controls are text-only `Pressable`s well under 44×44pt | **P1** |
| U24 | No contrast audit. `text-inkdeep/50` and `text-white/45` are both likely below 4.5:1 | **P1** |
| U25 | No keyboard-navigation or focus-order audit of Store/Console; `ConfirmDialog` focus trapping unverified | **P1** |
| U26 | `useMotionReduced` exists in `packages/ui` and is unused by product screens | **P2** |
| U27 | No dynamic-type support; all native sizing is fixed Tailwind classes | **P2** |

---

## 8. Design-system audit

**Current state.** Three parallel systems:

1. `@craavee/ui` — a marketing-prototype kit (aurora, marquee, warp
   background, shimmer, liquid text) plus five real primitives. The
   product uses `OpsShell` and `cn`.
2. `apps/console/src/lib/admin/ui.tsx` — the **de-facto real design
   system**: `Table`, `Th`, `Td`, `Skeleton`, `EmptyState`, `ErrorState`,
   `ActionResult`, `Pill`, `ConfirmDialog`, `fieldClass`, `btnClass`,
   `btnPrimaryClass`. Console-only; the Store cannot see it.
3. Native — `lib/theme.ts` + `tailwind.config.js`, hand-mirrored, both
   files carrying comments that say so.

**Smallest practical architecture** (deliberately not a rewrite):

- **Step 1 — one token source.** A tiny `@craavee/tokens` package
  exporting plain JS/JSON (colours, spacing, radii, type scale). The web
  CSS variables and the native `tailwind.config.js`/`theme.ts` both
  *generate* from it. This kills U5 outright and makes U1 a decision
  rather than an accident. No component moves.
- **Step 2 — promote, don't rewrite.** Move `lib/admin/ui.tsx` up to
  `@craavee/ui` as an `ops` entrypoint and have the Store import it.
  This is a file move plus imports, and it closes U19 and U4 at once.
- **Step 3 — resolve U1 explicitly.** Decide whether ops surfaces are
  intentionally a dark "operator" theme against a light consumer brand,
  or whether that divergence is drift. Either answer is fine; the current
  state is that nobody has chosen.
- **Explicitly not recommended:** rewriting the magicui/aurora layer.
  It is unused by the product and harmless; deleting it is a separate,
  low-value decision.

---

## 9. Performance audit

**No benchmarks are invented below.** Nothing has been profiled; these
are structural findings from reading the implementation.

**Already correct:** FlashList virtualisation, `expo-image`, explicit
column lists on every query, server-side pagination on all five 9B
consoles (40/40/30/25/50), `count: "exact", head: true` instead of
`rows.length`, related data fetched once and joined in a `Map` (no N+1),
`revalidate` on Store queues, no customer Realtime (D20 honoured, proven
by a static source scan).

**Findings:**

| # | Finding | Pri |
|---|---|---|
| P1a | **No query persistence** → cold start always empty (U13) | **P1** |
| P2a | Console Overview: 16 queries in two parallel batches per render (U15) | **P2** |
| P3a | Catalog fetches the **whole** product table with no `limit`. Acceptable at campus SKU counts; a latent cliff | **P2** |
| P4a | No bundle-size budget and **no native build in CI** — `ci.yml` builds Store + Console only. Metro bundling was verified by hand in an earlier phase | **P2** |
| P5a | `staleTime: 60_000` global with `refetchOnWindowFocus: false` — a price change is invisible for up to a minute after foregrounding | **P3** |
| P6a | No image placeholder strategy (U16) | **P2** |

**Targets — these are targets, not measurements.** They are already
specified in `TEST_STRATEGY.md` §3 and should not be reinvented:

| Metric | Target | Source |
|---|---|---|
| Catalog read p95 | **< 500 ms** | TEST_STRATEGY §3 |
| Order placement p95 | **< 1500 ms** | TEST_STRATEGY §3 |
| Request failure rate | **< 1%** (except the contention scenario) | TEST_STRATEGY §3 |
| Connection pool exhaustion | **zero events** | TEST_STRATEGY §3 |
| Realtime channels | **~15**, staff only | TEST_STRATEGY §3 |
| Customer polling | 8s live / 30s idle | D20 |

**Must actually be measured, and currently cannot be:** cold-start time
to first catalog paint, JS bundle size, interaction latency on a real
mid-range Android handset, Console table render at realistic row counts.
All four need Phase 10 (mobile packaging) and a staging environment
first.

---

## 10. Accessibility audit

Summarised in §7 (U21–U27). The load-bearing points:

- **P0:** the app's only form has no labels (U21).
- **P1:** the customer's primary tracking screen has no a11y props (U22),
  touch targets are unaudited (U23), contrast is unaudited (U24), and
  the web apps have never been keyboard-tested (U25).
- No automated a11y gate exists in CI. Adding `eslint-plugin-jsx-a11y`
  to the web apps and an `expo-a11y`-style lint pass to the native app is
  cheap and would prevent regression.

---

## 11. Security audit

**A full pass was run. No critical vulnerability was found, and
therefore no code was changed in this branch.**

**Verified sound:**

- **Secret scan clean.** 120 commits, full history, patterns
  `sk_live|rzp_live|rzp_test_*|BEGIN PRIVATE KEY|AKIA*|service_role+JWT`.
  Every hit is documentation prose or a test's own forbidden-string
  guard.
- **RLS:** 23 tables, 20 forced. No policy was weakened in 9A/9B, and no
  new base-table grant was added.
- **Delivery codes (D14/D39):** structurally protected. The plaintext
  lives in a separate table with a **customer-only** policy — no runner,
  packer, or admin policy exists. The authoritative value is a bcrypt
  hash on `orders`. Attempts are rate-limited 5 per order per 15 minutes,
  and a rate-limit row is written on every attempt, right or wrong.
- **Payment data:** `payments` is deliberately ungranted to
  `authenticated`; reads go through `security_barrier` admin/customer
  views. 9B added `refunds_admin_view` in the same shape rather than
  granting the base table.
- **Privilege boundaries:** `staff_roles` has no client-facing policy at
  all; `assign_staff_role` is the only door, and it refuses
  self-demotion. Every admin function derives the actor from the verified
  JWT — a forged `actorId`/`role`/`userId` in the body writes nothing.
- **Webhook verification:** HMAC-verified; production-safety branching
  fails closed with no credentials rather than silently mocking.
- **Audit log:** append-only by construction — no insert/update/delete
  policy exists for any client role. 9B's Console renders an allowlist of
  known metadata keys and counts the rest, so a future field cannot leak
  by being rendered.

**Findings (none critical):**

| # | Finding | Pri |
|---|---|---|
| S1 | **Rate limiting covers exactly one action.** `rate_limit_events` is generic, but only `verify_delivery_code` uses it. `create_order`, `refund`, `claim_job`, `validate_promo` and all six `admin_*` functions have **none**. A compromised or buggy admin session can issue refunds in a loop | **P1** |
| S2 | **Three tables enable RLS without `FORCE`:** `notification_outbox`, `order_delivery_codes`, `push_tokens`. `authenticated`/`anon` are unaffected (they are not owners) and `service_role` bypasses anyway, so this is **not client-exploitable** — but an owner-role connection (Studio SQL editor, migration tooling) reads plaintext delivery codes without policy. It is also inconsistent with the other 20 tables | **P1** |
| S3 | OTP rate limits are Supabase defaults (`sms_sent = 30`/hr locally), explicitly deferred in `DECISION_LOG.md`, and unreconciled against an 800-user spike | **P1** |
| S4 | No CAPTCHA on OTP request (`config.toml` has the provider block commented out). Campus-scale SMS-pumping abuse is cheap | **P2** |
| S5 | Sentry has no `environment` tag — a staging error and a production error are indistinguishable | **P2** |
| S6 | No dependency vulnerability scanning in CI (`npm audit`, Dependabot) | **P2** |

---

## 12. Load / scale readiness audit

**What has been load-tested: nothing.** `load-tests/k6/` exists and is
**empty**.

**What has been designed: everything.** `TEST_STRATEGY.md` §3 already
specifies eight scenarios (auth ramp 0→800 VUs over 90s, catalog browse,
order placement at 400 VUs, deliberate stock contention at 50 VUs, promo
contention at 100 VUs, customer polling at 400 VUs, runner claims at
10–15 VUs, full transition sequences) with thresholds. **This does not
need redesigning — it needs implementing.**

**Reconciling the ~800-user target against the actual architecture:**

| Pressure | Architecture's answer | Verdict |
|---|---|---|
| Order-creation contention | `FOR UPDATE SKIP LOCKED`, idempotency key, tested at 2 concurrent | Design sound, **scale unproven** |
| Inventory contention | Row locks + `reserved_not_above_on_hand` | Design sound, **scale unproven** |
| Promo contention | `max_uses`/`per_user_limit` tested at 5 concurrent | Design sound, **scale unproven** |
| Payment webhook | Idempotency-keyed by `gatewayEventId` | Design sound, **never load-tested** |
| Realtime fan-out | **Staff only** (~15 channels). D20 keeps 800 customers off Realtime entirely | **Structurally the strongest decision in the system** |
| Customer polling | 800 × 1/8s ≈ **100 req/s sustained** | Plausible; unmeasured |
| Connection pressure | Supavisor pooling assumed | **Unverified — no Supabase project exists** |
| RLS overhead | Every customer read evaluates a policy | **Never measured** |
| Edge Function concurrency | Supabase platform default | **Unknown; no plan tier chosen** |
| **SMS throughput** | Supabase Auth defaults | **The likeliest real breaking point** (§6B) |

**Safe test plan — explicitly not a blind big run on this machine:**

1. **Local smoke (safe here).** 10–20 VUs against the local stack, purely
   to prove the k6 scripts are correct. Assert behaviour, not latency —
   this laptop is not a capacity signal.
2. **Staging functional (needs staging).** 50 VUs. First real numbers.
3. **Representative campus load.** 400 VUs, mirroring the real cohort
   split. This is the number that matters.
4. **Peak burst.** The full 800/1600-VU design, run **only** against a
   staging project on the intended production plan tier.

Steps 2–4 are blocked on a staging environment that does not exist.

---

## 13. Observability audit

**What can be observed in production today: essentially nothing, because
there is no production, and the instrumentation that exists is
server-only and untagged.**

| Signal | Status |
|---|---|
| Structured Edge Function logs | **DONE** — every capture emits `[craavee] {json}` to the Supabase log drain regardless of DSN |
| Function errors → Sentry | **IMPLEMENTED, NEVER VERIFIED**, no environment/release tag, fire-and-forget delivery |
| Client errors | **MISSING** — no client SDK anywhere |
| Request correlation | **MISSING** — no request id threaded through function → database → audit |
| Order / payment ids in logs | **DONE** — both are first-class capture fields |
| Webhook failures | **PARTIAL** — captured, but no alert |
| Auth failures | **MISSING** — Supabase-side only, unaggregated |
| Inventory / delivery failures | **DONE in-product** (audit log + Console) |
| Queue depth | **PARTIAL** — Console Overview shows it; nothing alerts on it |
| **Notification outbox depth** | **MISSING — and this is the one that matters**, because nothing drains the outbox (§6C). It would silently grow forever with no signal |
| Service-pause events | **DONE** — audited kill switch |

**Minimum before launch** (deliberately small):

1. Sentry `environment` + `release` tags, and **verify one real event
   arrives**.
2. A client SDK on at least the customer app — it is where users are and
   where you currently see nothing.
3. An alert on **notification outbox depth** and on **`payment_webhook`
   failure rate**. These two fail silently and cost money.
4. Await (or `waitUntil`) the Sentry POST so events are not dropped on
   isolate teardown.

**PostHog is deliberately not added here.** `ENGINEERING_SPECIFICATION.md`
§15 and `PHASE_PLAN.md` Phase 11 both own product analytics. Nothing in
this audit found a reason to pull it forward.

---

## 14. Operational safety audit

| Control | Status |
|---|---|
| Migrations | **STRONG** — 12 sequential files, `db reset` in CI, applied migration list printed |
| **Migration rollback** | **MISSING** — no down-migrations, no rollback rehearsal |
| **Backups** | **MISSING — no policy, no documentation, no drill.** One repo-wide hit for `backup`, about the SSD |
| **Point-in-time recovery** | **MISSING** — never mentioned |
| Idempotency | **STRONG** — order creation, refunds, webhooks, notification dispatch |
| Auditability | **STRONG** — append-only by construction |
| Refund consistency | **STRONG** — the Phase 9A oversell bug is fixed and has a proven regression test |
| Inventory consistency | **STRONG** — `qty_reserved` is unadjustable by design |
| Order state machine | **STRONG** — one transition table, read by trigger and UI |
| Delivery-failure recovery | **DONE** — Phase 8, no automatic refund |
| Stale reservations | **DONE** — `pg_cron` every minute (0004 §8) — **but the schedule is wrapped in `exception when others then raise notice`, so a failure to install is a log line, not an error.** Verify it is actually running in every deployed environment |
| Expired payment intents | **DONE** — same sweep |
| Webhook replay | **DONE** — `webhook_events` dedupe |
| **Notification retry** | **BROKEN IN PRACTICE** — attempts are counted correctly, but nothing runs the dispatcher |
| Abandoned runner jobs | **PARTIAL** — `release_job` and admin reassignment exist; **no automatic reaper** for a runner who goes offline mid-delivery |
| Stuck operational states | **PARTIAL** — the Console can move most things by hand; the kill switch exists |

**Must-have before launch:** backups + one rehearsed restore; the
notification dispatcher scheduled; confirmation that `pg_cron` actually
installed; an abandoned-job policy.

---

## 15. Runner earnings decision

**Status: UNDEFINED / BLOCKED. Confirmed unchanged. No formula was
invented.**

- **Where documented:** `ENGINEERING_SPECIFICATION.md` §L defers it as an
  open pricing decision; migration 0011 §4 marks
  `process_settle_runner_earnings` blocked; the handler's own header says
  "BLOCKED, deliberately unreachable".
- **What depends on it:** `settle_runner_earnings` (function + Edge
  Function), any runner earnings UI, any payout process.
- **Enforcement:** a Phase 9B integration test greps the shipped app
  source and fails if any file references `settle_runner_earnings`.
  Verified again in this audit: **zero callers.**
- **What can safely ship without it:** everything else. The formula
  affects no order, payment, refund or inventory path.
- **What cannot:** any runner-facing earnings display, and any payout.

**One consequence that deserves the owner's attention.** Blocking
settlement does *not* stop rows accruing. `verify_delivery_code` inserts
a `runner_earnings` row on **every delivery** with
`amount = coalesce(orders.delivery_fee, 0)` as a documented placeholder
(migration 0007:531), using `on conflict (order_id) do nothing`. So:

1. Every delivered order already writes an earnings amount.
2. If the eventual formula differs from `delivery_fee`, every row written
   before the decision is **wrong**.
3. `do nothing` means re-running will not correct them — a backfill
   migration would be required.

This is not a reason to invent the formula. It is a reason to **decide it
before real deliveries happen**, or to stop writing the placeholder. The
recommendation is: settle the formula before the Phase 13 dry run, since
that is the first time real deliveries create real rows.

---

## 16. Production verification matrix

Verification levels, strictly distinguished:
**IMPL** implemented · **LOCAL** tested locally · **CI** tested in CI ·
**BROWSER** browser/simulator verified · **EXT** real external service
verified · **PROD** production verified.

| Area | Status | Evidence | Missing verification | Blocks launch? |
|---|---|---|---|---|
| Auth (phone OTP) | CI | Phase 3 integration suite; canonical E.164 | **EXT** — real carrier SMS | **YES** |
| SMS delivery | IMPL | Local fixed OTPs only; no provider configured | EXT, plus rate-limit negotiation | **YES** |
| Payments | CI | 8 gateway tests, mock end-to-end | **EXT** — one real sandbox transaction | **YES** |
| Refunds (wallet) | CI + BROWSER | pgTAP + integration; ₹20 partial verified in browser | — | No |
| Refunds (to source) | **MISSING BY DECISION** | D38; no adapter method | Product decision | No |
| Push | IMPL | Outbox + dispatcher + registration | **EXT**; **no EAS projectId**; **no scheduler** | **YES** |
| Sentry | IMPL | 20 handlers instrumented | **EXT**; no env/release tag; no client SDK | **YES** |
| Realtime | CI + BROWSER | Phase 8; two real defects found and fixed | Fan-out under load | No |
| Customer app | BROWSER (sim) | Runs on iOS sim, Android emulator, web | **Real device**; search/detail/history missing | **YES** (device) |
| Runner app | BROWSER (sim) | Full job loop verified | Real device; notification routing | **YES** (device) |
| Store app | BROWSER | Queue → packing verified | a11y; state primitives | No |
| Admin console | BROWSER | All 11 surfaces exercised | a11y | No |
| Inventory | CI + BROWSER | Refusal + correction verified | — | No |
| Catalog | CI + BROWSER | Price-snapshot regression **proven** | — | No |
| Security | CI | 120-commit secret scan; RBAC matrix exercised | Pen test; rate-limit coverage | **YES** (S1) |
| **Backups** | **NOTHING** | — | **Everything** | **YES** |
| Observability | IMPL | Structured logs | EXT ingestion; alerts | **YES** |
| Performance | IMPL | Structural review only | Every measurement | No (P1) |
| Load | **NOTHING** | `load-tests/k6/` empty; §3 designed | Entire k6 layer + staging | **YES** |
| Accessibility | **PARTIAL** | Sparse a11y props | Screen reader, contrast, keyboard | **YES** (U21) |
| UX | PARTIAL | Works; inconsistent | See §7 | **YES** (U17/U18) |
| **Deployment** | **NOTHING** | Topology documented, **no pipeline** | Everything | **YES** |

---

## 17. Launch blockers

### P0 — cannot launch

| # | Blocker | Evidence |
|---|---|---|
| B1 | **No backup or recovery posture.** A wallet ledger with no restore path | §14; one repo-wide hit for `backup`, about the SSD |
| B2 | **No deployment pipeline and no staging environment.** Topology is documented; neither workflow deploys | `.github/workflows/` = `ci.yml`, `database.yml` |
| B3 | **Payments never externally verified.** Not one real sandbox transaction | §6A |
| B4 | **Real SMS OTP never verified**, and no provider configured. If OTP fails, nobody signs in | §6B |
| B5 | **Push cannot work.** No EAS projectId → no token; **and nothing drains the outbox** | §6C |
| B6 | **No load test exists.** `load-tests/k6/` is empty against an 800-user launch | §12 |
| B7 | **Customer offline/stale blindness (U18)** and **dead-end tracking error (U17)** — on the screen a waiting customer watches | §7 |
| B8 | **The only form in the app is screen-reader unusable (U21)** | §7 |
| B9 | **Never run on a real handset.** Simulator and emulator only | §16 |

### P1 — should not launch without fixing

| # | Item |
|---|---|
| B10 | Rate limiting covers one action out of ~20 (S1) |
| B11 | `FORCE ROW LEVEL SECURITY` missing on 3 tables, including delivery codes (S2) |
| B12 | SMS rate limits unreconciled against the launch spike (S3) |
| B13 | No client-side error visibility on any surface (§13) |
| B14 | Sentry has no `environment`/`release` tag; delivery is fire-and-forget |
| B15 | **Runner earnings placeholder rows accrue on every delivery** (§15) |
| B16 | Two unrelated visual identities (U1); design system 92% unused (U2) |
| B17 | `apps/store` has no loading/empty/error/confirm primitives (U19) |
| B18 | Safe areas hardcoded; `react-native-safe-area-context` installed and unused (U9) |
| B19 | No query persistence → empty cold start (U13) |
| B20 | Customer has no order history and no account screen |
| B21 | No abandoned-runner-job reaper (§14) |
| B22 | `pg_cron` installation is best-effort and unverified in any deployed environment |
| B23 | No keyboard avoidance on the two native forms (U12) |

### P2 — quality/polish
U4, U5, U6, U8, U11, U14, U15, U16, P3a, P4a, S4, S5, S6, U26, U27,
Console promos surface, staff-role read-back.

### P3 — future
U7 (dark/light strategy), U10 (navigation transitions), P5a, gateway
refunds (D38), runner shift scheduling, referral mechanics.

---

## 18. Ordered roadmap

The tracks in the brief are sound, with **two evidence-based
deviations**:

1. **Deployment and backups come first, before everything.** The brief's
   Track A starts with integrations, but no integration can be verified
   without a staging environment to verify it in, and no money should
   move before a restore has been rehearsed. B1/B2 gate almost every
   other track.
2. **Design tokens come before any UX work.** Doing Customer, Runner,
   Store and Console UX in parallel across two divergent token sets
   guarantees rework. One small token/primitive track first makes the
   four UX tracks cheaper.

| Track | Goal | Depends on | Blocks launch |
|---|---|---|---|
| **A0 — Deployment + data safety** | Staging + production Supabase projects, Vercel projects, `db push` in CI, **backups + one rehearsed restore** | — | **YES** (B1, B2) |
| **A — Production integrations** | Razorpay sandbox, real SMS, EAS + push (incl. **scheduling the dispatcher**), Sentry env/release + client SDK | A0 | **YES** (B3–B5) |
| **B — Design tokens + shared primitives** | One token source; promote `lib/admin/ui.tsx` to shared ops primitives | — | No (B16, B17) |
| **C — Customer UX** | Offline/stale awareness, retry on tracking, order history, account, search + category, product detail, query persistence, safe areas | B | **YES** (B7) |
| **D — Runner UX** | Notification routing, earnings display *(gated on §15)*, safe areas | B, A | No |
| **E — Store UX** | Adopt shared primitives; real loading/empty/error/confirm | B | No |
| **F — Admin UX** | Promos surface; staff-role read path; a11y | B | No |
| **G — Performance** | Query persistence, Overview round trips, image placeholders, bundle budget, native build in CI | A0 | No |
| **H — Accessibility** | Labels, targets, contrast, keyboard, CI a11y lint | B | **YES** (B8) |
| **I — Security + load** | Rate limiting beyond delivery codes, `FORCE` RLS, k6 implementation, full run | A0, A | **YES** (B6, B10) |
| **J — Real device/service verification** | TestFlight + Play internal track; real handset order and job | A | **YES** (B9) |
| **K — Campus dry run** | 25+ real users, real money, campus network | all above | **YES** |
| **L — Launch** | Freeze, go/no-go | K | — |

**Acceptance criteria** are stated per phase in §19.

---

## 19. Future Agent OS phases

**Numbering collision, stated explicitly.** `PHASE_PLAN.md` already
defines Phase 10 = Mobile packaging, 11 = Observability, 12 = Load +
security, 13 = Dry run, 14 = Freeze. The brief calls this audit
"Phase 10". To avoid two different Phase 10s, this document is
**Phase 9C (audit)** and the phases below slot into the existing plan
rather than renumbering it.

A second gap worth naming: **`PHASE_PLAN.md` contains no UI/UX phase at
all.** It goes from Admin Console straight to mobile packaging. Phases
10A–10D below are additions, not re-orderings.

---

### PHASE 9C — This audit
**Objective.** Evidence-based readiness assessment and plan.
**Out of scope.** All implementation.
**Gate.** Owner reviews and accepts the blocker list. ✅ this document.

---

### PHASE 10A — Deployment + data safety
**Objective.** A real staging environment, and a restore that has
actually been performed.
**Areas.** `.github/workflows/` (new deploy workflow), Supabase project
provisioning, Vercel projects, `DEPLOYMENT_TOPOLOGY.md`, a new
`docs/engineering/RUNBOOK.md`.
**Depends on.** Nothing. **Start here.**
**Out of scope.** Any product code.
**Tests.** A migration applied to staging via CI; a restore drill
executed and documented.
**Acceptance.** Staging reachable; `db push` runs from CI; a backup is
taken and **restored into a scratch project**, with the wallet ledger
verified intact; `pg_cron` confirmed installed and running.
**PR boundary.** One PR, workflows + docs. ~6 files.

---

### PHASE 10B — Scheduled work + operational reapers
**Objective.** Everything that must run on a timer actually runs.
**Areas.** New migration (dispatcher schedule), `dispatch_notifications`,
an abandoned-job policy.
**Depends on.** 10A.
**Out of scope.** Notification content; push credentials (10C).
**Tests.** pgTAP asserting the cron entries exist; an integration test
proving an enqueued notification is drained by a scheduled run.
**Acceptance.** Outbox depth returns to zero unattended; a runner who
goes offline mid-job is detectable and recoverable.
**PR boundary.** One PR. ~5 files.

---

### PHASE 10C — External integration verification
**Objective.** Every external dependency proven against the real service.
**Areas.** `eas.json` (new), `app.json` (`extra.eas.projectId`), Twilio
config, Sentry env/release tags + `waitUntil`, client SDK.
**Depends on.** 10A, 10B. **Also depends on human/legal work** (Razorpay
account, Twilio account, Apple/Google developer accounts) that no phase
can do for you.
**Out of scope.** Merchant KYC and live keys — test mode only.
**Tests.** Each checklist in §6, executed and recorded.
**Acceptance.** One real sandbox payment captured via webhook; one real
SMS OTP received on a real handset; one real push banner delivered and
tapped; one deliberate error visible in Sentry tagged with environment
and release.
**PR boundary.** One config PR; the verification evidence goes in a
report. ~10 files.

---

### PHASE 10D — Design tokens + shared primitives
**Objective.** One token source; one ops primitive kit.
**Areas.** New `packages/tokens`; `packages/ui` (`ops` entrypoint);
`apps/customer-runner/{lib/theme.ts,tailwind.config.js}`;
`apps/console/src/lib/admin/ui.tsx` → moved; `apps/store` imports.
**Depends on.** Nothing — can run in parallel with 10A–10C.
**Out of scope.** **No screen is redesigned.** Visual output should be
near-identical; this is a plumbing phase.
**Tests.** Existing suites unchanged; a snapshot/visual check that Store
and Console render identically before and after.
**Acceptance.** Exactly one file defines each token; Store and Console
import the same primitives; the U1 brand question is answered in writing.
**PR boundary.** One PR. ~20 files, mostly moves.

---

### PHASE 10E — Customer UX (the launch-blocking half)
**Objective.** Close B7, and the gaps a real customer will hit first.
**Areas.** `order/[id].tsx` (retry, skeleton, stale indicator), a new
connectivity provider wired to `onlineManager`, query persistence,
`SafeAreaView` adoption, keyboard avoidance.
**Depends on.** 10D.
**Out of scope.** Search, product detail, order history — those are 10F.
**Tests.** Integration tests for the offline/stale path; a11y assertions.
**Acceptance.** With the network down, the customer sees that data is
stale and can retry; a failed tracking load offers a retry; a cold start
paints cached catalog.
**PR boundary.** One PR. ~12 files.

---

### PHASE 10F — Customer completeness
**Objective.** The screens a commerce app is expected to have.
**Areas.** Search, category browse, product detail, order history,
account.
**Depends on.** 10D, 10E.
**Out of scope.** Recommendations, reorder, ratings.
**Acceptance.** A customer can find a product by name, read its detail,
and see past orders without a notification.
**PR boundary.** One PR per screen group; **two PRs**, not one.

---

### PHASE 10G — Runner + Store + Admin UX
**Objective.** Bring the other three surfaces onto the shared primitives.
**Areas.** Notification routing by role; Store state primitives; Console
promos; staff-role read view.
**Depends on.** 10D. **Runner earnings display is gated on §15 and stays
out until the formula is decided.**
**PR boundary.** Three PRs, one per surface.

---

### PHASE 10H — Accessibility
**Objective.** Close B8 and the P1 a11y set.
**Areas.** Every screen; `eslint-plugin-jsx-a11y` in CI.
**Depends on.** 10D–10G.
**Acceptance.** Every interactive element labelled; targets ≥ 44pt;
contrast ≥ 4.5:1 verified with a tool; both web apps keyboard-navigable;
CI fails on a new violation.
**PR boundary.** One PR per app. ~4 PRs.

---

### PHASE 10I — Security hardening
**Objective.** Close S1 and S2.
**Areas.** New migration (`FORCE` on 3 tables; rate-limit helper);
`_shared/` rate-limit middleware; the `admin_*` and money functions.
**Depends on.** 10A.
**Out of scope.** Any change to the RLS policy set — the audit found it
sound.
**Tests.** pgTAP asserting `FORCE` on all 23 tables; integration tests
proving the Nth rapid call returns `RATE_LIMITED`.
**Acceptance.** No table has RLS enabled without `FORCE`; every
money-moving and admin function is rate-limited.
**PR boundary.** One PR. ~10 files.

---

### PHASE 11–14 — unchanged from `PHASE_PLAN.md`
Observability + analytics, load + security verification (this is where
the empty `load-tests/k6/` is filled in against `TEST_STRATEGY.md` §3),
live dry run, production freeze. **`PHASE_PLAN.md` Phase 10 (Mobile
packaging) is subsumed by 10C's EAS work plus the real-device
verification in Track J.**

---

## 20. Statement

**No Phase 10 implementation work was started.**

No screen was redesigned. No design system was rewritten. No animation
was added. No navigation was changed. No backend architecture was
altered. No migration was written. No RLS policy, grant, function or
Edge Function was modified. No dependency was added or removed.

**No critical defect was fixed, because none was found.** The security
pass in §11 found six findings, all P1 or lower, none client-exploitable,
and none meeting the brief's bar of "a critical production/security
defect discovered during the audit". The two most serious items in this
document — no backups (B1) and no deployment pipeline (B2) — are absent
infrastructure, not defective code, and cannot be fixed in a
documentation branch.

This branch contains exactly one file: this document.
