# Phase 10C — External Integrations

---

## 0.1 Correction (2026-09-05) — the `adb` claim in this document was wrong

This checkpoint stated in two places that **"`adb` is not installed."** That
was incorrect.

`adb` **is** installed, at:

```
~/Library/Android/sdk/platform-tools/adb
```

It is simply **not on `PATH`**, so a bare `adb` invocation returns
`adb not found`. I concluded absence from that failure without checking the
SDK location. Verified on 2026-09-05: Android Debug Bridge 1.0.41,
platform-tools 37.0.1.

**What this does and does not change.** It does not change any Razorpay,
Sentry, SMS or EAS conclusion in this document — those were blocked on
credentials and provider decisions, not on tooling. It does mean the
*stated reason* for the handset blockers was partly wrong: the real and
sufficient blocker was that **no physical device was attached**, which was
true at the time.

Android's own row is also superseded. "Android against staging — BLOCKED,
needs a development build, i.e. EAS" conflated two things: Expo Go could not
run the app, and EAS was assumed to be the only route to a development
build. A **local** `npx expo run:android` build needs no EAS. See
`PHASE_10E_CUSTOMER_EXPERIENCE_CHECKPOINT.md` for the current status.

Device identification note: the phone reports `ro.product.model=V2250` and
`ro.product.name=V2250i`. It exposes **no** marketing-name property
(`ro.vivo.market.name` is empty), so any "vivo V29" label is the owner's
identification, not the device's self-report. Measured values are used
throughout.

---


**Branch:** `feat/external-integrations-10c`
**Base `main`:** `68e87d1623322b79eb3637f40178951fba425c62`
**Date:** 2026-09-04

Status vocabulary, used strictly and never blurred:
**IMPLEMENTED** · **MOCK VERIFIED** · **STAGING VERIFIED** ·
**REAL EXTERNAL VERIFIED** · **REAL DEVICE VERIFIED** · **BLOCKED** ·
**UNVERIFIED** · **DEFERRED**

---

## 1. Integration matrix

| Integration | Status | One-line basis |
|---|---|---|
| **Razorpay — order creation** | **REAL EXTERNAL VERIFIED** | `create_order` Phase B calls Razorpay's API; real order refs returned |
| **Razorpay — payment capture** | **REAL EXTERNAL VERIFIED** | 5 real Test Mode payments; 4 captured |
| **Razorpay — webhook + signature** | **REAL EXTERNAL VERIFIED** | Razorpay-originated events verified and processed |
| **Razorpay — failure matrix** | **REAL EXTERNAL VERIFIED** | 7 cases, no state mutation from any |
| **Razorpay — late capture (D36)** | **REAL EXTERNAL VERIFIED** | Deliberately reproduced with a real post-expiry capture |
| **Gateway refunds** | **DEFERRED BY DECISION (D38)** | No refund method on the adapter; refunds are wallet-only |
| **Cross-role flow on staging** | **STAGING VERIFIED** | Razorpay-paid order driven to `delivered` across all four roles |
| **iOS against staging** | **STAGING VERIFIED (simulator)** | Real staging auth + catalog |
| **Android against staging** | **BLOCKED** | App cannot start in Expo Go — needs a development build, i.e. EAS |
| **Sentry** | **BLOCKED** | No DSN supplied |
| **EAS / push credentials** | **BLOCKED** | No Expo token; no `eas.json`; no `extra.eas.projectId` |
| **Real handset push** | **BLOCKED** | No physical device attached (0 iOS). ~~no `adb`~~ — **corrected 2026-09-05, see §0.1** |
| **Notification tap** | **BLOCKED** | Depends on the above |
| **Real SMS OTP** | **BLOCKED** | **No provider has been chosen in any authoritative document** |

---

## 2. Razorpay configuration — and what we actually learned

Credentials live only in staging Edge Function secrets. Nothing is in the
repository, the app bundle, or any browser-reachable surface.

### 2.1 The secret model (§3) — evidence, not assumption

**Razorpay signs webhooks with the API key secret on this account, not
with a distinct webhook secret.**

That is not a guess. Deliveries were failing signature verification, so a
temporary probe recorded, per request, the received signature alongside
the one we computed. Every pair differed. A real captured request was
then tested offline against candidate keys:

```
✅ MATCH  key = RAZORPAY_KEY_SECRET
```

A distinct webhook secret was entered in the dashboard **twice** and
neither took effect — Razorpay continued signing with the API key secret.

| Question | Answer |
|---|---|
| Which secret does Razorpay sign with? | the **API key secret** |
| Which does Craavee verify with? | the same value, stored as `RAZORPAY_WEBHOOK_SECRET` |
| Can a distinct one be configured? | **NO, on the evidence available — outcome B.** The dashboard offers the field and two save attempts did not change the signing key. The webhook-edit and delivery-history APIs both return `404 no Route matched` on a standard account, so this cannot be pursued further without Razorpay support |
| What should production use? | a **distinct webhook secret**, if this account can be made to honour one |

**A consequence worth stating plainly: rotating the Razorpay API key also
rotates webhook verification.** Those are one credential today, and the
runbook says so.

### 2.3 Merchant display name — CORRECTED FINDING

An earlier note in this phase said the checkout displayed **"SAGAR
TAILOR"** instead of Craavee. **That was wrong, and the correction
matters** because it changes both the severity and the owner.

Verified with a fresh Test Mode checkout, screenshotted at each step:

| Surface | Shows | Controlled by |
|---|---|---|
| Razorpay Checkout / hosted payment page | **"Craavee"**, "Craavee order payment" | `buildCheckoutParams` sends `name: "Craavee"` — correct |
| **Bank 3-D Secure OTP page** | **"Paying to SAGAR TAILOR"** (Axis Bank, MasterCard SecureCode) | the Razorpay account's **registered business name**, passed to the card network |

So Craavee's own branding is right everywhere it controls. The other name
is the merchant descriptor the acquiring bank receives — the same string
that appears on a customer's card statement. It comes from the Razorpay
account's KYC/business profile and **cannot be set from our code or from
checkout options**.

The standard-account API does not expose the merchant profile
(`/v1/account` returns an HTML dashboard page, not JSON), so this is an
**owner action in the Razorpay dashboard**, not an engineering change.

**Status: cosmetic, customer-visible, OWNER DECISION.** Not a launch
blocker for correctness; worth fixing before real customers pay.

### 2.2 Diagnosis path (why this took several attempts)

Worth recording because each step eliminated a hypothesis:

1. Payments captured at Razorpay, order stayed `created` → the client
   callback is correctly not authoritative.
2. Our endpoint answered a self-signed request `200` → our HMAC and our
   secret agree.
3. A probe showed **12 inbound requests with `User-Agent:
   Razorpay-Webhook/v1`** → Razorpay *was* reaching us; "not firing" was
   wrong.
4. Signature-prefix comparison → key mismatch, not algorithm or bytes.
5. Offline candidate test → the key is the API key secret.

---

## 3. Secret rotation and hygiene (§2, §20)

A 32-character webhook secret generated during diagnosis was printed to
the user's terminal and pasted into the conversation. It was **already
inert** by then — the working configuration uses the API key secret.

Verified after cleanup:

| Check | Result |
|---|---|
| Exposed value set on staging? | **NO** |
| Exposed value in the working tree? | **NO** |
| Exposed value in git history? | **0 occurrences** |
| `RAZORPAY_WEBHOOK_SECRET` == `RAZORPAY_KEY_SECRET` on staging | **true** (matches how Razorpay signs) |
| Repository secret scan | **clean** |

The API key secret itself was **never** exposed — it was not printed and
does not appear in the transcript.

**Not rotated, deliberately:** rotating the API key secret would rotate
webhook verification (§2.1) and break the flow just verified, to replace
a credential that was never leaked. That is a change to make with the
owner present, not silently at the end of a phase.

---

## 4. Real payment evidence — REAL EXTERNAL VERIFIED

Final clean transaction, after all secret work:

| Field | Value |
|---|---|
| Craavee order | `1ee69b5f-1767-4cf3-bcf7-da1788420a65` |
| Razorpay order | `order_TXzpitIFAvgR49` |
| Razorpay payment | `pay_TXzquQIKcJ8luK` |
| Webhook event id | `TXzrP9apZCyLTX` |
| Final payment state | `captured` |
| Final order state | `confirmed` → later `delivered` |
| Time to confirmation | **< 15 s** from payment |

Five real Test Mode payments were made in total; four captured, one
declined by Razorpay because the card was international.

