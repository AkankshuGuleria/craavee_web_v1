# Local Development Environment — Audit and Storage Plan

> **Superseded in part, 2026-08-30.** This document was the *pre-install*
> audit. The toolchain has since been installed and verified — see
> **`NATIVE_DEV_ENVIRONMENT_SETUP_REPORT.md`** for the authoritative
> record of what exists on the machine now, and §19 below for what
> changed against the predictions made here.
>
> The filesystem analysis (§4), the placement rules (§9) and the RAM
> budget (§16) all held and remain current.

Read-only audit of this Mac, performed to decide where native iOS and
Android tooling should live before any of it is installed. **Nothing was
installed, moved, deleted, or reconfigured.**

Date: 2026-08-30. Companion: `PHASE_6_LOCAL_VALIDATION_PLAN.md`.

---

## 1. Hardware and storage facts

| Property | Value |
| --- | --- |
| Machine | Apple **M4**, 10 cores |
| RAM | **16 GB** |
| macOS | **26.6.2** (build 25G83) |
| Swap in use | 2.28 GB of 3.0 GB — already under mild pressure |
| System-wide free memory | 43% at audit time |

## 2. Internal disk — the binding constraint

| Property | Value |
| --- | --- |
| Physical | 251 GB NVMe, APFS container 245.1 GB |
| Data volume | 193.7 GB used |
| **Available** | **23 GiB (89% full)** |

**This single number governs everything below.** A current Xcode plus one
iOS simulator runtime is roughly 20–25 GB, and Android Studio plus an SDK
and one system image is another 15–20 GB. Both together do not fit in
23 GiB, and macOS itself needs headroom — an APFS volume driven near full
degrades and can fail writes outright.

## 3. T7 Shield

| Property | Value |
| --- | --- |
| Device | `/dev/disk4s1`, USB, 1.0 TB, fixed media |
| Filesystem | **ExFAT** |
| Mount options | `local, nodev, nosuid, noowners, noatime, fskit` |
| **Allocation block size** | **131,072 bytes (128 KB)** |
| Used / free | 252 GB / **748 GB** |

Contents: `Projects/AI` (AdityaNet) 176 GB, `Cartograph` 21 GB, `Craavee`
20 GB, `Movies` 2.2 GB, a small `Android` folder (12 MB). **None of these
were touched.**

## 4. Filesystem facts that decide the plan

Two findings matter more than the raw free space.

### 4.1 exFAT here supports symlinks — the old assumption is out of date

macOS 26 mounts this volume with the **fskit** exFAT driver, and it
supports symbolic links. Verified against files already on the volume:

```
node_modules/.bin/acorn -> ../acorn/bin/acorn        (lrwx------)
node_modules/@craavee/validation -> ../../packages/validation
```

51 symlinks exist in Craavee's `node_modules` today, including the npm
workspace links, and they resolve. Earlier project notes assumed classic
exFAT limitations; for symlinks specifically, that no longer holds. It
is why `npm ci` works on this volume at all.

### 4.2 The 128 KB allocation block costs ~17× on small files

This is the most consequential number in the audit.

| Craavee `node_modules` | |
| --- | --- |
| Files | **144,741** |
| Actual content | **1.14 GB** |
| Space consumed on the T7 | **19 GB** |

Every file, however small, consumes at least one 128 KB block. 19 GB ÷
144,741 ≈ 131 KB per file — exactly one block each. The T7's 748 GB of
free space is therefore **not** 748 GB for anything shaped like a
dependency tree, a Gradle cache, or an SDK.

This inverts the intuitive plan. "Put the big things on the big disk" is
right for *large* files and wrong for *numerous* ones.

### 4.3 What else exFAT still cannot do

`noowners` and `nosuid` mean no POSIX ownership, no reliable executable
bit, and no setuid. There are no hard links, no extended attributes, no
case sensitivity, and no file-level locking semantics that code signing
or a VM disk image can depend on.

## 5. Xcode status

**Not installed.**

- `xcode-select -p` → `/Library/Developer/CommandLineTools`
- Command Line Tools **26.6.0** present (`/Library/Developer`, 2.2 GB)
- `xcodebuild` unavailable — CLT instance only
- `simctl` unavailable, so **zero simulator runtimes** and no
  `CoreSimulator` directory
