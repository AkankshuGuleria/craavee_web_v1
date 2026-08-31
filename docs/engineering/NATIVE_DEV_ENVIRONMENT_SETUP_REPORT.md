# Native Development Environment — Setup Report

Record of preparing this Mac for local iOS, Android and web development
for Craavee. Supersedes the storage estimates in
`LOCAL_DEVELOPMENT_ENVIRONMENT.md`, which was written before any tooling
existed.

Date: 2026-08-30. Baseline verified against `main` = `af60f21`.

**No Craavee product code was changed.** The only repository additions are
this document, the two updated environment documents, and
`scripts/check-native-dev-env.sh`.

---

## 1. Machine

| | |
| --- | --- |
| Model | Mac16,12 — Apple **M4**, 10 cores |
| RAM | **16 GB** |
| macOS | 26.6.2 (25G83), **arm64** |
| Homebrew | 6.0.20 (already present) |
| Node / npm | v25.5.0 / 11.8.0 |

## 2. Disk layout

| Volume | Filesystem | Size | Free (after setup) |
| --- | --- | --- | --- |
| Internal (`/`) | APFS | 228 GiB | see §4 |
| T7 Shield | **ExFAT**, 128 KB blocks | 931 GiB | 696 GiB |

T7 mount options: `local, nodev, nosuid, noowners, noatime, fskit`.
**Untouched by this task** — not formatted, repartitioned, renamed, or
reorganised. AdityaNet (176 GB) and Cartograph (21 GB) were measured only.

## 3. Storage budget

| | |
| --- | --- |
| Free before setup | **74 GiB** (the user had reclaimed ~51 GiB since the prior audit) |
| Free after Android toolchain | 59 GiB |
| **Free after everything** | **46 GiB** |
| iOS 26.5 simulator runtime | 8.52 GB download |
| Target floor | 20–25 GiB |

The budget held throughout with a wide margin; no installation step came
close to the floor, and none was deferred for space reasons.

## 4. What was installed

| Component | Version | Size | Location | Status |
| --- | --- | --- | --- | --- |
| OpenJDK 17 (Homebrew, **keg-only**) | 17.0.20.1 | ~300 MB | `/opt/homebrew/opt/openjdk@17` | **INSTALLED** |
| Android SDK Command-line Tools | 15859902 + `cmdline-tools;latest` | 173 MB + 172 MB | brew prefix + SDK | **INSTALLED** |
| Android SDK Platform-Tools (`adb`) | 37.0.1 | 37 MB | `~/Library/Android/sdk` | **INSTALLED** |
| Android SDK Platform 36 | rev 2 | 134 MB | `~/Library/Android/sdk` | **INSTALLED** |
| Android SDK Build-Tools | 36.0.0 | 188 MB | `~/Library/Android/sdk` | **INSTALLED** |
| Android Emulator | 37.1.11 | 1.1 GB | `~/Library/Android/sdk` | **INSTALLED** |
| System image `android-36;google_apis;arm64-v8a` | rev 7 | 4.3 GB | `~/Library/Android/sdk` | **INSTALLED** |
| AVD `Craavee_Pixel7_API36` | Pixel 7, API 36 | 1.6 GB | `~/.android/avd` | **INSTALLED** |
| **Xcode** | **26.6** (17F113) | 3.6 GB | `/Applications/Xcode.app` | **INSTALLED** *(by the user, mid-task)* |
| iOS 26.5 Simulator runtime | 23F77 arm64 | 8.52 GB download / **7.9 GB** on disk | Xcode-managed cryptex image | **INSTALLED & VERIFIED** |
| Simulator device `Craavee_iPhone17` | iPhone 17, iOS 26.5 | — | CoreSimulator | **BOOTED & VERIFIED** |

**NOT INSTALLED, deliberately:**

| | Why |
| --- | --- |
| Android Studio (IDE) | The CLI toolchain (`sdkmanager`, `avdmanager`, `adb`, `emulator`) is sufficient for `expo run:android`, and the IDE is ~3.5 GB of GUI this workflow never invokes. Install later if you want the layout inspector or profiler. |
| CocoaPods | Expo's prebuild manages pods itself for SDK 57; installing it globally risks the system Ruby. Add it only if a prebuild actually asks. |
| Watchman | Metro's default watcher worked with no missed reloads. Watchman is a fix for a problem this machine does not have. |
| Additional iOS runtimes / Android system images | One of each, per the brief. Each extra is 4–9 GB. |
| `mas` / `xcodes` | Only needed to script an Xcode install, which required Apple ID authentication regardless. |

