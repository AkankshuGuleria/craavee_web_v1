# Phase 10E — Customer Entry Experience & Launch State Machine

**Branch:** `feat/customer-entry-experience`
**Date:** 2026-09-05
**Backend changes:** zero.

---

## 1. The brief's central premise, tested

> "Craavee currently opens too directly into an application surface such
> as Orders/Home"
> — and §28: "DO NOT RESTORE ORDERS AS DEFAULT"

**This was tested on the physical device and it is not what the current
build does.**

Method, on the standalone release APK with Metro off:

1. Confirmed Craavee was foreground.
2. Tapped the **Orders** tab; confirmed "Your orders" was showing.
3. `am force-stop com.craavee.app`.
4. `am start -n com.craavee.app/.MainActivity`.
5. **Result: Customer Home.**

Expo Router's `Tabs` defaults to its `index` route on a fresh process, and
nothing in the app persists or replays the last tab. §28's requirement was
already satisfied before this phase began.

**The first run of this test was invalid and is recorded as such.** The
"switch to Orders" tap landed while Craavee was not yet foreground, so the
tap went to a different app and the app was never actually left on Orders.
The test was redone with an explicit foreground assertion before every
input. Only the second run is evidence.

### 1.1 What the premise *did* correctly identify

An **unauthenticated** launch went straight to a bare phone-number field.
That is the real entry problem: it is functionally fine and tells a
first-time visitor nothing — not what Craavee is, not what it delivers,
not why they should hand over their number.

That gap is what this phase fixes.

## 2. The entry experience (§4)

`app/(auth)/welcome.tsx`. The unauthenticated destination in
`resolveRouteAccess` moved from `/(auth)/phone` to `/(auth)/welcome` — one
constant, in the one place that decides routing.

### 2.1 Every claim on the screen is true, and that shaped the design

Quick-commerce entry screens are usually built on speed promises. Craavee
can make none of them, and the brief (§4) explicitly forbids inventing
them:

| Typical claim | Why Craavee cannot say it |
|---|---|
| "10-minute delivery" | **No delivery-time SLA exists anywhere in the schema.** Nothing records a promise |
| "Free delivery" | **False.** `addresses.delivery_fee` is real and non-zero — ₹10–₹12 in current data |
| "Best prices" | No price-comparison data exists |
| "Available everywhere" | Two hostel-block zones exist |

What is true, and what the screen actually says:

| Line | Backed by |
|---|---|
| "Your campus store" | The real catalogue — 24 products, 8 categories |
| "Brought to your block" | `zones` = *Hostel Block A–C*, *Hostel Block D–F* |
| "Watch it arrive" | The real order state machine and timeline |

### 2.2 One action, not a wall of buttons (§5)

§5 asks for progressive disclosure with "Continue with phone" and
"Continue with Google". **There is no Google button**, because Google is
not configured on the Supabase project — there is no
`[auth.external.google]` block at all. §51 forbids fake Google login, and
a control that opens nothing is worse than its absence.

Likewise no "Sign in with password": passwords do not exist in this auth
model (§3 below).

The layout deliberately leaves the slot beneath the primary action for a
second method when a real one exists.

### 2.3 No invented iconography

The app ships no icon set. Three glyphs invented for three value
propositions would be decoration pretending to be information, so the
screen uses a typographic rule instead.

## 3. Authentication — what this phase could and could not do

§6 explicitly authorises changing the auth architecture, and §§40–42 say
not to stop at "blocked". Here is exactly how far each could go **without
something only the owner can supply**.

| Method | Status | What remains, and who owns it |
|---|---|---|
| **Phone OTP (test)** | **WORKING** | — |
| **Phone OTP (real SMS)** | **BLOCKED** | A provider decision (Twilio/MessageBird/Textlocal/Vonage), credentials into staging secret storage, and **Indian DLT registration** — an external regulatory lead time no engineering shortens. `[auth.sms.twilio] enabled = false`, `account_sid = ""` |
| **Google** | **BLOCKED** | Google Cloud OAuth clients — Web (for the Supabase callback), Android (needs the **SHA-1 of the signing key**, which for a distributable build means the upload keystore that does not exist yet), iOS (bundle id). Then client id/secret into staging and the redirect URI registered |
| **Password** | **NOT BUILT — needs a decision, not code** | See §3.1 |
| **Username** | **NOT BUILT — needs a decision first** | See §3.2 |
| **Password recovery** | **N/A** | Nothing to recover until passwords exist |

### 3.1 Why password was not implemented despite §6 authorising it

§6 authorises the *architecture change*. It does not make the change
safe to do blind, and two things make it more than a UI task:

1. **No existing account has a password.** Every user in staging was
   created through OTP. Enabling password sign-in does not give anyone a
   way in; it requires a credential-setting flow for existing users, which
   is itself a security-sensitive design (who may set a password, after
   what verification).
2. **It reverses a recorded decision.** `config.toml` states phone OTP is
   *the* sign-in method — "the standard Indian consumer pattern, real
   identity, no password". Reversing that is legitimate, but it brings a
   password policy, a reset flow that depends on an **email or SMS channel
   that does not currently work**, and a new breach surface.

**Password recovery cannot work without a delivery channel.** Email
signup is disabled and SMS has no provider — so a "Forgot password" flow
would have no way to reach anyone. Building the UI now would produce
exactly the dead-end control §51 forbids.