- No `~/Library/Developer` at all

Storage it would need: the app is roughly 12–15 GB expanded, plus about
7–9 GB per iOS simulator runtime. **Realistic minimum ≈ 20–25 GB.**

## 6. Android Studio status

**Not installed.**

- No `/Applications/Android Studio.app`
- `ANDROID_HOME` and `ANDROID_SDK_ROOT` both unset
- No `~/Library/Android`, no SDK, no `~/.android/avd`
- `~/.android` exists but is empty (4 KB)
- `~/.gradle` exists and is **2.5 GB** — stale, from unrelated work

JDK present: **Temurin OpenJDK 25.0.1**. Worth flagging — the Android
Gradle Plugin supports JDK 17/21; JDK 25 is likely too new and a
matching JDK will probably be needed alongside it.

Storage it would need: app ≈ 3–4 GB, SDK platform + build tools ≈ 5–8 GB,
and 3–8 GB per emulator system image. **Realistic minimum ≈ 15–20 GB.**

## 7. Cache inventory (internal)

| Path | Size | Note |
| --- | --- | --- |
| `~/Library/Application Support` | **30 GB** | `Claude` alone is 13 GB |
| `~/Library/Caches` | **18 GB** | Spotify 5.3, Google 2.3, Atlas 1.7, Brave 1.6, Playwright 1.5, go-build 1.0 |
| `~/.npm` | **8.3 GB** | npm cache — fully regenerable |
| Docker images | **11.8 GB** | Supabase local stack; 1.16 GB reclaimable |
| `~/Library/pnpm` | 1.6 GB | |
| `~/.gradle` | 2.5 GB | stale |
| `~/.cache` | 2.4 GB | |
| `/Library/Developer` | 2.2 GB | Command Line Tools |
| `~/.expo` | 76 KB | negligible |

**Roughly 20–25 GB is recoverable here without touching anything
irreplaceable** — regenerable caches only. That is the difference between
"Xcode does not fit" and "Xcode fits comfortably".

## 8. Git layout

```
working tree : /Volumes/T7 Shield/Craavee/craavee_web_v1   (exFAT)
git dir      : /Users/soumyadebtripathy/.craavee-git/craavee_web_v1.git   (APFS, 3.6 MB)
```

**Keep exactly as is.** The object database is pack-file heavy and
integrity-critical, and it costs 3.6 MB internally. The separation is
already the correct answer and there is no evidence to revisit it.

## 9. Recommended storage layout

### Must stay on internal APFS — not negotiable

| Item | Why |
| --- | --- |
| **Xcode.app** | Code signing, symlinked frameworks, xattrs, POSIX permissions. Apple does not support it on exFAT and it will not run from there. |
| **iOS simulator runtimes / CoreSimulator** | Managed by `simd`, expects APFS semantics and sparse files. |
| **Xcode DerivedData** | Enormous small-file churn — worst case for a 128 KB block, and on USB. |
| **Android AVD data** | A running VM disk needs POSIX permissions and fast random I/O; a USB exFAT volume is the wrong home for it. |
| **Git object database** | Already there. 3.6 MB. |
| **Android SDK** | Tens of thousands of small files — the 17× amplification applies, and parts rely on symlinks and the executable bit. |

### Safe on the T7 (exFAT)

| Item | Why |
| --- | --- |
| **Craavee source** | Already there and working. |
| **`node_modules`** | Works today (symlinks resolve). Costs 19 GB of a 748 GB volume — wasteful but harmless, and it keeps 1.14 GB off the internal disk. |
| **Emulator system images** *(if internal space is short)* | Large single files, which is exactly what a 128 KB block suits. Acceptable **only** as a fallback; the AVD's own data must stay internal. |
| **Archived build artefacts, `.ipa`/`.apk` outputs, recordings** | Big, sequential, write-once. |
| **AdityaNet, Cartograph** | Untouched. |

### Do not put on the T7

Xcode itself, simulator runtimes, DerivedData, AVD data, Gradle caches,
CocoaPods cache, the npm cache. Every one is either
permission-sensitive, signing-sensitive, or small-file-dense.