## 5. Environment variables

Nothing was written to the shell profile — the values below are what the
Android tooling needs, and are documented rather than silently injected.

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

**Why JDK 17 is keg-only and `JAVA_HOME` is not exported globally.** Three
JDKs already exist on this machine (Temurin 25, Oracle 25, Oracle 24) and
other projects may depend on them. Homebrew's `openjdk@17` is deliberately
*not* symlinked into `PATH`: a fresh shell still resolves `java` to
**25.0.1**, verified after installation. Android builds opt in by setting
`JAVA_HOME` for that shell. **AdityaNet and Cartograph tooling is
unaffected.**

React Native 0.86 / Expo SDK 57 need JDK 17; JDK 25 is too new for the
Android Gradle Plugin, which is why 17 was added rather than the existing
JDKs being used or removed.

## 6. Verification

### Android — VERIFIED

| Check | Result |
| --- | --- |
| `adb version` | 1.0.41 (37.0.1) |
| `emulator -version` | 37.1.11.0 |
| AVD created | `Craavee_Pixel7_API36` |
| **Emulator boots** | **yes** — `sys.boot_completed=1` |
| `adb devices` | `emulator-5554  device` |
| Guest OS | **Android 16**, `arm64-v8a` |

### Metro — VERIFIED (and the historical hang was not reproducible)

`npx expo start` came up in **~15 s** and `/status` returned
`packager-status:running`. It loaded `.env.local` correctly from the
exFAT volume.

Metro then **genuinely bundled**: a request for the expo-router virtual
entry transformed its way deep into React Native before failing on a
module resolution error (§7, item 1) — not a hang, not a filesystem
stall, and not a timeout.

### iOS — VERIFIED

| Check | Result |
| --- | --- |
| `xcodebuild -version` | **Xcode 26.6** (17F113) |
| `xcode-select -p` | `/Applications/Xcode.app/Contents/Developer` |
| iOS SDK | iOS 26.5 (`iphoneos26.5`, `iphonesimulator26.5`) |
| `simctl list runtimes` | **iOS 26.5 (23F77)** |
| Runtime availability | `isAvailable: true`, no availability error, **65** supported device types |
| Disk image | **Ready**, Signature **Verified**, 7.9 GB, exactly **one** image |
| Mount | mounted at `/Library/Developer/CoreSimulator/Volumes/iOS_23F77` |
| Device created | `Craavee_iPhone17` — `FF331105-FE68-4A8A-B9AE-69B97F7C5D6A` |
| **Boot** | **Booted** — `bootstatus` finished in ~24 s |
| `simctl list devices booted` | `Craavee_iPhone17 (Booted)` |
| Responsiveness | `simctl spawn launchctl` responds; screenshot shows the iOS 26.5 home screen with SpringBoard, widgets and Dynamic Island rendering |
| Claude Code simulator integration | **attaches and drives the device** (402×874 pt coordinate space), after the `xcode-select` switch in §11a |

### iOS + Metro — VERIFIED to the point of the project's own defect

`npx expo start` came up in ~15 s. A request for the expo-router virtual
entry with `platform=ios` was **served and transformed** by Metro, failing
only on the project defect in §7.1:

```
UnableToResolveError
  originModulePath: node_modules/expo/src/launch/withDevTools.ios.tsx   ← hoisted to the workspace root
  targetModuleName: react-native-css-interop/jsx-runtime
```

That is the clearest statement of the defect yet: the NativeWind Babel
preset injects its JSX runtime into a **hoisted** Expo file at the
workspace root, which cannot see
`apps/customer-runner/node_modules/nativewind/node_modules/react-native-css-interop`.
Metro is working; the monorepo resolver configuration is not.

`expo prebuild` / `expo run:ios` were **not** run — they generate an
`ios/` directory and write to `app.json`, which would be a product change.
No `ios/` directory exists.

### Web / project baseline — VERIFIED, unchanged