## 5. Webhook evidence

`webhook_events` rows carry Razorpay's own event ids
(`TXzrP9apZCyLTX`, `TXzrOs43jpAtbP`) with `processed_at` set. The
signature was verified against the raw body **before** any parse.

---

## 6. Failure matrix (§5) — REAL EXTERNAL VERIFIED

Run against the deployed staging endpoint using a real captured payment
as the payload shape.

| # | Case | Result |
|---|---|---|
| A | invalid signature | **403** |
| B | missing signature | **403** |
| C | payload modified after signing | **403** |
| D | amount mismatch (validly signed, new event id) | **200 ack**, audited `payment.amount_mismatch`, **not confirmed** |
| F | unknown gateway order | **200 ack**, audited `payment.webhook_unknown_order` |
| G | duplicate (same event id twice) | **200**, exactly **1** `webhook_events` row |
| I | international card declined | real Razorpay decline; order untouched |
| J | gateway unreachable / no credentials | fails closed (`PAYMENT_SETUP_FAILED`) |

**State before matrix == state after matrix.** No failure case mutated
anything.

**E — currency mismatch: NOT EXERCISABLE, and this is a finding.**
`process_payment_webhook` implements a currency check, but
`payment_webhook/handler.ts` passes `p_currency: "INR"` as a literal
because `NormalizedPaymentEvent` carries no currency field. The guard can
therefore never fire from the real path. Low risk today — Craavee creates
every Razorpay order as INR and Razorpay enforces payment/order currency
agreement — but the check is dead code as wired, and a multi-currency
future would silently lose it. Recorded, not fixed: changing the D12
adapter interface is out of 10C scope.

---

## 7. Late capture (D36) — REAL EXTERNAL VERIFIED

Deliberately reproduced, not observed by accident.

1. Real order created (`order_TY1Nz2jJUXWbpN`).
2. `reservation_expires_at` backdated one minute — **the only simulated
   element**, and it only moves a clock; the expiry itself was performed
   by the real `pg_cron` sweep.
3. Sweep expired it: order `payment_failed`, payment `failed`.
4. **A real Razorpay Test Mode payment was then made against the
   still-payable gateway order** — a genuine late capture.
5. Razorpay's real webhook arrived and reconciled it.

| Assertion | Result |
|---|---|
| Order resurrected? | **NO** — stayed `payment_failed` |
| `refunded_amount` | **5500** (full) |
| Refund row | 1, reason `late_capture_reconciliation` |
| Gateway refund ref | **null** — wallet-only, per D38 |
| Wallet ledger | `+5500`, reason `refund` |
| Inventory resurrected? | **NO** — `qty_reserved` unchanged |
| `raw_event` stored | yes, redacted at write time (D32) |
| Duplicate financial mutation | none |
| Audit | `payment.late_capture_reconciled` |

**A test-setup note, stated rather than hidden.** Mid-phase the wallet
invariant `wallet_balance == sum(wallet_ledger.delta)` failed. The cause
was mine: I ran `update profiles set wallet_balance = 0` four times to
force `payable > 0` for gateway testing, bypassing the money functions.
The ledger was coherent throughout. Reconciled afterwards; the invariant
now passes for every profile. This is exactly the denormalisation the
Phase 10A runbook warns about.

---

## 8. Refund behaviour (§7) — DEFERRED BY DECISION

D38 makes refunds **wallet-only**. `PaymentGatewayAdapter` has **no
refund method at all**, so a Razorpay gateway refund is not part of the
current contract and nothing here invented one.

- Wallet refund path: **STAGING VERIFIED** (exercised by the D36 flow)
- Razorpay gateway refund: **DEFERRED** — needs a D12 interface addition
  and a product decision

Razorpay's dashboard shows `Refunds ₹0.00 / 0 processed`, consistent with
an architecture that never calls their refund API.

## 9. Client callback authority (§8) — REAL EXTERNAL VERIFIED

Proven twice, and once by accident, which is the strongest form:

- After a successful Razorpay payment **and** a successful browser
  callback, the Craavee order remained `created` / `pending` for over an
  hour while webhook delivery was broken.
- It moved only when a signature-verified webhook was processed.

A payment is confirmed by the server, or not at all.

## 10. Payment concurrency (§9) — REAL EXTERNAL VERIFIED

