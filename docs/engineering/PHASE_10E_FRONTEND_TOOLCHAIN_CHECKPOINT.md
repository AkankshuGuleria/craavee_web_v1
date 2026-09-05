# Phase 10E — Premium Frontend Toolchain Audit + Selective Installation

**Branch:** `feat/customer-experience-10e`
**Base `main`:** `61007ed7b76d646ad5275181ab2f14db1751ef97`
**Date:** 2026-09-04

Per §61, the toolchain was audited **before** any customer screen work
began. This document records what was found, what was installed, what was
rejected, and why. The headline result is that almost nothing needed
installing.

---

## 1. The headline finding: the stack was already stocked, and unused

The audit's first question was "what premium animation and interaction
capability is missing?" The answer was **none of it**. Four capable
libraries were already declared dependencies of `apps/customer-runner`,
and every one of them had **zero import sites** in the entire repository:

| Package | Declared version | Import sites (apps + packages) |
|---|---|---|
| `react-native-reanimated` | `4.5.1` | **0** |
| `react-native-gesture-handler` | `~2.32.0` | **0** |
| `@gorhom/bottom-sheet` | `^5.2.14` | **0** |
| `moti` | `^0.30.0` | **0** |

Measured with an exact-boundary grep across `apps/` and `packages/`
(`*.ts`, `*.tsx`, excluding `node_modules`).

**A measurement trap worth recording**, because I fell into it first: a
prefix grep for `from "moti` returns **6 hits**. All six are
`motion/react` — the web animation library used by `apps/store`,
`apps/console` and `packages/ui`. It is a completely different package
from `moti` (the React Native one). The correct count for `moti` is zero.
Anchoring the pattern on a closing quote or a path separator is what
distinguishes them.

The implication for §61 is direct: **the toolchain gap in this product is
not missing libraries. It is unused ones.** Installing more animation
capability would have added weight against a shelf that is already full.

### 1.1 Why they were not adopted in this phase either

Reanimated stayed unused on purpose, and this is a decision, not an
omission. Phase 10D established `Button` on `Pressable`'s own `pressed`
state rather than a Reanimated shared value, because the React Compiler's
`react-hooks/immutability` rule rejects `scale.value = withSpring(...)`
outright. The options were to suppress a correctness lint rule across
every animated component, or to use the platform primitive that needs no
suppression. The platform primitive won.

Adopting Reanimated properly means resolving that conflict deliberately —
a decision with a real cost, and one that belongs to a phase whose scope
is animation, not to a phase whose agreed scope is "polish what already
exists". These four packages remain declared and unused. That is now a
**recorded, deliberate state** rather than an accident, and it is the
first thing a future animation phase should read.

## 2. What was installed

Exactly two packages, both to close a gap the Phase 10 audit had already
identified as real: **no query persistence at all**, so every cold start
showed an empty catalog and blocked on the network.

| Package | Version | License | Why |
|---|---|---|---|
| `@tanstack/react-query-persist-client` | `5.102.8` | MIT | The provider that restores a dehydrated cache on launch |
| `@tanstack/query-async-storage-persister` | `5.102.8` | MIT | The AsyncStorage-backed persister it writes through |

Both are first-party TanStack packages, peer-pinned to the
`@tanstack/react-query@5.102.8` already installed, and both use the
AsyncStorage already present for the auth session. No new native module,
no config plugin, no rebuild required.

### 2.1 Measured cost

| Metric | Before | After |
|---|---|---|
| `package-lock.json` entries | 1084 | 1087 |
| New top-level packages | — | 2 (plus 1 transitive: `@tanstack/query-persist-client-core`) |
| New native modules | — | **0** |
| `npm audit` | 13 moderate | 13 moderate |

The three added lockfile entries are the two direct packages plus their
shared core. The `npm audit` count is **unchanged, and identical on
`main`** — these advisories are pre-existing and were not introduced by
this phase.

## 3. What was rejected, and why

Every candidate below was considered against a specific need and rejected
because the need was already met. None were installed.