| | |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test` | **44/44** |
| `npm run build` | pass (Store + Console) |
| `npm run db:test` | **ALL GREEN — 14 files, 371 assertions** |
| `npm run functions:check` | pass |
| `npm run functions:test` | **8/8** |
| `git status` | clean — no product file touched |

## 7. BLOCKED — three pre-existing project defects

The environment is ready. **The project is not yet buildable natively**,
for three reasons found by actually trying to bundle. None is an
environment fault, and none was fixed here: they are product changes, and
this was an environment task.

### 7.1 `metro.config.js` lacks the monorepo resolver configuration

`apps/customer-runner/metro.config.js` calls
`getDefaultConfig(__dirname)` and sets **no** `watchFolders` and **no**
`resolver.nodeModulesPaths` — Expo documents both as required in a
workspace.

Evidence:

- `react-native` is **hoisted** to `node_modules/react-native`; there is
  no copy under `apps/customer-runner/node_modules`.
- `nativewind` and its `react-native-css-interop` runtime are **nested**
  at `apps/customer-runner/node_modules/nativewind/…`.
- The Babel config sets `jsxImportSource: "nativewind"`, so the NativeWind
  JSX runtime is injected into files Metro transforms — **including
  hoisted React Native files**, which cannot see the app's nested
  `node_modules`.

Result:

```
UnableToResolveError
  originModulePath: node_modules/react-native/Libraries/LogBox/Data/LogBoxData.js
  targetModuleName: react-native-css-interop
```

### 7.2 `app.json` has no bundle identifier or package name

`expo.ios.bundleIdentifier` and `expo.android.package` are both
undefined. Both are required before `expo run:ios` / `expo run:android`
can generate a native project.

### 7.3 `expo-doctor`: duplicate React and a version mismatch

```
✖ duplicate native module dependencies
    react      19.2.3 (apps/customer-runner) vs 19.2.8 (root)
    react-dom  19.2.3 (apps/customer-runner) vs 19.2.8 (root)
✖ expo-crypto  expected ~57.0.2, found 15.0.9
```

19 of 21 checks passed. A native build may only contain one copy of a
native module, so the duplicate React is a genuine blocker rather than a
warning.

**These three explain the "Expo could not be verified" note carried since
Phase 3.** That was recorded as a possible sandbox limitation; it is not.
Metro runs fine here. The project's monorepo Metro configuration and its
dependency tree are what stop it.

## 8. Metro diagnosis (the §19 question, answered)

| Hypothesis | Verdict |
| --- | --- |
| Sandbox-specific | **No.** Metro starts and bundles on the real machine. |
| Filesystem / exFAT | **No.** Metro read the project and `.env.local` from the T7 without complaint. |
| Dependency-related | **Partly** — duplicate React and the nested NativeWind runtime. |
| Configuration-related | **Yes, primarily** — the missing monorepo resolver config. |
| Actual project bug | **Yes.** §7.1–7.3 are defects in the repository, not the environment. |

The earlier failures were observed through `expo export`, which bundles
for production and fails on the same resolution problem — the hang was a
symptom, not the disease.

## 9. Storage consumed

| | |
| --- | --- |
| Android toolchain (SDK + AVD + cmdline-tools + JDK) | ~15 GiB |
| Xcode 26.6 app | 3.6 GB |
| iOS 26.5 simulator runtime | 8.52 GB |

## 10. Performance on 16 GB

With the emulator booted and the Docker/Supabase stack running, system
memory free fell to **38%** and swap reached **3.35 GB of 4 GB**. That is
already under pressure with a single platform.

**Run one native platform at a time.** Stop the Supabase stack
(`npm run db:stop`) when testing on a device, and do not expect the iOS
Simulator and the Android Emulator to coexist comfortably.

## 11. Cache strategy

All native caches stay on **internal APFS** — Xcode DerivedData,
CoreSimulator, the Android SDK, AVD data, Gradle. The T7's 128 KB
allocation block costs roughly **17×** on small-file trees (measured:
Craavee's `node_modules` is 1.14 GB of content occupying 19 GB), so
moving them there would consume *more* space, not less, on top of being
unsupported.

Safe cleanup when caches grow (none of these is routine — do not run them
between builds):

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/*     # rebuild cost only
rm -rf ~/.gradle/caches                            # re-downloads
npm cache clean --force
watchman watch-del-all                             # only if watchman is installed
xcrun simctl delete unavailable                    # prunes stale simulators
```

## 11a. Two traps worth knowing

### Never prune simulator runtime images that report as duplicates

After the first successful 8.52 GB download, `simctl runtime list` showed
**three** image entries — one `Ready` and two `Unusable - Other Failure:
Duplicate of …`. Deleting the two "duplicates" destroyed the runtime
entirely: they shared the same backing MobileAsset as the good image, and
removing them purged it. `Total Disk Images: 0`, and the 8.52 GB had to be
downloaded again.