Five genuinely parallel deliveries of one signed event:

```
200 200 200 200 200   →  webhook_events rows for that id: 1
                         refunds total: unchanged
```

`webhook_events (gateway, gateway_event_id)` with `on conflict do
nothing` holds under real parallelism.

---

## 11. Cross-role staging run (§10–15) — STAGING VERIFIED

Driven on the **Razorpay-paid** order across four real staging sessions.

| Step | Result |
|---|---|
| Customer sees the confirmed order (D20 poll) | `confirmed / captured / 5500` |
| Order visible to packer via RLS | YES |
| `mark_packed` | 200 `packed` |
| `claim_job` | 200 `assigned` |
| `mark_picked_up` | 200 `picked_up` |
| Admin sees the assignment | `picked_up`, correct `runner_id` |
| `mark_delivery_failed` | 200 `delivery_failed` |
| `admin_reassign` | 200 `assigned` |
| Customer reads delivery code | YES (4 digits) |
| **Runner** reads delivery code | **0 rows — D14 holds** |
| Wrong code | 400 `DELIVERY_CODE_INVALID` |
| Correct code | 200 **`delivered`** |
| Kill switch pause → order | **422 `STORE_CLOSED`** |
| Resume | 200 |

A real Razorpay payment carried an order all the way to `delivered`
through every role.

## 12. iOS validation — STAGING VERIFIED (simulator)

`Craavee_iPhone17` pointed at the staging URL: app launches, session
persists, staging catalog renders with live prices (₹45.00, ₹85.00,
₹38.00, ₹19.00, ₹29.00).

## 12.1 Android — BLOCKED, with a specific cause

Attempted properly rather than skipped: the existing
`Craavee_Pixel7_API36` AVD was booted (no new host tooling installed) and
`expo start --android` run against staging. **The app does not start on
Android in Expo Go:**

```
ERROR expo-notifications: Android Push notifications (remote
notifications) functionality provided by expo-notifications was removed
from Expo Go with the release of SDK 53. Use a development build instead.
→ TypeError: Cannot read property 'ErrorBoundary' of undefined
```

On iOS the same SDK-53 change is only a **warning** and the app runs; on
Android it **throws**, and the throw happens early enough to take the
root layout's error boundary with it.

**This is the same blocker as push, not a separate one.** A development
build requires EAS, EAS requires an Expo project, and that is item 5 in
§19. Android is therefore **BLOCKED on EAS**, not merely unverified —
and no amount of emulator work will move it until that account exists.

The emulator was shut down afterwards to free resources. Nothing was
installed on the host.

---

## 13. Blocked integrations — with exactly what is missing

| Integration | Missing |
|---|---|
| **Sentry** | A staging DSN. Nothing was configured; **no event has ever been ingested.** |
| **EAS / push credentials** | An Expo account or `EXPO_TOKEN`. There is still no `eas.json` and no `expo.extra.eas.projectId`, so `getExpoPushTokenAsync()` cannot mint a token. |
| **Real handset push** | A physical device. `xcrun devicectl` lists **0**. (~~`adb` is not installed~~ — **incorrect, corrected 2026-09-05; see §0.1**.) §14/§15 require a real handset, and a simulator does not substitute. |
| **Notification tap** | Depends on the above. |
| **Real SMS** | **A provider decision.** No authoritative document names one — the docs list Twilio/MessageBird/Textlocal/Vonage as options. Per §10 and §18 none was invented. Staging still uses fixed test OTPs. |

10B's dispatcher work is unaffected and remains **STAGING VERIFIED**: the
queue drains, the provider answers, dead tokens are removed. **That is
still not handset delivery.**

---

## 14. Environment safety (§21, §22)

| Invariant | Evidence |
|---|---|
| Test Mode only | key id starts `rzp_test_`; asserted before any payment |
| No live money | Razorpay dashboard: 4 captured payments, all Test Mode, ₹55 each |
| Mock gateway impossible on staging | `CRAAVEE_ENV=staging` + no `CRAAVEE_ALLOW_MOCK_CONTROL`; a non-wallet order without credentials returns `PAYMENT_SETUP_FAILED` |
| Production fails closed | unchanged from Phase 5; no live credentials exist anywhere |
| No secrets in client bundles | apps read only `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` |
| Staging ≠ production | production still does not exist |

