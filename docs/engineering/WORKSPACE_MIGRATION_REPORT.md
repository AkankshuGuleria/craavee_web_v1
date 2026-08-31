# Workspace Migration Report

Record of moving the Craavee working tree off the exFAT external SSD onto
internal APFS, executed against the plan approved in PR #10
(`NATIVE_WORKSPACE_MIGRATION_PLAN.md`).

| | |
| --- | --- |
| Old path | `/Volumes/T7 Shield/Craavee/craavee_web_v1` — exFAT, 128 KB blocks, **space in path** |
| New path | `~/Craavee/craavee_web_v1` — APFS, 4 KB blocks, **no space** |
| Git object DB | `~/.craavee-git/craavee_web_v1.git` — **not moved, not modified** |
| Branch at migration | `docs/native-workspace-migration` @ `0153f9e` |
| T7 filesystem | still **ExFAT** — not reformatted, not repartitioned |

---

## 1. Why the git move was a no-op

The repository is a plain non-bare repo whose `.git` is a *pointer file*
containing an absolute path to an external object database:

```
$ cat .git
gitdir: /Users/soumyadebtripathy/.craavee-git/craavee_web_v1.git

$ git config --get core.worktree      # (empty — not set)
$ ls ~/.craavee-git/craavee_web_v1.git/worktrees
No such file or directory              # not a `git worktree` linked setup
```

Because `core.worktree` is **unset**, Git infers the working tree from the
location of the `.git` file itself. The gitdir path is absolute and did not
change. So moving the tree required **zero** Git reconfiguration — no
`worktree move`, no re-clone, no config edit, no object-database copy.

Preconditions verified before anything was touched:

| Check | Result |
| --- | --- |
| Working tree clean | 0 modified, 0 untracked-not-ignored |
| All branches pushed | 11/11 branches, no ahead/behind on any |
| Stashes | 0 |
| In-progress merge/rebase/bisect | none |
| Target `~/Craavee` exists | no (created fresh) |
| Target filesystem | APFS (`/dev/disk3s5`) |
| Space in `$HOME` | none |
| Internal free | 35 GiB |

## 2. What was copied, and what was not

Only two things travelled: the **267 git-tracked files** (2.62 MB) and
`apps/customer-runner/.env.local` (ignored, but holds the local Expo
`EXPO_PUBLIC_SUPABASE_URL` / anon key — both public values, no secrets).

The copy was driven off `git ls-files -z`, so `node_modules`, `ios/`,
`android/`, `.next/`, `.expo/`, `.gradle/`, `supabase/.temp` and every
AppleDouble `._*` file were excluded **by construction** rather than by an
exclude list that could miss something.

```
rsync -rlt --from0 --files-from=<(git ls-files -z) "$SRC/" "$DST/"
```

Deliberately *not* copied and regenerated instead: `node_modules` (via
`npm ci` from the committed lockfile), `ios/` and `android/` (via
`expo prebuild`), Pods, `.next`, DerivedData, Gradle caches.

## 3. Verification that nothing was lost

Three independent checks, all run before the old tree was disabled.

| Check | Old | New | Verdict |
| --- | --- | --- | --- |
| Tracked file count | 267 | 267 | equal |
| `git ls-files -s` (mode + blob SHA + path) | 267 entries | 267 entries | **identical** |
| Independent SHA-256 of every tracked file | 267 hashes | 267 hashes | **identical** |
| `git status --porcelain` in new tree | — | 0 lines | clean |
| `git diff HEAD` in new tree | — | empty | clean |

The `git status` result is the strongest of these. Every file's mtime
changed during the copy, so Git could not use its stat cache — it re-hashed
all 267 working-tree files against the index and found no difference.

## 4. Two things that nearly broke, and did not

**The executable bit was load-bearing and is not tracked.**
`package.json` runs `"db:test": "scripts/run-db-tests.sh"` — invoked
*directly*, not via `bash`. exFAT synthesised mode `700` for every file, so
it worked there by accident. But `core.filemode = false` (set because exFAT
cannot store modes), so the scripts are committed as `100644` and Git
neither records nor restores the bit. A plain copy landed them
non-executable on APFS and `npm run db:test` would have failed with
`EACCES`. Restored explicitly with `chmod +x scripts/*.sh`.