**Do not run `simctl runtime delete` on entries marked Duplicate or
Unusable** without first proving they do not share an `Image Path` with a
working image. The duplicates most likely arose because the platform
download ran more than once. On the clean second attempt exactly one image
was created and the runtime registered immediately — which also explains
the earlier "image is Ready but `simctl list runtimes` is empty" symptom:
the duplicates were the cause, not a mount failure.

### The Xcode licence blocks git, not just Xcode

When `xcode-select` switched to a freshly installed Xcode whose licence had
not been accepted, **`git` and `clang` failed machine-wide** with:

```
You have not agreed to the Xcode license agreements … (rc=69)
```

Fix, which needs a password:

```bash
sudo xcodebuild -license accept
```

Worth expecting after any Xcode upgrade.

### Claude Code's iOS Simulator integration needs its own explicit switch — RESOLVED

The bundled simulator integration reported *"Xcode is installed but not
selected"* even though `xcode-select -p` already returned
`/Applications/Xcode.app/Contents/Developer` and `simctl` worked normally
from a shell. It keeps its own resolution and needed the switch to be set
explicitly:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Run by the machine owner on 2026-08-31. **Verified working afterwards**:
the integration attaches to `Craavee_iPhone17` (coordinate space
402×874 pt) and returns live screenshots, so simulator work no longer has
to go through `xcrun simctl` by hand.

If it recurs after an Xcode upgrade, this is the fix.

## 12. Physical devices

Prepared, not configured. Nothing was signed and no certificate or
profile was created.

**Android** — enable Developer Options (tap Build Number 7×) then USB
debugging, connect, accept the RSA prompt, confirm with `adb devices`.
Wireless debugging works over the LAN if preferred.

**iOS** — connect the iPhone, trust the Mac, then in Xcode add your Apple
ID under Settings → Accounts and let it create a personal development
team. A **free** Apple ID is enough for local device testing; a paid
account is only needed for TestFlight or App Store distribution.

**A physical device cannot reach `127.0.0.1`.** Point
`EXPO_PUBLIC_SUPABASE_URL` at the Mac's LAN address
(`ipconfig getifaddr en0`) with both on the same network. This is the
most common cause of "works in the simulator, broken on the phone".

## 13. Expo / EAS

Unchanged. **Local**: Expo dev server, Simulator, Emulator, physical
devices. **Cloud (EAS)**: production builds, signing, distribution,
updates. EAS CLI 23.0.0 is available through `npx eas-cli`; nothing was
installed globally and no Expo SDK version was changed.

## 14. Exact commands used

```bash
# JDK 17 — keg-only, leaves existing JDKs alone
brew install openjdk@17

# Android toolchain
brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" \
  platform-tools emulator platforms:android-36 build-tools:36.0.0 \
  system-images:android-36:google_apis:arm64-v8a cmdline-tools:latest
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
  -n Craavee_Pixel7_API36 -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7

# iOS runtime (Xcode 26 ships thin and downloads platforms separately)
xcodebuild -downloadPlatform iOS
```

(`sdkmanager` package paths use `;` not `:` — rewritten here only to keep
this block copy-pasteable in a shell.)

## 15. Rollback / uninstall

Everything installed is removable without touching the repository or any
other project:

```bash
brew uninstall openjdk@17
brew uninstall --cask android-commandlinetools
rm -rf ~/Library/Android/sdk        # ~5.9 GB
rm -rf ~/.android                   # AVDs, ~1.6 GB
# Xcode: drag /Applications/Xcode.app to the Trash, then
sudo xcode-select --switch /Library/Developer/CommandLineTools
xcrun simctl delete all             # removes simulator data
```

No shell profile was modified, so there is nothing to unwind there.

## 16. Recommended workflow

```
implement → automated tests → typecheck/lint
   → npx expo start
   → iOS (Simulator or device)
   → Android (Emulator or device)
   → manual interaction check
   → fix → build → commit → PR → CI → merge
```

Full detail, including per-platform commands and when device validation
is required, is in `PHASE_6_LOCAL_VALIDATION_PLAN.md`.

## 17. Status summary

