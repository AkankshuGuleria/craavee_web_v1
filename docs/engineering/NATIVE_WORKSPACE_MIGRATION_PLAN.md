# Native Workspace Migration Plan

> **STATUS: EXECUTED — 2026-08-31.** Option A was approved and carried out.
> The working tree now lives at `~/Craavee/craavee_web_v1` on internal APFS;
> the old tree on the T7 was removed after validation. Both root causes are
> confirmed dead: the iOS `EXConstants` script phase runs, the Gradle ASM
> transform passes, and zero AppleDouble sidecars appeared at any stage.
> Outcomes, measurements and problems found are in
> `WORKSPACE_MIGRATION_REPORT.md`. This document is kept as the record of
> the analysis that led to the decision — its predictions are assessed below.

Analysis of how to make `apps/customer-runner` fully buildable on the iOS
Simulator and Android Emulator. **Analysis only — nothing was moved,
copied, linked, deleted or reformatted.**

Date: 2026-08-31. Companion: `NATIVE_APP_READINESS_REPORT.md`.

---

## 1. Current layout

| | |
| --- | --- |
| Working tree | `/Volumes/T7 Shield/Craavee/craavee_web_v1` — **exFAT**, 128 KB blocks, path **contains a space** |
| Git object DB | `/Users/soumyadebtripathy/.craavee-git/craavee_web_v1.git` — **APFS**, 4.2 MB |
| `.git` | a pointer file, not a directory (`gitdir: …`) |
| Remote | `AkankshuGuleria/craavee_web_v1` |
| Branch at time of writing | `fix/native-app-readiness`, clean, 0 unpushed |

The Git database is already off exFAT — a deliberate earlier decision
(`PHASE_0_REPOSITORY_AUDIT.md`) that has worked well and is **not** in
question here.

## 2. Storage measurements

The critical distinction is **apparent** size (actual bytes) versus
**allocated** size on exFAT, where a 128 KB block means every small file
costs at least 128 KB.

| Component | Apparent | Allocated on exFAT | Files |
| --- | --- | --- | --- |
| **Whole repository** | **3.92 GB** | **18 GB** | 94,286 |
| `node_modules` (root) | 0.86 GB | 10 GB | 68,964 |
| `apps/` | 3.05 GB | 7.5 GB | 24,527 |
| ├ `customer-runner/ios` *(generated)* | 2.87 GB | 7.2 GB | 23,439 |
| ├ `store/.next` + `console/.next` *(generated)* | 0.15 GB | 244 MB | 660 |
| `packages/`, `supabase/`, `docs/`, `scripts/` | < 0.02 GB | ~110 MB | 765 |

### The number that reframes everything

```
git-tracked source:  268 files,  2.6 MB
```

**The entire authoritative payload of this repository is 2.6 MB.** The
other 3.9 GB — and the 18 GB it occupies on exFAT — is `node_modules`,
`ios/`, and `.next/`: all regenerable, none of it tracked.

Free space, re-measured:

| | |
| --- | --- |
| Internal | **35 GiB free** of 228 GiB |
| T7 Shield | 699 GiB free of 931 GiB |

Note the internal figure is **35 GiB, not the ~59 GiB** quoted in the
brief. Today's native builds consumed ~24 GiB: `CoreSimulator` 6.1 GB,
Android SDK 5.9 GB, Xcode 3.5 GB, `.android` AVD 1.7 GB, DerivedData
1.8 GB, CocoaPods cache 856 MB, Gradle 698 MB.

## 3. Cause of the native failures

Two independent defects, both properties of *where the repository lives*.
Neither is fixable in the codebase.

**A. The space in `/Volumes/T7 Shield/`.** The CocoaPods script phase
`expo-constants` generates runs:

```sh
bash -l -c "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"
```

`bash -c` re-splits the string it receives, so a path with a space becomes
two words. Proven directly:

```
bash -l -c "$VAR"        →  bash: /tmp/spaced: No such file or directory
bash -l -c "\"$VAR\""    →  script ran OK
```

