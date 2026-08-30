# Local Validation Plan — Phase 6 onward

How a feature gets verified on real iOS and Android before it is
committed. Prerequisite: the setup steps in
`LOCAL_DEVELOPMENT_ENVIRONMENT.md` §18.

This exists because Phase 3 recorded that the Expo bundle could not be
verified in this environment, and that gap persisted through Phase 5.
Everything shipped so far is proven at the database, function and
contract layers — **no Craavee screen has ever been run on a real iOS or
Android device.** This plan closes that, starting with the Phase 6
surface.

---

## 1. The standard loop

```
implement
   ↓
unit + integration tests          ← already enforced
   ↓
typecheck / lint                  ← already enforced
   ↓
Expo dev server
   ↓
iOS validation      (Simulator or device)
   ↓
Android validation  (Emulator or device)
   ↓
manual interaction check
   ↓
fix
   ↓
build (Store + Console)           ← already enforced
   ↓
commit → PR → CI → merge
```

Steps 1–3 and the build are already the project's habit. The three new
steps are the iOS, Android and interaction checks, and they belong
*before* the commit, not after the PR.

## 2. Backend the app talks to

Local Supabase, as the integration suites already use:

```bash
npm run db:start          # Postgres + Auth + PostgREST
npm run functions:serve   # scripts/serve-functions.sh, port 8790
```

The Expo client reads `EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` from `apps/customer-runner/.env.local`.

**A simulator can reach `127.0.0.1`; a physical device cannot.** On a
device, point those variables at the Mac's LAN address (`ipconfig getifaddr en0`)
and keep both on the same network. This is the single most common reason
a build works in the simulator and appears broken on a phone.

## 3. Per-platform commands

| Platform | Command | Notes |
| --- | --- | --- |
| iOS Simulator | `npx expo run:ios` | First run compiles the native project; expect several minutes |
| iOS device | `npx expo run:ios --device` | Needs development signing (free Apple ID is sufficient) |
| Android Emulator | `npx expo run:android` | Emulator must already be running |
| Android device | `npx expo run:android --device` | USB debugging or wireless debugging enabled |
| Metro only | `npx expo start` | For JS-only changes after a native build exists |

Run **one platform at a time** on this machine — 16 GB does not
comfortably hold both toolchains plus Metro plus Docker
(`LOCAL_DEVELOPMENT_ENVIRONMENT.md` §16).

## 4. What Phase 6 specifically needs validated

Phase 6 shipped the Store (Next.js) surface, which is verified in a
browser rather than on a device. What has **never** been exercised on a
device is the customer client that Phases 3–5 built, and it is the
natural first target.

### 4.1 Store surface — browser

| Check | Expected |
| --- | --- |
| Visit `/packing` signed out | Redirect to `/sign-in` |
| Sign in as a customer | Redirect to `/not-authorized` |
| Sign in as packer `9000001102` | Queue loads, oldest first |
| Sign in as packer `9000001103` | Queue is **empty** — different store, enforced by RLS |
| Open an order | Lines and quantities only; no customer name, address, wallet or payment |
| "None on shelf" | Line reconciles, refund lands, order stays live |
| Tap "Mark packed" twice | Second tap is harmless |
| Pack from two browsers at once | Exactly one performs the effect |

Everything above is already covered by pgTAP and the integration suite;
running it by hand is checking the *surface*, not the guarantee.

### 4.2 Customer client — device, first time ever

| Area | What only a real device tells you |
| --- | --- |
| Phone OTP sign-in | Real SMS autofill, keyboard type, paste behaviour |
| Catalog | Scroll performance with real images, FlashList behaviour |
| Cart / checkout | Keyboard covering inputs, safe-area insets, back gesture |
| Payment | Razorpay Checkout actually opening — **never once run on a device** |
| Order status | Polling behaviour on cellular, backgrounding, resume |
| Notch / Dynamic Island / gesture bar | Layout correctness |

## 5. Interaction checklist

Run on each platform before committing a UI-affecting change:

- Cold start from a killed state
- Background for 60 s, then resume
- Rotate, if the screen supports it
- Slow network (Simulator: Network Link Conditioner; Android: emulator
  network profile)
- Airplane mode mid-request — the error state must be honest, not a spinner
- Keyboard open on every text input; check nothing important is hidden
- Back gesture / hardware back on Android from every screen

## 6. What stays automated

Device testing does **not** replace anything:

| Layer | Stays |
| --- | --- |
| pgTAP (371) | Correctness of schema, RLS, state machine, money |
| Integration (100) | Real HTTP against real functions, including concurrency |
| Unit (44) | Pure logic |
| Gateway (8) | Fail-closed payment safety |
| CI | Runs all of the above on every PR |

Manual device work catches what those cannot: layout, gestures,
permissions, keyboards, native modules, and performance. It is additive.

## 7. When device validation is required

| Change | Device validation |
| --- | --- |
| Migration, Edge Function, RLS | Not required — automated coverage is stronger |
| Store/Console (Next.js) | Browser check |
| Customer client UI or navigation | **Both platforms** |
| Native dependency added or upgraded | **Both platforms**, from a clean build |
| Payment or auth flow | **Both platforms**, on a physical device |
| Docs only | None |

## 8. Recording the result

Each phase report gains a short section:

```
## Device validation
iOS      <device/simulator, OS version> — <what was exercised> — pass/fail
Android  <device/emulator, API level>   — <what was exercised> — pass/fail
Not exercised: <explicitly listed>
```

State plainly what was **not** tried. The Razorpay gap is the standing
example of why: "implemented and unit-tested" was never allowed to drift
into "verified", and device testing deserves the same discipline.

## 9. Known limits at the time of writing

- Xcode and Android Studio are **not installed**; nothing in §3 can run
  until `LOCAL_DEVELOPMENT_ENVIRONMENT.md` §18 is done.
- 23 GiB free internally — reclamation comes first.
- 16 GB RAM — one native platform at a time.
- Razorpay still has no live sandbox transaction. A device test will
  exercise Checkout **against the mock adapter** unless real `rzp_test_`
  keys are configured; that distinction must not be blurred in any report.