This is a **latent defect, not a migration artefact**: a fresh
`git clone` onto any APFS disk has the same problem. Recommended follow-up
(not applied here, to avoid touching PR #9's branch):

```
git update-index --chmod=+x scripts/run-db-tests.sh scripts/serve-functions.sh
```

**CocoaPods needs a UTF-8 locale.** `pod install` aborted with
`Encoding::CompatibilityError: Unicode Normalization not appropriate for
ASCII-8BIT` because the shell had no `LANG`. Fixed with
`LANG=en_US.UTF-8`. Note this **conflicts with the `LC_ALL=C` workaround**
recorded for a `sed` failure elsewhere in the toolchain — the two cannot
both be set globally. Neither is related to the migration; both are
shell-environment issues.

## 5. Storage impact — measured, not estimated

The plan predicted this move would *reduce* total disk usage. It did,
because exFAT's 128 KB allocation block charges a minimum 128 KB per file
across a tree of ~94,000 mostly tiny files.

| | exFAT (old) | APFS (new) |
| --- | --- | --- |
| Whole working tree | **18 GB allocated** (3.92 GB apparent) | **2.7 GB** |
| `node_modules` | 10 GB allocated (0.86 GB apparent) | **1.3 GB** |
| `apps/customer-runner/ios` | 7.2 GB allocated (2.87 GB apparent) | **1.2 GB** |

Internal free space over the migration:

| Point | Free |
| --- | --- |
| Before migration | 35 GiB |
| After `npm ci` | 34 GiB |
| After iOS build + launch | 30 GiB |

Other consumers on internal: DerivedData 3.8 GB, `~/.gradle` 720 MB,
Android SDK 5.9 GB, CoreSimulator 6.1 GB, Xcode 3.5 GB.

**The T7 was not reformatted or repartitioned** and remains ExFAT
(`/dev/disk4s1`, `exfat, local, nodev, nosuid, noowners, noatime, fskit`).
Removing the old working tree returns ~18 GB to it.

## 6. Speed, as a side effect

`npm ci` — the same lockfile, the same 973 packages:

| | |
| --- | --- |
| exFAT | minutes |
| **APFS** | **10 seconds** |

Not a goal of the migration, but a fair illustration of what 128 KB blocks
cost on a tree of 69,000 small files.

## 7. Source of truth

There was one working tree before and there is one working tree after.

Immediately after the content verification in §3, the old tree's `.git`
pointer was renamed:

```
/Volumes/T7 Shield/Craavee/craavee_web_v1/.git
  -> .git.MIGRATED-DO-NOT-USE
```

`git rev-parse` inside the old directory now returns
`fatal: not a git repository`. That makes the old copy **inert as a
repository** — nobody can commit to it, and no tooling will pick it up —
while its *files* remain on disk as a rollback source. This is what keeps
"one source of truth" and "keep a rollback path" from contradicting each
other.

The old tree is removed once validation passes (§10). Reversing the rename
is the only thing needed to restore it before that point.

## 8. Git safety

Nothing about the repository's history or remote configuration was touched.

| | Before | After |
| --- | --- | --- |
| `origin` | `https://github.com/AkankshuGuleria/craavee_web_v1.git` | unchanged |
| HEAD | `0153f9e` | `0153f9e` |
| Branch | `docs/native-workspace-migration` | same |
| Local branches | 11 | 11 |
| Object database | `~/.craavee-git/craavee_web_v1.git` | **never moved, never copied** |
| Open PRs | #8, #9, #10 | unchanged, none merged |

No rebase, no force push, no branch deletion, no change to `main`.

## 9. Permissions normalised

exFAT synthesised mode `700` on everything. After the copy the tree had an
inconsistent mix (`711` on files that came through the copy, `644` on files
Git wrote during a branch switch). Normalised to the conventional
`644` files / `755` directories, with `755` on `scripts/*.sh`.

`git status` stayed clean throughout, because `core.filemode = false` means
Git does not compare modes. That is also precisely why the exec bit had to
be restored by hand (§4).

## 10. Validation results

Every check below was run from `~/Craavee/craavee_web_v1`.

### Baseline regression — matches pre-migration exactly

| Suite | Result | Baseline |
| --- | --- | --- |
| `npm run typecheck` | pass | pass |
| `npm run lint` | 0 errors, 2 pre-existing warnings | same |
| `npm test` | **44 pass, 0 fail** | 44 |
| `npm run build` (Store + Console) | pass | pass |
| `npm run db:test` (pgTAP) | **371/371** | 371 |
| `npm run functions:check` | pass | pass |
| `npm run functions:test` (gateway) | **8/8** | 8 |
| `npm run test:integration` | **100 pass, 0 fail** | 100 |

`npx expo-doctor` → **21/21**.

Metro bundles, all `HTTP 200`, unchanged from the PR #9 baseline:

| Platform | Size |
| --- | --- |
| web | 5.6 MB |
| ios | 9.5 MB |
| android | 9.8 MB |

### iOS — the failure this migration targeted is gone

| # | Step | Result |
| --- | --- | --- |
| 1 | `npx expo prebuild -p ios` | pass |
| 2 | `pod install` | pass — `Pods/` + `Craavee.xcworkspace` |
| 3 | **EXConstants script phase** | **pass** — produced `EXConstants.bundle` |
| 4 | `xcodebuild` | **Build Succeeded, 0 errors** |
| 5 | Simulator `Craavee_iPhone17` | boots |
| 6 | App launch | `com.craavee.app` installs and opens |
| 7 | UI renders | styled phone sign-in screen |
| 8 | Navigation | router + params + post-auth redirect |
| 9 | Live data | signed in; catalog from Supabase through RLS |
| 10 | State | cart stepper, "1 item · ₹45.00" bar |

Step 3 is the whole point: `expo-constants` runs
`bash -l -c "$PODS_TARGET_SRCROOT/…"`, which re-splits on the space in
`/Volumes/T7 Shield/`. On APFS under `$HOME` there is no space, and the
phase completed.

### Android — the ASM failure is gone

| # | Step | Result |
| --- | --- | --- |
| 1 | `npx expo prebuild -p android` | pass |
| 2 | `./gradlew :app:assembleDebug` | **BUILD SUCCESSFUL in 1m 13s** |
| 3 | **Gradle instrumentation / ASM transform** | **pass — 0 `IllegalArgumentException`** |
| 4 | APK | `app-debug.apk`, 79 MB |
| 5 | Emulator `Craavee_Pixel7_API36` | boots (Android 16) |
| 6 | `adb install` | Success |
| 7 | App launch | runs |
| 8 | UI renders | styled phone sign-in screen |
| 9 | Navigation | router + params + post-auth redirect |
| 10 | Live data + state | catalog renders; cart stepper works |

Android reaches host services through `adb reverse tcp:8081` (Metro) and
`adb reverse tcp:54321` (Supabase), because `127.0.0.1` inside an emulator
is the emulator itself.

### The sidecar proof

`find . -name '._*' | wc -l` returned **0** at every stage: after the copy,
after `npm ci`, after both prebuilds, *during* the iOS build, *during* the
Gradle build, and after the Android build completed.

On the T7, 228 sidecars regenerated **during a single Gradle run** after
being cleaned to zero. That failure mode no longer exists.

## 11. Problems found during validation — none caused by the migration

Recorded because each cost real time and will recur otherwise.

**`build-tools/35.0.0` was an empty directory.** A leftover from an aborted
install during the earlier toolchain setup — the directory existed with
**zero files and no `package.xml`**, so AGP correctly considered the package
missing and tried to re-download it. AGP's legacy `DownloadCache` has no
connect timeout, so the build wedged silently in
`DownloadCache.openUrl → HttpClient.openServer`, twice, with no error
output. Repaired with:

```
rm -rf "$ANDROID_HOME/build-tools/35.0.0"
sdkmanager --install "build-tools;35.0.0"
```

**The Kotlin compile daemon was OOM-killed.** Gradle then waited forever on
a dead process (`DefaultBuildControllers.awaitCompletion`) with no error.
Root cause was memory, not Gradle: Docker's 11 Supabase containers +
Android emulator + Gradle + two Kotlin daemons on a 16 GB machine, with
swap at 4.2 GB of 5.1 GB and only ~104 MB of pages free. Resolved by
stopping the Supabase containers and the iOS simulator for the duration of
the build, and constraining Gradle in the **generated, untracked**
`android/gradle.properties`:

```
org.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m
org.gradle.workers.max=2
kotlin.compiler.execution.strategy=in-process
org.gradle.parallel=false
reactNativeArchitectures=arm64-v8a
```

The last line matters most: the default builds **four ABIs**, but the only
installed system image is `arm64-v8a`, so three quarters of the native
build was waste. `assembleDebug` went from stalling for over an hour to
**1m 13s**. These settings are local-machine tuning in a file that
`expo prebuild` regenerates; a release build must restore all ABIs.

**CocoaPods needs a UTF-8 locale** (§4).

**Two app-level defects, unrelated to the workspace** — logged here only
because device testing is what exposed them:

1. The phone screen prefixes `91`, sending `919990000001`, but the seeded
   users and every `GOTRUE_SMS_TEST_OTP` entry are the bare
   `9990000001`. Sign-in only succeeds with the bare number. The
   integration suite cannot catch this because it calls `verifyOtp`
   directly with the bare constant and never exercises the screen that
   adds the prefix.
2. `signInWithOtp` ("Send code") cannot work against the local stack at
   all — `GOTRUE_EXTERNAL_PHONE_ENABLED=false`, reproducible with `curl`
   and no app involved. Local sign-in must jump straight to `verifyOtp`.

Neither is a migration regression; both are worth their own fix.

## 12. Disk during validation

| Point | Free |
| --- | --- |
| Before migration | 35 GiB |
| After `npm ci` | 34 GiB |
| After iOS build + launch | 30 GiB |
| During Android NDK install | 27 GiB |
| Mid Android build (4-ABI) | **19 GiB — below the 20 GiB floor** |
| After reclaiming caches | 23 GiB |

At 19 GiB the floor was breached, so regenerable caches were cleared:
Xcode `DerivedData` (3.8 GB, iOS already validated), the npm cache
(1.2 GB), and the Homebrew cache (0.8 GB). Restricting the build to
`arm64-v8a` removed the pressure at source.

The Android toolchain turned out to cost far more than the workspace: NDK
27.1 alone is **2.4 GB** and `~/.gradle` grew to **3.8 GB**. The migrated
working tree is 2.7 GB — smaller than either.

## 13. Old copy disposition

The old working tree at `/Volumes/T7 Shield/Craavee/craavee_web_v1` is
retained until every validation in §11 passes, with its `.git` renamed so
it cannot act as a repository (§7). It is then removed — and **only** it.

Explicitly not touched, before or after:

```
/Volumes/T7 Shield/Projects/AI/AdityaNet
/Volumes/T7 Shield/Cartograph
/Volumes/T7 Shield/Cartograph.app
/Volumes/T7 Shield/Android
/Volumes/T7 Shield/Projects
... and every other sibling
```

The T7 was verified as still ExFAT and structurally unchanged after the
migration.

## 14. Rollback

Before the old tree is deleted, rollback is:

```
mv "/Volumes/T7 Shield/Craavee/craavee_web_v1/.git.MIGRATED-DO-NOT-USE" \
   "/Volumes/T7 Shield/Craavee/craavee_web_v1/.git"
```

That is the entire procedure — the object database was never moved, so the
old tree becomes authoritative again the instant its pointer is restored.

After deletion, rollback is a fresh `git clone` plus `npm ci`. Nothing is
lost either way: the authoritative content is 2.62 MB of committed source,
every branch is pushed to `origin`, and `~/.craavee-git` was never modified.

## 15. Final state

The old working tree was removed **after** every check in §10 passed.

| | |
| --- | --- |
| Working tree | `~/Craavee/craavee_web_v1` — APFS, 2.7 GB |
| Git object DB | `~/.craavee-git/craavee_web_v1.git` — unchanged throughout |
| T7 free | 699 GiB → **716 GiB** (+17 GiB reclaimed) |
| T7 filesystem | ExFAT, unchanged |
| `/Volumes/T7 Shield/Craavee/` | now an empty directory |
| AdityaNet | `Projects/AI/AdityaNet`, 176 GB, untouched |
| Cartograph | untouched |
| Internal free | 23 GiB |

### One difference worth recording

`load-tests/k6` existed on the T7 as an **empty directory scaffold** — two
directories, zero files. Git cannot track empty directories, so it did not
travel with the tracked-file copy. Nothing was lost: a fresh `git clone` on
any machine produces the same result. It was recreated by hand in the new
tree. If it is meant to persist, it needs a `.gitkeep`.

Everything else in the old tree was either tracked (and verified identical
in §3), regenerable, or an AppleDouble sidecar.

### Follow-ups this migration did not do

- `git update-index --chmod=+x scripts/*.sh` — the exec bit is load-bearing
  for `npm run db:test` but is committed as `100644` (§4).
- `expo prebuild` rewrites `apps/customer-runner/package.json` scripts from
  `expo start --ios` to `expo run:ios`. That rewrite was reverted here to
  keep this PR to documentation, but it is now **correct** — those commands
  work on this machine for the first time, so it is safe to accept.
- The two app-level auth defects in §11.
- The `load-tests/k6` `.gitkeep` above.