### 3.2 Username — the secure design, ready but not built

§9 and §42 are right that the naive version is unacceptable: a
client-side `username → look up identity → sign in` lets anyone probe
which usernames exist.

The minimal secure design, recorded so it can be built deliberately:

- **Schema:** `profiles.username citext unique` (case-insensitive
  uniqueness without a functional index), nullable so existing rows stay
  valid.
- **Resolution:** a `SECURITY DEFINER` RPC that takes a username and
  performs the sign-in *server-side*, returning only success or failure —
  it must never return the mapped identity, or it becomes the same oracle
  in a different coat.
- **RLS:** the column must not be selectable by anon. A customer may read
  their own; nobody may enumerate.
- **Rate limiting:** username guesses need the same treatment as OTP
  attempts, or the RPC becomes a slower oracle.
- **Product question first:** what a username *is* for a product that
  identifies people by phone number, and what happens at signup.

**It depends on passwords existing (§3.1), so it cannot precede that
decision.**

## 4. Role routing — verified previously, unchanged

Verified on the physical device in the previous phase and not modified
here: role comes from `supabase.auth.getClaims()` (server-verified JWT,
D8 hook reading `staff_roles`), `resolveRouteAccess` is the single routing
authority, customer → Customer, runner → Runner, and packer/admin →
`/unsupported-role` because **Store and Console are separate web apps**.

§13 asks for a native→web handoff for staff. **Not built.** Doing it
securely means moving a session between surfaces, and the naive versions
(token in a URL, token in a query param) are exactly what §13 forbids.
The safe options are a fresh sign-in on the web surface, or a
short-lived single-use handoff token — a backend design, not a UI change.

## 5. What was deliberately NOT touched

Per §1's "do not patch a single screen" **and** the equally important
constraint of not rewriting correct work:

- Customer Home, Search, Categories, Filters, Product Detail, Cart,
  Checkout, Orders, Tracking, Account — all built and validated in the
  preceding slices, all unchanged.
- **Wishlist** — still no backend (§19). Not faked.
- **Support** — still no backend (§24). Not faked.

## 6. Test matrix

| Journey | Android | iOS | Web | Staging |
|---|---|---|---|---|
| Cold launch unauthenticated → **entry screen** | **PASS** | UNVERIFIED | UNVERIFIED | PASS |
| Authenticated cold launch → **Home, not Orders** | **PASS** | UNVERIFIED | UNVERIFIED | PASS |
| Phone OTP (test OTP) | PASS (prev) | PASS (prev) | PASS (prev) | PASS |
| Phone OTP (**real SMS**) | **BLOCKED** | BLOCKED | BLOCKED | **BLOCKED** |
| Password login | **BLOCKED** | BLOCKED | BLOCKED | BLOCKED |
| Username login | **BLOCKED** | BLOCKED | BLOCKED | BLOCKED |
| Google | **BLOCKED** | BLOCKED | BLOCKED | BLOCKED |
| Forgot password | **N/A** | N/A | N/A | N/A |
| Signup (new user) | **UNVERIFIED** | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Customer / Runner / Store / Admin routing | PASS (prev) | UNVERIFIED | n/a | PASS |
| Wrong-role denial | PASS (prev) | UNVERIFIED | UNVERIFIED | PASS |
| Session restore | PASS (prev) | PASS (prev) | UNVERIFIED | PASS |
| Logout → entry | **PASS** | UNVERIFIED | UNVERIFIED | PASS |
| Home / Search / Categories / PDP / Cart / Checkout / Orders / Account | PASS (prev) | PASS (prev) | PARTIAL (prev) | PASS |
| Wishlist | **BLOCKED (no backend)** | BLOCKED | BLOCKED | BLOCKED |
| Support | **BLOCKED (no backend)** | BLOCKED | BLOCKED | BLOCKED |

"(prev)" = validated in an earlier slice of this stack and not re-run here.
Nothing is marked PASS because a component rendered.

## 7. External credentials still required

| Blocker | Exact requirement |
|---|---|
| Real SMS | Provider choice; credentials into staging secrets; **Indian DLT entity + template registration** |
| Google | Web + Android (SHA-1) + iOS OAuth clients; client id/secret into staging; redirect URI registered |
| Password | A **product decision** to reverse the OTP-only model, **plus** a working delivery channel for recovery (which needs the SMS blocker cleared first) |
| Username | Depends on the password decision; then the schema + RPC in §3.2 |
| Distribution | A real upload keystore — the release build currently uses the debug keystore |

## 8. Known limitations

- **No Google or password UI shipped**, deliberately.
- **Signup as a genuinely new user remains UNVERIFIED** — every test-OTP
  number already has a seeded profile.
- **iOS and web not re-validated** for the entry screen this run.
- **No performance measurements** taken this run; no timing claim is made.
- This phase did **not** deliver "the complete experience". It fixed the
  entry gap and disproved the Orders-default premise.

## 9. Next phase

The next genuinely unblocked work is **CX-E₂: the address book** (edit,
delete, default) — the `addresses` table already has `select`, `insert`
and `update` policies, so it needs no backend change and closes the last
add-only dead end in the purchase path.

Everything else of substance now waits on an owner decision or an external
credential, listed in §7.