## 15. Diagnostics removed (§30)

The temporary probe added to `payment_webhook` during diagnosis is gone:
`git diff` against `main` for that file is **empty**, the function was
redeployed from the restored source, and the `_webhook_probe` table
(which briefly held request bodies and signatures) was **dropped**.

---

## 16. Test matrix

| Suite | Result |
|---|---|
| pgTAP | **596 assertions, 19 files, 0 failed** |
| Integration | **223 / 223**, 0 skipped, 0 todo |
| Gateway (Deno) | **9 / 9** |
| Unit | **44 / 44** |
| Typecheck | 0 errors |
| Lint | **0 errors** (2 pre-existing `packages/ui` warnings) |
| `functions:check` | exit 0 |
| Store + Console build | ✓ both |

No new automated tests were added: everything verified here required the
real external provider, and a mocked version would assert less than the
existing suites already do while implying external coverage that does not
exist.

## 17. Performance observations

Real staging, single runs. Observations, not KPIs.

| Path | Observed |
|---|---|
| `create_order` incl. Razorpay round trip | ~1.5–2 s |
| Razorpay checkout page load | ~1–2 s |
| **Payment → order confirmed by webhook** | **< 15 s** |
| Webhook signature verify + process | sub-second |
| Late-capture reconciliation | < 15 s |
| Function endpoint reachability | 448 ms, TLS, Cloudflare edge |

---

## 18. Remaining launch blockers

1. **Real SMS — BLOCKED on a provider decision.** Nothing else about it
   can proceed.
2. **Real handset push — BLOCKED** on an Expo account, APNs/FCM
   credentials and a physical device.
3. **Sentry — BLOCKED** on a DSN; no event has ever been ingested.
4. **Distinct Razorpay webhook secret** — unresolved; today the API key
   secret doubles as the webhook key.
5. **Bank 3-D Secure page and card statements show "SAGAR TAILOR"** — the
   Razorpay account's registered business name. **Not** the checkout,
   which correctly shows Craavee (§2.3). Fixed in Razorpay account
   settings / KYC, not in code. Cosmetic but customer-visible.
6. **Currency-mismatch guard is unreachable** (§6E).
7. **Gateway refunds** deferred by D38.
8. **Android — BLOCKED on EAS.** The app throws on start in Expo Go (SDK 53 removed `expo-notifications` remote push there); it needs a development build. Same root cause as push.
9. **No production environment**, no Vercel, backups unscheduled — from
   10A, unchanged.
10. **Runner earnings formula — still BLOCKED.**

---

## 19. Owner decisions required (§17)

None of these were resolved here, and none should be resolved by
engineering alone.

| # | Decision | Why it is yours | What it blocks |
|---|---|---|---|
| 1 | **SMS provider** | No authoritative document names one; the docs list Twilio / MessageBird / Textlocal / Vonage as options. Cost, deliverability and Indian DLT registration are commercial choices | **All of real SMS.** Nothing downstream can start |
| 2 | **Dedicated Razorpay webhook secret** | Two dashboard attempts did not take effect and the API cannot be used on a standard account; this needs Razorpay support | Removes the "API-key rotation also breaks webhooks" coupling |
| 3 | **Razorpay registered business name** | It reads "SAGAR TAILOR" on the bank 3-D Secure page and on card statements (§2.3). Changing it is a KYC/business-profile action | Customer trust at the moment of payment |
| 4 | **Production Razorpay account** | Live keys need merchant KYC | Any real money |
| 5 | **Expo / EAS account** | An organisation account and its ownership | Push, TestFlight, Play |
| 6 | **Apple Developer + Google Play** | Paid enrolments | Real-device distribution |
| 7 | **Sentry project + plan** | A staging DSN, at minimum | All error visibility |
| 8 | **Runner earnings formula** | Still undecided since Phase 9A | `settle_runner_earnings`, any payout |

## 20. Phase 10D

Design-system foundation — one token source, then promoting the
Console's `lib/admin/ui.tsx` primitives so the Store can use them — then
the Customer / Runner / Store / Admin UI work. **Not started.**

---

**No live money was processed. No production credentials were used.
Phase 10D has NOT started. The frontend redesign has NOT started.
Design-token work has NOT started. No unrelated project was touched.**