Not the first time: `scripts/run-db-tests.sh` already documents `pg_prove`
failing on the same space.

**B. exFAT AppleDouble sidecars.** exFAT cannot store macOS extended
attributes inline, so the OS writes a binary `._name` companion beside
every file it touches. These broke **four** layers: Metro (parsed
`._verify.tsx` as TypeScript), CocoaPods (globbed `._…podspec`), CocoaPods
again (`._Craavee.xcodeproj` shadowed the real project), and Gradle (ASM
`IllegalArgumentException` on `._*` in class directories).

**Cleaning beforehand cannot fix this.** The files are recreated *while the
build runs*: after cleaning to zero and starting a Gradle build, **228 had
reappeared** by the time it failed.

### Both causes vanish on an APFS path without a space — verified

```
$HOME = /Users/soumyadebtripathy          → no space
APFS xattr test: sidecar created?  NO — xattrs stored inline
```

That second line was tested directly on this machine: writing an extended
attribute to a file on APFS creates **no** `._` companion.

## 4. Option A — move the whole repository to internal APFS

Working tree at e.g. `~/Craavee/craavee_web_v1`; Git database stays where
it is (or becomes a normal in-tree `.git`).

| | |
| --- | --- |
| **Correctness** | Both root causes eliminated at once. |
| **Metro** | Unchanged — `metro.config.js` derives paths from `__dirname`. The `blockList` for sidecars becomes redundant but harmless. |
| **Git** | One working tree, one history, remote unchanged. |
| **Workspace resolution** | Unchanged; npm workspaces behave identically. |
| **Disk** | **~4 GB apparent** on APFS, plus build output. Currently occupies 18 GB on exFAT, so this is a *reduction*, and it frees 18 GB on the T7. |
| **Synchronisation** | None required. |
| **Risk** | Low. The move is a copy-verify-remove of 2.6 MB of tracked source plus regenerable directories that can simply be re-created. |
| **Maintenance** | None. |

## 5. Option B — move only the native workspace

Move `apps/customer-runner` (plus whatever it needs) to APFS, leave the
rest on the T7.

| | |
| --- | --- |
| **Correctness** | Fails. |
| **Workspace resolution** | **This is the blocker.** `apps/customer-runner` is an npm *workspace member*; its dependencies are hoisted to the repo root and it imports `@craavee/types`, `@craavee/validation` and `@craavee/api-contracts` through workspace symlinks. Detaching it means either a second `package.json` with its own dependency tree — a second, divergent dependency graph — or a hand-assembled partial `node_modules`, which §7 of the brief explicitly rules out. |
| **Git** | Would split one repository across two filesystems, or leave the moved copy untracked. |
| **Disk** | Smallest on paper (~0.9 GB), but only by excluding things the build genuinely needs. |
| **Risk** | High — silent version skew between the two dependency graphs. |

**Rejected.** It saves ~3 GB relative to Option A and costs correctness.

## 6. Option C — keep source on T7, add an APFS build workspace

A second checkout on APFS via `git worktree` or a clone, built from there.

| | |
| --- | --- |
| **Correctness** | Works for builds. |
| **Git** | `git worktree add` is the honest form: one object database, one history, one remote — no untracked duplicate. |
| **Source of truth** | **Preserved technically, broken in practice.** Git refuses to check out the same branch in two worktrees, so the T7 tree and the APFS tree are permanently on *different branches*. You would edit in one and build the other, and they would never hold the same working state. Every native verification would need a commit-and-switch cycle. |
| **Disk** | ~4 GB on APFS **in addition to** 18 GB still on the T7. |
| **Risk** | Moderate — the constant question of "which tree am I in?" |
| **Maintenance** | Ongoing: two trees, two `node_modules`, two build caches. |

**Rejected** unless the repository must stay on the T7 for a reason not
yet stated. It is strictly worse than Option A on every axis except
leaving the T7 copy in place.

## 7. Recommendation — Option A

**Move the whole repository to `~/Craavee/craavee_web_v1`.**