| | |
| --- | --- |
| **INSTALLED** | JDK 17, Android SDK 36 + build-tools + platform-tools + emulator + one arm64 system image, one AVD, Xcode 26.6, iOS 26.5 simulator runtime |
| **VERIFIED** | iOS 26.5 runtime registered, mounted and available; `Craavee_iPhone17` **boots** and renders SpringBoard; Android emulator boots to Android 16 and is visible to `adb`; Metro starts and transforms for **both** platforms; the full Craavee test/build baseline is unchanged |
| **OPTIONAL** | Android Studio IDE, CocoaPods, Watchman — each deliberately skipped with a reason (§4) |
| **NOT INSTALLED** | Extra iOS runtimes, extra system images, `mas`/`xcodes` |
| **BLOCKED** | `expo run:ios` and `expo run:android`, on three pre-existing project defects (§7) that are product changes, not environment work. **The environment itself is complete — nothing further is needed from the machine.** |

---

## 18. Update — 2026-08-31, after the workspace migration

The "BLOCKED" row in §17 is now **resolved**. Both `expo run:ios` and
`expo run:android` work, and Craavee runs on `Craavee_iPhone17` and
`Craavee_Pixel7_API36`. Two things changed: PR #9 fixed the three project
defects, and the working tree moved off exFAT to
`~/Craavee/craavee_web_v1` (see `WORKSPACE_MIGRATION_REPORT.md`).

**The repository path in §2 is out of date.** Craavee is no longer on the
T7. The T7 remains ExFAT and still holds AdityaNet and Cartograph, which
were never touched.

### Corrected storage figures

§3's budget was written before any tooling existed and understates the
Android toolchain considerably.

| | Then | Now (measured) |
| --- | --- | --- |
| Internal free | 46 GiB claimed after setup | **23 GiB** |
| NDK 27.1 | not budgeted | **2.4 GB** |
| `~/.gradle` | not budgeted | **3.8 GB** |
| Android SDK total | 5.9 GB | ~8.3 GB with NDK |
| Craavee working tree | 18 GB on exFAT | **2.7 GB on APFS** |
| T7 free | 696 GiB | **716 GiB** |

Free space dipped to **19 GiB** during the first Android build and was
recovered by clearing regenerable caches. The binding constraint on this
machine is **not** the workspace — it is the Android toolchain plus
whatever else is resident.

### Two defects in the setup this report describes

**`build-tools/35.0.0` was installed as an empty directory** — zero files,
no `package.xml`. AGP therefore treated it as missing and tried to
re-download it, hanging with no error in a `DownloadCache` that has no
connect timeout. §5's verification checked that packages were *listed*, not
that they were *populated*. Repaired with:

```
rm -rf "$ANDROID_HOME/build-tools/35.0.0"
sdkmanager --install "build-tools;35.0.0"
```

A useful check to add: every SDK package directory should contain a
`package.xml`.

```
for d in "$ANDROID_HOME"/build-tools/*/ "$ANDROID_HOME"/platforms/*/; do
  [ -f "$d/package.xml" ] || echo "INCOMPLETE: $d"
done
```

**The 16 GB ceiling is stricter than §15 suggests.** "One native platform
at a time" is necessary but not sufficient — Docker's 11 Supabase
containers must also be stopped for an Android build. With them running,
the Kotlin compile daemon was OOM-killed and Gradle waited on the dead
process indefinitely, with no error. Stop the stack for the build and
`docker start` it before launching the app.

Local Gradle tuning that made the difference, in the **generated,
untracked** `android/gradle.properties`:

```
org.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m
org.gradle.workers.max=2
kotlin.compiler.execution.strategy=in-process
org.gradle.parallel=false
reactNativeArchitectures=arm64-v8a
```

`reactNativeArchitectures` is the significant one: the default builds four
ABIs while only an `arm64-v8a` system image is installed, so three quarters
of the native build was wasted. `assembleDebug` dropped from stalling for
over an hour to **1m 13s**. `expo prebuild` regenerates this file, and a
release build must restore all ABIs.

**CocoaPods requires a UTF-8 locale.** `pod install` aborts with
`Encoding::CompatibilityError` when `LANG` is unset. Note this conflicts
with the `LC_ALL=C` workaround recorded for a `sed` failure — they cannot
both be set globally.

### Corrected status

| | |
| --- | --- |
| **VERIFIED** | Everything in §17, plus: `pod install`, `xcodebuild` (`Build Succeeded`, 0 errors), `gradlew :app:assembleDebug` (`BUILD SUCCESSFUL`, 79 MB APK), install and launch on both devices, live Supabase data through RLS in the running app |
| **BLOCKED** | *(nothing)* |