## 10. iOS strategy

1. Reclaim internal space **first** (§7) — target 45+ GiB free.
2. Install Xcode from the App Store, then `xcode-select --switch` to it.
3. Install exactly **one** iOS simulator runtime — the current release
   only. Each additional runtime is another ~8 GB.
4. Prefer a **physical iPhone** for routine verification (§12).
5. Cap DerivedData growth; it is the fastest-growing directory on an
   Xcode machine.

## 11. Android strategy

1. Install Android Studio (app on internal).
2. SDK at the default `~/Library/Android/sdk` — **internal**, for the
   small-file and symlink reasons above.
3. Install one platform and one build-tools version, not several.
4. Prefer a **physical Android device** over an emulator (§12). If an
   emulator is required, one arm64 image; consider putting only the
   *system image* on the T7 if internal space is tight, keeping AVD data
   internal.
5. Install a JDK 17 or 21 alongside the existing JDK 25 for Gradle.

## 12. Physical devices — the highest-value recommendation

Given 23 GiB free, physical devices are not a convenience here; they are
the pragmatic primary path. They avoid an ~8 GB simulator runtime and a
3–8 GB system image, and they catch what emulators cannot: real
permission prompts, real keyboards, camera and notification behaviour,
thermal and performance reality.

- **Android** — enable Developer Options and USB debugging, or wireless
  debugging over the LAN. `adb` ships with the SDK platform-tools.
- **iOS** — a free Apple ID supports development signing for a
  personally-owned device. Expo development builds install directly.
  A paid Apple Developer account is needed for TestFlight and App Store
  distribution, not for local device testing.

## 13. Expo / EAS

Unchanged from the project's existing model:

- **Local**: Expo dev server, iOS Simulator, Android Emulator, physical
  devices.
- **Cloud (EAS)**: production builds, signing, distribution, updates.

EAS Build stays the release path. Local native builds are for
verification, not distribution — and EAS also keeps the very large
release toolchain off this disk.

## 14. Ranked options

### Option 1 — best: reclaim internal, both toolchains internal, physical devices primary

Free 20–25 GB of regenerable caches (§7), then install Xcode and Android
Studio internally with one runtime and one system image, and do routine
verification on real devices.

*Performance* excellent (APFS, no USB in the loop). *Storage* fits with
headroom after reclamation. *Compatibility* fully supported. *Reliability*
highest. *Maintenance* low — only periodic DerivedData and cache pruning.

### Option 2 — acceptable: as above, but emulator system images on the T7

Only if internal space stays tight after reclamation. AVD data stays
internal; only the large image files live externally.

*Performance* slower emulator cold start. *Storage* saves 3–8 GB
internally. *Compatibility* workable — large files suit a 128 KB block.
*Reliability* good, with the caveat that the emulator will not start if
the T7 is unmounted. *Maintenance* moderate — one non-default path.

### Option 3 — avoid: Xcode, DerivedData, AVD data, or the SDK on the T7

*Performance* poor. *Storage* actively wasteful — the 17× amplification
means an SDK could consume more space externally than internally.
*Compatibility* broken: Xcode will not run from exFAT, and code signing,
permissions and hard links are unavailable. *Reliability* poor — an
unplugged or re-enumerated USB volume corrupts an in-flight build or a
running VM disk. *Maintenance* high, with symlink mazes to unpick later.

**Reformatting the SSD is not recommended and was not evaluated as an
option.** It is explicitly out of scope, the volume holds 197 GB of other
people's work, and — now that symlinks are known to work — the remaining
exFAT limitations do not affect anything that has to live there.

## 15. Risks

| Risk | Severity | Note |
| --- | --- | --- |
| Internal disk at 89% before any install | **High** | Reclaim first; installing Xcode into 23 GiB would leave the machine near zero. |
| 16 GB RAM with Xcode + Simulator + Android Studio + Emulator + Metro + Docker | **High** | Realistically two of these at once, not all. Docker alone holds 3.8 GB and swap is already 2.3 GB used. See §16. |
| JDK 25 too new for the Android Gradle Plugin | Medium | Install JDK 17/21 alongside; do not remove 25. |
| T7 unplugged mid-build | Medium | The repo lives there; keep builds off it where possible. |
| exFAT 17× amplification misread as "disk full" | Low | Documented here; `du` on the T7 reports allocated, not actual, size. |

