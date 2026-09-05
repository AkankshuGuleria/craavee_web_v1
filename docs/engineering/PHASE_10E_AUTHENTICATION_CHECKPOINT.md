# Phase 10E-AUTH — Authentication Checkpoint

**Branch:** `feat/authentication-complete-10e`
**Date:** 2026-09-05
**Backend changes:** zero. **Migrations:** none. **Dependencies added:** none.

**The headline: password authentication is now real, and it needed no
schema change and no external credential.** The previous audit called it
blocked; that was wrong in one specific way, and finding out why is the
substance of this phase.

---

## 1. What changed, and the mistake that preceded it

The last checkpoint concluded phone+password was "not a gap, a decision to
reverse", partly because *"no existing account has a password, so enabling
password sign-in gives nobody a way in"*.

That reasoning was **half right and it led to the wrong conclusion**. It
correctly identified that no account has a password. It then treated that
as a blocker, when it is simply the design problem: the answer is an
**enrolment flow**, and enrolment can happen inside an OTP-authenticated
session — which the product already has.

Once framed that way, nothing external is required. The owner's decision
in this brief authorised the model; the implementation turned out to need
no credential, no provider and no migration.

## 2. The credential model — ONE model, stated once

> **The phone number is the identity. A password is an OPTIONAL,
> ADDITIONAL credential on that same identity — never a second account.**

- **Enrolment:** OTP sign-in → Account → Password → `updateUser({ password })`
- **Sign-in:** `signInWithPassword({ phone, password })`
- **Recovery:** "Forgot it? Sign in with a code instead" → OTP → set a new one

There is deliberately **no second password system** (no email+password, no
separate credential store) and **no username** yet — §11 asks for one
coherent model, and this is it.

## 3. Verified against real staging BEFORE any UI was written

A probe ran against the real staging project. All seven properties passed:

| # | Property | Result |
|---|---|---|
| 1 | OTP sign-in works | **PASS** |
| 2 | OTP-issued token carries the server `role` claim | **PASS** — `role=customer` |
| 3 | `updateUser({ password })` enrols on the authenticated session | **PASS** |
| 4 | `signInWithPassword({ phone, password })` then works | **PASS** |
| 5 | **Same `auth.users` id across both paths** | **PASS** — no duplicate identity |
| 6 | **Password-issued token ALSO carries the `role` claim** | **PASS** — `role=customer` |
| 7 | Wrong password rejected | **PASS** — `Invalid login credentials` |

**Property 6 was the one that mattered.** Had the `custom_access_token_hook`
not run on the password path, password sign-in would have produced a
session with **no role**, and role routing would have silently degraded for
everyone who used it. It runs. Role routing is credential-agnostic.

Property 5 satisfies §37 and §38: one identity, one profile, no orphan.

### 3.1 A probe bug that nearly became a false security finding

The first probe reported `role=none` and I was one step from recording
"password sign-in loses the role claim" as a defect. It was reading
`claims.user_role`; the hook emits **`claims.role`**. Corrected, and both
paths carry the claim. Recorded because a false security finding is
expensive in a different way than a missed one.

### 3.2 Staging state this created