It is the only option that satisfies all six goals in the brief:

1. **Native build reliability** — removes both root causes, verified.
2. **One source of truth** — one working tree, no synchronisation.
3. **Low maintenance** — nothing ongoing.
4. **Safe Git history** — the object database already lives on APFS and
   need not be touched; the remote and all branches are unchanged.
5. **Minimal internal storage** — counter-intuitively the *cheapest*
   option, because APFS's 4 KB blocks store the same content in ~4 GB that
   exFAT spends 18 GB on.
6. **No impact on AdityaNet or Cartograph** — they are not touched, and
   they gain 18 GB of headroom.

The intuition that "the big disk should hold the big repository" does not
survive measurement: this repository is 2.6 MB of source. What makes it
look large is exFAT block amplification and regenerable build output.

## 8. Exact storage impact

| | |
| --- | --- |
| Internal free now | **35 GiB** |
| Source + `node_modules` after a clean `npm ci` on APFS | ~1.0 GB |
| iOS `ios/` + Pods after a build | ~3.0 GB |
| Android `android/` + project Gradle caches | ~1.5 GB |
| `.next` build output | ~0.2 GB |
| **Total new internal usage** | **~6 GB** |
| **Internal free after migration** | **~29 GiB** |
| T7 space reclaimed | **18 GB** |

Comfortably inside the 20 GiB safety margin. DerivedData will grow with
use; `NATIVE_DEV_ENVIRONMENT_SETUP_REPORT.md` §11 lists the cleanup
commands.

## 9. Git strategy

**Keep the current separation.** The object database stays at
`~/.craavee-git/craavee_web_v1.git`; only the working tree moves. This is
the smallest possible change to a Git arrangement that is working, and it
keeps the authoritative history untouched throughout.

Mechanically: `git worktree` metadata records the working-tree path, so
the move is a `git worktree move`-style repoint rather than a copy of Git
internals. The remote, all nine branches, and every open PR are unaffected.

Once both live on APFS the separation is no longer strictly necessary, but
collapsing it into a normal in-tree `.git` is a second, independent change
that should not ride along with the migration.

## 10. Source-of-truth strategy

There is exactly one working tree before the migration and exactly one
after. No copy is left behind on the T7 once the move is verified — a
stale second copy is precisely the failure mode §5 of the brief warns
about, and it is the reason Option C was rejected.

`node_modules` is **not** copied. It is deleted and recreated with
`npm ci` from the committed `package-lock.json`, so the dependency graph
is npm's rather than a filesystem artefact.

## 11. Migration steps (for approval — not executed)

1. **Verify clean state**: `git status` clean, all branches pushed, PR #9
   and PR #8 recorded.
2. **Create the destination**: `mkdir -p ~/Craavee`.
3. **Copy tracked source only**, preserving the tree — do not copy
   `node_modules`, `ios/`, `android/`, `.next/`, or `._*` files.
4. **Repoint Git** so the working tree at the new path is the registered
   one, and confirm `git status` is clean and `git log` intact there.
5. **`npm ci`** at the new location — regenerates `node_modules` from the
   lockfile on APFS.
6. **Run the validation sequence** in §13.
7. **Only after validation passes**, remove the old working tree from the
   T7. Not before.
8. Update `LOCAL_DEVELOPMENT_ENVIRONMENT.md` and
   `PHASE_6_LOCAL_VALIDATION_PLAN.md` with the new path.

The old tree stays in place until step 7, so every step before it is
reversible by simply continuing to use the T7 copy.

## 12. Rollback

Before step 7 the T7 working tree is untouched and fully functional —
rollback is "keep using it" plus repointing Git back.

After step 7, rollback is a fresh `git clone` of the remote to the T7 and
an `npm ci`. Nothing is lost either way, because the authoritative content
is 2.6 MB of committed source and the object database is never moved.

**The T7 is never reformatted, repartitioned or bulk-deleted.** Only the
`craavee_web_v1` working tree is removed, and only after validation.

## 13. Validation sequence (post-migration)