## 16. RAM budget (16 GB)

| Combination | Verdict |
| --- | --- |
| Metro + Claude Code + Docker/Supabase | Comfortable |
| Xcode + one iOS Simulator + Metro | Workable; close other apps |
| Android Studio + one Emulator + Metro | Workable; the emulator alone wants 2–4 GB |
| Xcode + Simulator **and** Android Studio + Emulator together | **Not advisable** — expect heavy swapping |
| Either of the above **plus** Docker/Supabase | Tight; stop the Supabase stack when not testing the backend |

Practical rule: **run one native platform at a time**, and prefer a
physical device when the backend stack also needs to be running.

## 17. Commands needed later (not run now)

```bash
# Reclaim (safe, regenerable) — review each before running
npm cache clean --force                 # ~8.3 GB
docker system prune                     # ~1.2 GB reclaimable
rm -rf ~/.gradle/caches                 # 2.5 GB, stale — regenerates

# After installing Xcode
sudo xcode-select --switch /Applications/Xcode.app
xcodebuild -version
xcrun simctl list runtimes

# After installing Android Studio
export ANDROID_HOME="$HOME/Library/Android/sdk"
adb devices
```

## 18. Exact next setup steps

1. **Reclaim internal space** and re-measure. Target 45+ GiB free.
   Nothing else should start until this is done.
2. **Install Xcode** from the App Store; `xcode-select --switch`; add
   exactly one iOS simulator runtime.
3. **Verify iOS** with `npx expo run:ios` against the Simulator.
4. **Install Android Studio**; SDK at the default internal path; one
   platform, one build-tools, one arm64 system image; add JDK 17/21.
5. **Verify Android** with `npx expo run:android`.
6. **Register a physical device of each platform** and make them the
   routine verification path.
7. Re-measure free space and record it here.

Steps 2–6 are each independently reversible and should be reviewed
between steps rather than run as one batch.


---

## 19. Post-install reconciliation (2026-08-30)

What this audit predicted, against what actually happened.

| Prediction | Outcome |
| --- | --- |
| Internal free space is the binding constraint (23 GiB) | **Resolved by the user** before install — 74 GiB free at install time, 48+ GiB after. No step was deferred for space. |
| Xcode ≈ 20–25 GB | **Roughly right, differently shaped.** Xcode 26 ships *thin*: the app is 3.6 GB and the iOS 26.5 simulator runtime is a separate 8.52 GB download. ~12 GB total, better than feared. |
| Android SDK + one image ≈ 15–20 GB | **Over-estimated.** The actual SDK is 5.9 GB plus 1.6 GB of AVD data. |
| Android SDK belongs on internal APFS | **Held.** Installed at `~/Library/Android/sdk`. |
| 17× small-file amplification on the T7 | **Held**, and is why no cache was relocated. |
| exFAT supports symlinks under fskit | **Held.** Metro read the project and `.env.local` off the T7 without complaint. |
| One native platform at a time on 16 GB | **Held, and tighter than hoped.** Emulator + Docker alone: 38% memory free, swap 3.35/4 GB. |
| Physical devices as the primary path | **Still the right call**, now for responsiveness rather than for disk space. |
| Android Studio IDE required | **Wrong.** The CLI toolchain is sufficient for `expo run:android`; the IDE was skipped. |

### The one prediction this audit did not make

It assumed the environment was what stood between Craavee and a device
build. It was not. Metro runs fine here; **three pre-existing project
defects** block native builds — a missing monorepo Metro configuration,
absent `ios.bundleIdentifier` / `android.package`, and duplicate React.
See `NATIVE_DEV_ENVIRONMENT_SETUP_REPORT.md` §7.

That is worth recording plainly: the "Expo could not be verified" note
carried since Phase 3 was attributed to the sandbox, and that attribution
was wrong.

### Quick check

```bash
bash scripts/check-native-dev-env.sh
```

Read-only; changes nothing.