The probe set a password on **one** seeded throwaway test account,
`919990000009` (the integration suite's disposable customer). No other
account was touched, no account was created, and no role was granted. The
value exists only in a local scratchpad, was never printed, and is not in
git.

## 4. Security properties

| Property | How |
|---|---|
| **No account enumeration** | Supabase returns `Invalid login credentials` for both a wrong password and an account with no password. The UI preserves that ambiguity — a unit test asserts the message never contains "not found", "no account", "not registered" or "no password" |
| **No raw provider errors** | Every failure is mapped; tests assert `AuthApiError` and `over_request_rate_limit` can never reach the customer |
| **Password chosen by the customer** | §35. Nothing generates, suggests or silently sets one |
| **Enrolment requires proof of the number** | The screen is behind authentication, so the customer has just completed OTP |
| **Nothing logged** | No `console.*` in any auth module or screen. Verified by grep |
| **No client role authority** | Unchanged: role comes from `getClaims()` |
| **No composition theatre** | Length floor (8) and the provider's ceiling (72). No "one upper, one digit" rule — those push people to `Password1!`, which is weaker than length. A test pins the absence so a future addition has to be argued for |

## 5. Recovery — real, not a placeholder

Email is disabled on this project (`[auth.email] enable_signup = false`)
and there is no SMS provider, so an email password-reset screen could
deliver **nothing**. Building one would have been the dead end §15 forbids.

Instead, recovery routes through the channel that already works: a code
proves control of the number, and the customer sets a new password from
inside the app. **The loop is complete today**, and it gets better — not
different — when real SMS is configured.

## 6. Entry hierarchy

Matches the requested shape, minus what does not exist:

```
CRAAVEE
The campus shop, delivered to your door.
  [ Continue with phone ]      ← primary
    Sign in with a password    ← quieter, secondary
```

**There is still no Google button**, because there is still no
`[auth.external.google]` block on the project. Password is secondary
because a password only exists if the customer chose to set one — leading
with it would ask a question most people cannot answer yet.

## 7. Still blocked — in the §50 structure

### 7.1 Real SMS OTP — the owner's P0

**BLOCKED ITEM:** Real SMS delivery.
**WHY:** No provider is configured. `[auth.sms.twilio] enabled = false`, `account_sid = ""`.
**EXACT CONFIGURATION REQUIRED:**
1. A **provider decision** — Twilio, MessageBird, Textlocal or Vonage. Not mine to make (§7 of the brief).
2. Provider credentials (e.g. Account SID + Auth Token, or a Messaging Service SID).
3. **Indian DLT registration**: entity registration, **header/sender ID**, and a **registered content template** with its template ID. An OTP body must match a registered template or the carrier drops it. This is a regulatory step with an external lead time — weeks, not minutes — and **no engineering work shortens it**.
**WHERE IT MUST BE CONFIGURED:** Supabase staging project auth settings / secret storage. Never in git, never in the APK.
**ALREADY COMPLETE:** The entire OTP flow — send, verify, resend timer, expiry, rate-limit handling, error mapping, E.164 normalisation, session creation, role resolution. It is exercised daily against staging via fixed test OTPs.
**REMAINS TO VERIFY:** That a real SMS arrives on a real handset, and delivery latency.

### 7.2 Google OAuth

**BLOCKED ITEM:** Google sign-in.
**WHY:** No `[auth.external.google]` block exists on the project.
**EXACT CONFIGURATION REQUIRED:** Google Cloud OAuth clients — **Web** (for the Supabase callback), **Android** (requires the **SHA-1 of the signing key**, which for a distributable build means an upload keystore that does not yet exist), and **iOS** (bundle id `com.craavee.app`). Then client id + secret into staging secret storage, and `https://awahemlbgmymahpvhczk.supabase.co/auth/v1/callback` registered as an authorised redirect.
**WHERE:** Google Cloud Console + Supabase auth settings.
**ALREADY COMPLETE:** The app declares the `craavee://` scheme; the entry screen has a reserved slot directly beneath the primary action.
**REMAINS TO VERIFY:** Native round trip, web callback, session, role routing.

### 7.3 Username

**BLOCKED ITEM:** Username sign-in.
**WHY:** No username column exists, and the naive client-side lookup is a user-enumeration oracle.
**MINIMUM SECURE DESIGN (unchanged, still not built):** `profiles.username citext unique` (nullable); a `SECURITY DEFINER` RPC that performs sign-in server-side and returns only success/failure — **never the mapped identity**; RLS preventing anon from selecting the column; rate limiting equal to OTP's, or the RPC becomes a slower oracle.
**WHY NOT NOW:** It is a schema change plus a product question — what a username *is* for a product whose identity is a phone number, and what happens at signup. Password landed first because it needed neither.

## 8. Test matrix

| Flow | Android | iOS | Web | Staging |
|---|---|---|---|---|
| Cold unauthenticated launch → entry | PASS (prev) | UNVERIFIED | UNVERIFIED | PASS |
| Entry screen | PASS (prev) | UNVERIFIED | UNVERIFIED | PASS |
| Phone OTP (test OTP) | PASS (prev) | PASS (prev) | PASS (prev) | PASS |
| **Real SMS OTP** | **BLOCKED** | BLOCKED | BLOCKED | **BLOCKED** |
| **Password enrolment** | *see §9* | UNVERIFIED | UNVERIFIED | **PASS (probe)** |
| **Password sign-in** | *see §9* | UNVERIFIED | UNVERIFIED | **PASS (probe)** |
| **Password token carries role** | — | — | — | **PASS (probe)** |
| **Wrong password rejected** | *see §9* | UNVERIFIED | UNVERIFIED | **PASS (probe)** |
| **Recovery via code** | *see §9* | UNVERIFIED | UNVERIFIED | PASS |
| Username sign-in | **BLOCKED** | BLOCKED | BLOCKED | BLOCKED |
| Google | **BLOCKED** | BLOCKED | BLOCKED | BLOCKED |
| Signup (genuinely new user) | **UNVERIFIED** | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Customer / Runner / Store / Admin routing | PASS (prev) | UNVERIFIED | n/a | PASS |
| Wrong-role denial | PASS (prev) | UNVERIFIED | UNVERIFIED | PASS |
| Session restore | PASS (prev) | PASS (prev) | UNVERIFIED | PASS |
| Logout → entry | PASS (prev) | UNVERIFIED | UNVERIFIED | PASS |

"(prev)" = validated earlier in this stack, unchanged here. Nothing is
marked PASS because a screen rendered.

Per §52 the distinction is kept explicit:

- **Phone OTP UI:** IMPLEMENTED · **SMS provider:** BLOCKED · **Real SMS delivery:** UNVERIFIED
- **Password UI:** IMPLEMENTED · **Password mechanism:** VERIFIED on staging · **Password on device:** see §9
- **Google UI:** NOT BUILT · **Google provider:** BLOCKED · **Google sign-in:** UNVERIFIED
- **Username:** NOT BUILT · **BLOCKED** on schema + product decision

## 9. Device validation — NOT DONE, and why

**The physical device disconnected mid-phase.** `adb devices` returns an
empty list and macOS reports no vivo device on USB. The APK built
successfully and was **not** installed or launched.

**Therefore every on-device password row in §8 is UNVERIFIED, not PASS.**
The screens compile, typecheck, lint clean and are wired into navigation —
but nobody has tapped them. That is a different claim from "it works", and
this document does not make the stronger one.

**What IS verified, and it is the substantive part:** the credential
*mechanism* was proven against the real staging project by direct probe
before any UI existed (§3) — enrolment, sign-in, identity equality, role
claim on the password path, and rejection of a wrong password. The UI is a
thin layer over calls whose behaviour is established.

**APK built (not installed):**

| Field | Value |
|---|---|
| Path | `apps/customer-runner/android/app/build/outputs/apk/release/app-release.apk` |
| SHA-256 | `d8d60347b52c0c108fe220269cb0eeaad6cba2801a392d973f64a5836a521844` |
| Package / version | `com.craavee.app` / 1.0.0 |
| Build | `assembleRelease`, `BUILD SUCCESSFUL in 41s` |

**To finish this:** reconnect the phone and run — entry → "Sign in with a
password" → wrong password (expect the non-enumerating message) → back →
code sign-in → Account → Password → set one → sign out → sign in with it →
confirm Customer Home. Roughly five minutes with the device attached.

## 10. Known limitations

- **Signup as a genuinely new user is still UNVERIFIED.** Every test-OTP
  number already has a seeded profile, so "new account creation" cannot be
  exercised without either a real SMS provider or another test number
  added to the pushed staging config.
- **Account linking (§36) not addressed.** No second identity provider
  exists yet, so there is nothing to link. When Google arrives, whether a
  Google identity and a phone identity for the same person are one account
  is a product decision, not a default to accept silently.
- **Rate limiting was not modified.** Existing OTP limits are intact; no
  password-specific throttle was added beyond what the provider enforces.
  Worth revisiting if password sign-in sees real traffic.
- **iOS and web were not re-validated** for the password screens.
- **No performance measurements** were taken this run.

## 11. Next

**Username** is the only remaining auth method that is buildable without
an external dependency, and it now has a clear predecessor: the password
model exists, so a username becomes an alternative *lookup* for the same
credential rather than a new identity system. It still needs the schema
change and the product question in §7.3 answered first.

Everything else waits on the owner: a provider decision for SMS, and
OAuth clients for Google.