Environment first:

```bash
bash scripts/check-native-dev-env.sh
git status && git log --oneline -3     # history intact at the new path
npm ci
```

Baseline — must match exactly:

```bash
npm run typecheck && npm run lint && npm run test    # 44/44
npm run build                                        # Store + Console
npm run db:reset && npm run db:test                  # 371 assertions
npm run functions:check && npm run functions:test    # 8/8
```

**iOS** — each step must pass, in order:

| # | Step | Pass condition |
| --- | --- | --- |
| 1 | `npx expo start` | Metro serves; iOS bundle returns **HTTP 200** |
| 2 | `npx expo prebuild -p ios` | `ios/` generated |
| 3 | `pod install` | completes with **no** podspec or xcodeproj-selection error |
| 4 | `npx expo run:ios` | **the EXConstants script phase passes** — the specific failure this migration targets |
| 5 | simulator | `Craavee_iPhone17` boots |
| 6 | app launch | Craavee installs and the root screen renders |
| 7 | interaction | navigation works; reload works |

**Android** — same shape:

| # | Step | Pass condition |
| --- | --- | --- |
| 1 | `npx expo start` | Android bundle returns **HTTP 200** |
| 2 | `npx expo prebuild -p android` | `android/` generated |
| 3 | `npx expo run:android` | **Gradle's instrumentation transform passes** — no `IllegalArgumentException` |
| 4 | emulator | `Craavee_Pixel7_API36` boots |
| 5 | app launch | Craavee installs and the root screen renders |
| 6 | interaction | navigation works; reload works |

**Sidecar check**, the direct proof the migration worked:

```bash
find . -name '._*' | wc -l     # expected: 0, and still 0 after a full build
```

If that stays at zero through a native build, root cause B is gone. If
step 4 (iOS) passes, root cause A is gone.

Run one platform at a time — 16 GB RAM, and swap reached 6.1 of 7.2 GB
during the last native build.

## 14. What this does not change

`scripts/clean-apple-sidecars.sh` and the Metro `blockList` become
redundant but should be **kept**: the repository may be cloned onto an
exFAT volume again, and both are harmless on APFS.

The two standing project items are untouched by this plan — Razorpay has
no live sandbox run, and the ACL/default-privilege hardening
(`CI_CHECKPOINT_REPORT.md` §8.1) is still outstanding.


---

## 15. How the analysis held up

Added after execution.

| Prediction | Outcome |
| --- | --- |
| Both root causes vanish on a space-free APFS path | **Correct.** iOS `EXConstants.bundle` was produced; 0 sidecars at every stage including mid-build. |
| Option A costs ~6 GB internal | **Correct.** Working tree 2.7 GB + ios 1.2 GB + node_modules 1.3 GB. |
| Internal free stays above the 20 GiB margin | **Wrong — it breached.** Free hit **19 GiB** mid-build. Not the workspace's fault: the Android toolchain cost far more than predicted (NDK 2.4 GB, `~/.gradle` 3.8 GB), and the default 4-ABI native build multiplied it. Recovered to 23 GiB by clearing regenerable caches and restricting to `arm64-v8a`. |
| Moving frees ~18 GB on the T7 | **Close.** 17 GiB reclaimed (699 → 716 GiB). |
| The Git move needs no reconfiguration | **Correct**, and for a better reason than stated: `core.worktree` is unset, so Git infers the tree from the `.git` pointer's own location. |
| Migration risk is low | **Correct for the migration itself** — 267/267 files byte-identical, first try. The time went to two *pre-existing* environment defects (an empty `build-tools/35.0.0`, and an OOM-killed Kotlin daemon), neither predicted. |

The analysis's central claim — that this repository is 2.6 MB of tracked
source wearing 18 GB of exFAT block overhead, and that moving it is
therefore cheap and reversible — held exactly.

What the analysis **underweighted** was the *build* footprint, as opposed
to the *workspace* footprint. A 16 GB machine running Docker, an emulator
and Gradle simultaneously is the real constraint, not disk.
