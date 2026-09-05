# Authentication, Role Routing & Real-Device APK — Checkpoint

**Branch:** `feat/auth-role-routing-device`
**Date:** 2026-09-05
**Backend changes:** zero.

**The headline is uncomfortable and it is the point: almost nothing this
brief asks to be *built* can honestly be built.** Of the eight
authentication capabilities requested, one is already implemented, three
are blocked on credentials or configuration nobody has supplied, one
contradicts a recorded product decision, and three were already done. What
this run delivers instead is the audit that establishes that, a real
standalone APK, and role routing verified on a physical phone against real
staging.

---

## 1. Authentication method audit (§2)

| Method | Current status | Backend support | Frontend | Provider required | Safe to implement | Blocker |
|---|---|---|---|---|---|---|
| **Phone + OTP** | **IMPLEMENTED** | Yes | Yes | **SMS provider for real delivery** | Already done | Real SMS **BLOCKED** — see §2 |
| **Phone + password** | **NOT IMPLEMENTED** | Possible in Supabase | No | None | **NO — contradicts a decision** | See §3 |
| **Username + password** | **NOT POSSIBLE** | **No username column exists anywhere** | No | n/a | **NO** | No username identity — see §4 |
| **Email + password** | **DISABLED** | `[auth.email] enable_signup = false` | No | None | Not requested by product | Deliberately off |
| **Google / OAuth** | **NOT CONFIGURED** | **No `[auth.external.google]` block at all** | No | Google OAuth client | **NO** | See §5 |
| **Password recovery** | **N/A** | No passwords exist to recover | No | n/a | **NO** | Nothing to reset |
| **Magic link** | **N/A** | Email disabled | No | n/a | No | Not applicable |
| **Logout** | **IMPLEMENTED** | Yes | Yes | None | Done | — |
| **Session restore** | **IMPLEMENTED** | Yes (SecureStore) | Yes | None | Done | — |
| **Role-based routing** | **IMPLEMENTED** | Yes (D8 JWT claim) | Yes | None | Done | — |

## 2. Real SMS — BLOCKED

Measured, not assumed:

```
[auth.sms.twilio]
enabled     = false
account_sid = ""            # empty
auth_token  = "env(SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN)"   # unset
```

**No SMS provider is configured on staging.** Staging authenticates via
`[auth.sms.test_otp]` — nineteen fixed numbers with fixed codes.

**A fixed test OTP is not real SMS and is not reported as such anywhere in
this document.** Real SMS remains **BLOCKED** on a provider decision the
owner has not made, plus Indian DLT registration, which has an external
lead time no amount of engineering shortens.

## 3. Phone + password — NOT BUILT, and this is deliberate

Phone+password is technically possible in Supabase. It is **not**
implemented because it contradicts a decision already recorded in the
codebase. From `supabase/config.toml`, at the phone-auth block:

> phone OTP is THE sign-in method (dossier §12, "the standard Indian
> consumer pattern, real identity, no password")

Adding passwords would mean: a password column in the auth model, a
password-strength policy, a reset flow, a breach surface that does not
currently exist, and a second identity path to keep in sync — all to
contradict a product decision the owner already took.

§35 says do not modify the architecture to make a UI screen work. This is
that case. **If the owner wants passwords, that is a product decision to
reverse explicitly, not a UI task to absorb.**

## 4. Username + password — BLOCKED (no identity exists)

`grep -rniE "username" supabase/migrations/*.sql` returns **nothing**.
`profiles` is `id, phone, full_name, wallet_balance, referral_code,
acquisition_campaign_id, created_at`. There is no username column, no
unique index, no auth identity.

**The unsafe implementation was explicitly not built.** §7 names it: a
client-side `username → look up email/phone → sign in` pattern. That would
require the client to read an identity mapping for arbitrary users, which
is a user-enumeration oracle — anyone could probe which usernames exist.

A secure version needs a `SECURITY DEFINER` RPC that takes a username and
performs the lookup server-side without returning the mapping, plus a
unique-indexed column and a decision about what a username *is* for a
product that identifies people by phone number. That is a schema and
product change, reported here rather than made.

## 5. Google sign-in — BLOCKED (not configured)

`config.toml` contains exactly one external provider block —
`[auth.external.apple]`, `enabled = false`. **There is no
`[auth.external.google]` block at all.**

To unblock, the owner must supply:

| Requirement | Why |
|---|---|
| Google Cloud OAuth client (Web) | The Supabase callback is a web redirect |
| Android OAuth client + SHA-1 of the signing key | Native sign-in binds to the app signature |
| iOS OAuth client + bundle id | Same, for iOS |
| Client ID + secret in **staging secret storage** | Never in git |
| Redirect URL registered on the Supabase project | `https://<ref>.supabase.co/auth/v1/callback` |
| Deep-link scheme confirmed | The app already declares `craavee://` |

**No Google button was added.** A button that opens nothing is worse than
no button.

## 6. Role architecture — already correct, verified not built

This is the part the brief was most concerned about, and it was already
right.

**Role comes from a server-verified JWT claim.** `AuthProvider` calls
`supabase.auth.getClaims()` — not `session.user`, not a client-side decode,
not AsyncStorage. The claim is emitted by `custom_access_token_hook`
(D8, migration 0002) which reads `staff_roles` server-side.

**One routing authority.** `lib/auth/resolveRouteAccess.ts` is a pure
function with no Supabase, Router or React dependency, so every branch is
unit-tested. Screens do not each re-derive access.

**There is no client-side role authority to remove.** No
`if (username === "admin")`, no email-substring check, no local role value.
Searched for; absent.

### 6.1 The architectural truth about Store and Admin

**The mobile app has no Store or Admin interface, and must not pretend
to.** `apps/customer-runner` contains exactly two role surfaces:
`(customer)` and `(runner)`. Store is `apps/store` and Console is
`apps/console` — separate Next.js **web** applications.

So for `packer` and `admin`, the correct behaviour on the phone is the
existing `/unsupported-role` screen. That is not a gap; building a Store
or Admin UI into the customer APK to satisfy a journey table would be
inventing a surface.

| Role | Mobile destination | Correct? |
|---|---|---|
| `customer` | `(customer)` tabs | Yes |
| `runner` | `(runner)` | Yes |
| `packer` | `/unsupported-role` | **Yes — Store is a web app** |
| `admin` | `/unsupported-role` | **Yes — Console is a web app** |

## 7. Error language (§29) — already compliant

Checked rather than rewritten. `lib/auth/errors.ts` already maps to
specific, actionable copy:

- "That code isn't right. Check the SMS and try again."
- "That code has expired. Request a new one."
- "No connection. Check your network and try again."
- "Too many attempts. Wait a moment before trying again."
- "Enter a valid phone number, including the country code."

No backend detail leaks. **No change was needed**, so none was made.

## 8. Role test accounts (§26) — all exist, none created

No account was created and no user was promoted. All four already exist in
the seed with fixed test OTPs:

| Role | Phone | Code |
|---|---|---|
| customer | `919990000001` | `123456` |
| runner | `919000001201` | `123456` |
| packer (store) | `919000001101` | `123456` |
| admin | `919000001301` | `123456` |

---

## 9. The APK (§17, §38)

A **release** build, not a debug one — deliberately. A debug APK loads its
JS from a Metro dev server, so it stops working the moment the laptop
walks away. That is not what "install the APK and use Craavee" means. A
release build bundles the JS and runs standalone.

| Field | Value |
|---|---|
| **Path** | `apps/customer-runner/android/app/build/outputs/apk/release/app-release.apk` |
| **Size** | 44 MB (45,859,331 bytes) |
| **SHA-256** | `bea523699135fca829ea45cd2fd398f2dd2f1375a93d3bdfa04b18aa1b04e78b` |
| **applicationId** | `com.craavee.app` |
| **versionName / versionCode** | `1.0.0` / `1` |
| **Build type** | `release` (JS bundled) |
| **Git SHA** | `d639a3d` |
| **Build** | `./gradlew assembleRelease`, `BUILD SUCCESSFUL in 8m 33s`, 615 tasks |
| **Toolchain** | JDK 17 (`openjdk@17`, keg-only), Android SDK 36, NDK 27.1 |
| **No EAS** | Local Gradle only |

**Signing — read this before distributing.** `android/app/build.gradle`
wires the `release` buildType to `signingConfigs.debug`, i.e. the
generated debug keystore. That is fine for staging QA on a known device
and **not distributable** — Play requires a real upload key. Generating
one is a release-engineering decision, not something to do silently.

**`/mnt/data/craavee-staging-debug.apk` was NOT created.** That path does
not exist on this host (macOS). §38 said "only if the runtime supports
creating this artifact"; it does not, so nothing was written and no copy
is claimed.

## 10. Installation proof (§39)

```
adb uninstall com.craavee.app     → Success        (clean state)
adb install -r app-release.apk    → Success
pm list packages | grep craavee   → package:com.craavee.app
dumpsys package                   → versionName=1.0.0
pm path com.craavee.app           → /data/app/~~vupmdXcz…/base.apk
```

**Standalone verified.** Metro was killed and confirmed absent from
port 8081, the app was force-stopped, then launched with
`am start -n com.craavee.app/.MainActivity` — and rendered the auth
screen fully. It does not need the laptop.

## 11. Device journeys — real APK, real staging (§21)

Device: vivo **V2250** / product `V2250i`, Android **15**, API **35**,
`arm64-v8a`, serial `10BDAY041Z000F1`.

| # | Journey | Result | Evidence |
|---|---|---|---|
| A | Signup (new user) | **UNVERIFIED** | Every test-OTP number already has a seeded profile. A genuine new-user signup needs a test-OTP number with no profile, which would mean editing the pushed staging auth config — not done casually |
| B | Customer login | **PASS** | `919990000001` → Customer tabs, real staging catalog |
| C | Runner login | **PASS** | `919000001201` → Runner "Available jobs", **not** customer tabs |
| D | Store staff login | **PASS (correct behaviour)** | `919000001101` → "This account isn't set up as a customer or runner. Staff accounts use the Store or Console apps instead." |
| E | Admin login | **PASS (correct behaviour)** | `919000001301` → same screen. **An admin gains no elevated access in the mobile app** |
| F | Logout | **PASS** | Returns to auth; hardware back does **not** re-enter authenticated screens |
| G | Session restore | **PASS** | Force-stop → relaunch → still customer, straight into the Customer interface, no re-auth |
| H | Wrong-role route | **PASS** | Customer deep-linked to runner-only `craavee:///active` → stayed on Customer. The guard redirected |

**D and E are passes, not failures.** The mobile app has no Store or Admin
surface to route to — those are separate web applications. Building one
into the customer APK to satisfy a journey table would be inventing a
surface.

## 12. Staging configuration on the device (§19, §20)

| Check | Result |
|---|---|
| Supabase URL | `https://awahemlbgmymahpvhczk.supabase.co` (real staging) |
| Key | **anon only.** `service_role` never enters the client |
| Not local Docker | Confirmed — real staging catalog, orders and wallet ledger rendered |
| Not production | No production project exists |
| Package / scheme | `com.craavee.app` / `craavee://` |
| Secrets in git | None. Only `.env.example` (empty values) is tracked |

## 13. Test matrix (§37)

| Flow | Android | iOS | Web | Staging |
|---|---|---|---|---|
| Signup | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Phone/password | **BLOCKED** (contradicts decision) | BLOCKED | BLOCKED | BLOCKED |
| Phone/OTP (test OTP) | **PASS** | PASS (earlier slices) | PASS (earlier slices) | PASS |
| Phone/OTP (**real SMS**) | **BLOCKED** | BLOCKED | BLOCKED | **BLOCKED — no provider** |
| Username/password | **BLOCKED** | BLOCKED | BLOCKED | BLOCKED |
| Google | **BLOCKED** | BLOCKED | BLOCKED | **BLOCKED — not configured** |
| Forgot password | **N/A** | N/A | N/A | N/A |
| Logout | **PASS** | PASS | UNVERIFIED | PASS |
| Session restore | **PASS** | PASS | UNVERIFIED | PASS |
| Customer routing | **PASS** | PASS | UNVERIFIED | PASS |
| Runner routing | **PASS** | UNVERIFIED | UNVERIFIED | PASS |
| Store routing | **PASS (unsupported-role)** | UNVERIFIED | n/a — Store is its own web app | PASS |
| Admin routing | **PASS (unsupported-role)** | UNVERIFIED | n/a — Console is its own web app | PASS |
| Wrong-role denial | **PASS** | UNVERIFIED | UNVERIFIED | PASS |

Nothing is marked PASS because a screen rendered. Every PASS above is a
completed flow observed on the device.

## 14. Security findings

- **No client-side role authority exists.** Searched for
  `username === "admin"`, email-substring checks and local role values.
  None present. Role comes from `getClaims()`.
- **No secrets in the repo.** Only `.env.example` with empty values; the
  `SUPABASE_SERVICE_ROLE_KEY` hits are variable *names* in CI and a script.
- **Nothing sensitive is logged.** No `console.log` of password, OTP,
  token or secret anywhere in the customer app.
- **No test credentials in the client bundle.** Test OTPs live in the
  Supabase auth config, not in the app.
- **Admin proved powerless in the mobile client** — Journey E.

## 15. Remaining authentication blockers

| Blocker | Owner action required |
|---|---|
| **Real SMS** | Choose a provider (Twilio/MessageBird/Textlocal/Vonage), supply credentials to staging secret storage, complete Indian DLT registration |
| **Google sign-in** | Google Cloud OAuth clients (Web + Android SHA-1 + iOS bundle id), client id/secret into staging, redirect URL registered |
| **Username login** | Decide whether a username identity should exist at all for a phone-identity product; then a unique column + `SECURITY DEFINER` lookup RPC |
| **Phone + password** | A **product decision to reverse**, not an engineering gap |
| **Signup journey** | A test-OTP number with no seeded profile, or a real SMS provider |
| **Release signing key** | A real upload keystore before any distribution |

## 16. What changed in the code

**Nothing.** This run is an audit, a build and a verification. The
authentication architecture, role resolution and routing were already
correct, and the auth error copy already met §29. Changing working code to
demonstrate activity would have been the wrong call.