| Candidate | Verdict | Reason |
|---|---|---|
| **Tamagui** | Rejected | It is a design-system-and-compiler in one. Phase 10D already built the token layer and primitives it would replace, and adopting it would mean discarding `@craavee/tokens` — the single source that Tailwind v3 (native), Tailwind v4 (web) and plain TypeScript all read. A second token vocabulary is the exact problem 10D removed. |
| **gluestack-ui** | Rejected | Same category, same objection. Its value is the component library; the product's components are already built and already token-driven. |
| **react-native-paper** | Rejected | Material Design. The product's design language is explicitly not Material, and Paper's theming would sit alongside the tokens rather than consume them. |
| **@shopify/react-native-skia** | Rejected | A GPU canvas for custom rendering. Nothing in the customer experience draws anything Skia is needed for — the screens are cards, lists, text and a status pill. It is a large native dependency bought for no call site, which is precisely the failure mode §1 documents. |
| **Additional animation libraries** | Rejected | Four are already installed and unused. See §1. |
| **A separate icon library** | Rejected | `@expo/vector-icons` ships with Expo and is already in use. |

The rejection standard applied throughout: **a package must close a gap
that the current stack cannot close.** "It would be nicer" was not
sufficient, because every dependency is permanent weight in a native
binary and a future upgrade obligation.

## 4. Verification that the installs are safe

The two packages were not accepted on their reputation. The risk they
introduce is specific — writing cached server state to disk — and it is
tested:

- **5 unit tests** in `apps/customer-runner/lib/query/__tests__/persist.test.ts`
  assert that `catalog` persists and that `orders`, `payments`, `profile`
  and `addresses` never do; that an unknown key defaults to
  non-persistent; that failed and pending queries are not written; and
  that a malformed query key is refused rather than coerced.
- The allowlist is a **whitelist, not a blacklist**, so a query added in
  a future phase is non-persistent until someone decides otherwise. See
  §4 of the customer-experience checkpoint for why that direction matters
  in this product specifically.

## 5. Regression after installation

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 2 warnings (**pre-existing, byte-identical on `main`**, in `packages/ui` web components untouched by 10E) |
| `npm test` (unit) | **58 / 58** (was 52 after 10D; +5 persistence, +1 token alias) |
| `npm run functions:check` | exit 0 |
| `npm run functions:test` (gateway) | 9 passed, 0 failed |
| `npm run db:test` (pgTAP) | **596 assertions, 19 files, all green** |
| `npm run test:integration` | **223 / 223**, 0 failed, 0 skipped |
| `npm run build` | 2 apps compiled |
| Backend files changed | **0** (`git diff --name-only main...HEAD -- supabase`) |

### 5.1 A test-ordering hazard found while running these

Running `db:test` **immediately after** `test:integration` fails —
`11_order_creation_test.sql` reports 56 psql errors. This is not a
regression and not a product defect: the integration suite mutates the
local database, and the pgTAP fixtures assume a freshly reset schema.
`supabase db reset --local` before `db:test` returns it to all-green,
which was confirmed twice.

Worth recording because the failure looks alarming and is purely an
ordering artefact of running both suites back-to-back locally. CI runs
them in separate jobs against separate databases and never hits it.

---

## 5.2 Correction (2026-09-05) — Android needed no new tooling either

Physical-device validation added one correction to this document's picture
of the toolchain, and it removes a dependency rather than adding one.

**EAS is not required to run Craavee on Android.** `npx expo run:android`
builds and installs a local development build; `eas.json` still does not
exist and was not created. The earlier "Android is BLOCKED on EAS" reading
conflated *Expo Go cannot run this app* (true) with *only EAS can produce a
development build* (false).

EAS remains genuinely required for **push tokens** —
`getExpoPushTokenAsync()` cannot mint one without `extra.eas.projectId` —
and for TestFlight/Play distribution. Those are separate from running and
testing the app on a handset, and remain out of this PR.

**The one real toolchain requirement is JDK 17**, and it was already
documented and already installed (`openjdk@17`, keg-only, Homebrew).
React Native 0.86 fails on JDK 25 at
`:react-native-worklets:configureCMakeDebug` because of JDK 24+ restricted
native access. No host software was installed for this phase.

**Net dependency change for Android validation: zero.** No package was
added, no native module introduced, no Expo or React Native version
changed.

## 6. Conclusion

The toolchain audit's real output was a **negative result**, and it is the
useful one: this product did not need new frontend libraries. It needed
two small first-party packages to close a measured gap, and it needed
someone to notice that four animation libraries had been carried as
dependencies without ever being imported.

Net change: **2 direct packages, 0 native modules, 0 new advisories.**
