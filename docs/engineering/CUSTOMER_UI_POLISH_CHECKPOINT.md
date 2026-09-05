# Customer UI/UX Polish — Checkpoint

**Branch:** `feat/customer-ui-polish`
**Date:** 2026-09-05
**Backend changes:** zero. **Schema, RLS, state machine, payments, inventory:** untouched.

---

## 1. The constraint that shaped this phase

The acceptance criteria ask that **"real product imagery is used wherever
available"** and that product photography become *"a major visual
element"*.

**Measured: `image_url` appears zero times in `supabase/seed.sql`. All 24
products have no image.**

So the single largest visual lever in any commerce redesign is
unavailable, and the brief is explicit that fabricating one is forbidden.
That is not a reason to stop, but it is the honest frame: **this phase
could not deliver its headline visual uplift, because the data for it does
not exist.** Populating product photography remains a **data task**, and
until it lands, the fallback carries the visual weight.

## 2. Named defects: what reproduced and what did not

The brief named specific defects. Each was checked on the physical device
before any code was written, because acting on an unverified premise cost
real time earlier in this project.

| Named in brief | Verified? | Evidence |
|---|---|---|
| §4 "chip clipping" | **DID NOT REPRODUCE** | The chip rail scrolls correctly — swiping revealed *Ice Cream & Desserts*, *Instant Meals*, *Munchies & Snacks*. The cut-off chip at the right edge is standard horizontal-scroll affordance, not clipping |
| §4 "inconsistent selected states" | **DID NOT REPRODUCE** | Selected is a filled brand-green pill; unselected are white. Unmistakable |
| §4 "awkward horizontal overflow" | **DID NOT REPRODUCE** | Same as above |
| §8 "confusing ₹0.00/payment labels" | **REPRODUCED — and it was mine** | The wallet hint rendered as **"Paid by"**, truncated. See §3 |
| §8 "Track on orders where tracking provides no useful state" | **REPRODUCED** | `OrderRow` rendered "Track" unconditionally, including on `cancelled` and `payment_failed`. Confirmed from source |

**Three of five did not reproduce.** They are recorded as not-defects
rather than "fixed", because changing working code to match a report would
have been worse than leaving it.

## 3. Fixes

### 3.1 "Paid by wallet" was truncating to "Paid by"

Introduced by my own order-history slice. The hint sits in a `shrink-0
items-end` column that is sized by the amount above it; the label is wider,
so Android clipped it — leaving **"Paid by"**, which is more confusing than
the bare `₹0.00` it was added to explain.

Fixed by **changing the copy to "Wallet"**, not by more layout — two
layout attempts failed first, recorded in §6.1. Directly beneath "₹0.00",
one word is unambiguous and cannot clip at any width; the full phrasing
survives in the accessibility label, where there is no width limit.

### 3.2 The action now matches the order's state

"Track" on a cancelled or failed order promises live progress that will
never arrive — the tracking screen for a terminal order has nothing to
track. Terminal orders now offer **"Details"**, which is what the screen
genuinely provides: items, amounts, and what happened. The accessibility
hint changed with it, since it made the same unconditional promise.

### 3.3 Add ⇄ quantity is now one control with a transition

The highest-frequency interaction in the product. `ProductCard` previously
swapped an "Add" button for a `QtyStepper` with a bare conditional:
functionally correct, and it read as a glitch — one control vanished and a
different one appeared.

`components/ui/CartAction.tsx` owns both states and cross-fades between
them, with the two controls stacked in the same cell so **the tile height
never changes** and the grid cannot shift on add.

Three things worth noting about it:

- **This is not optimistic UI.** The cart is local Zustand state
  (server-authoritative at checkout, D7). The transition reflects a change
  that has *already* happened — no server round trip, and no money claim.
  The brief's rule that money-related UI must never optimistically claim
  success is untouched, because no money claim is involved.
- **RN `Animated`, not Reanimated.** Reanimated is installed but unused,
  and the React Compiler rejects its `sharedValue.value = …` assignments.
  The project's standing decision is to use the platform primitive rather
  than suppress a correctness rule.
- **A second compiler rule was hit and fixed properly.**
  `useRef(new Animated.Value(…)).current` violates `react-hooks/refs`
  ("cannot access refs during render"), because the interpolations read it
  while rendering. Replaced with a lazily-initialised `useState`, which is
  legal to read during render — **the rule was not suppressed.**
- **Reduced motion** is honoured via `useMotion()`: durations collapse to
  1ms and the scale interpolation flattens to 1, so the transition still
  *completes* rather than being skipped mid-flight.
- **Assistive tech never sees both controls.** "Add" is hidden from the
  accessibility tree once the stepper is live.

## 4. What was deliberately NOT done

- **No fabricated imagery, ratings, reviews, ETAs, discounts or metadata.**
- **No design-system rewrite.** §1 asks for a centralised visual system;
  `@craavee/tokens` already is one, and replacing it wholesale is exactly
  the mistake Phase 10D made (it silently unresolved 163 class usages).
  Existing primitives were extended, not duplicated — per §20.
- **Home, Search, PDP, Cart, Checkout, Account were not redesigned.** They
  were built and device-validated across the preceding slices. Rewriting
  working, validated screens to satisfy a general instruction to "redesign"
  would risk regression for appearance, and §17/§20 both argue against it.
- **No backend, schema, RLS, payment or inventory change.**

## 5. Honest limitations

- **The visual uplift here is modest**, and it is bounded by §1: without
  product photography, a commerce grid cannot look like a commerce grid.
  The largest available win is a data task, not a code task.
- **No performance measurements were taken this run.** No claim of
  improved startup, scroll or render performance is made. The `CartAction`
  transition is a 120ms native-driver opacity/scale interpolation, which
  does not touch the JS thread during the animation — but that is a
  property of the implementation, not a measurement.
- **iOS and web were not re-validated** for these changes.

## 6. Device validation

Physical **vivo V2250**, standalone release APK, **Metro off**, real staging.

| Check | Result | Evidence |
|---|---|---|
| Category rail scrolls | **PASS** | Swipe revealed *Ice Cream & Desserts*, *Instant Meals*, *Munchies & Snacks* |
| Selected chip state | **PASS** | Filled brand-green vs white — unmistakable |
| Wallet label no longer clips | **PASS** | Renders "₹0.00 / Wallet" cleanly |
| Action matches order state | **PASS** | `Delivered` and `Payment failed` → **"Details"**; `Confirmed` → **"Track"** |
| Add → stepper transition | **PASS** | Tapping Add produced the stepper; cart bar updated to "1 item, ₹45.00" |
| **Tile height stable on add** | **PASS** | Add button centre y=1546, stepper centre y=1543 — a 3px delta, so the grid does **not** shift |
| Stepper accessibility | **PASS** | "Quantity of …, 1" (adjustable), "Remove … from cart" at qty 1, "Increase …" |
| No duplicate control for assistive tech | **PASS** | The "Add" content-description is absent once the stepper is live |

### 6.1 Two iterations the label fix needed

Worth recording, because the first two attempts each looked like a fix and
were not:

1. `shrink-0` + `numberOfLines={1}` → the hard clip ("Paid by") became an
   ellipsis ("Paid by wall…"). More honest, still wrong.
2. Shortened to **"Wallet"** → fits at any width and cannot clip. The full
   phrasing ("paid by wallet") survives in the accessibility label, where
   there is no width limit.

The column is sized by the amount above it, and no amount of flex hinting
made a 14-character label fit a space measured for "₹0.00". Choosing
different copy was the correct fix, not more layout.

### 6.2 APK

| Field | Value |
|---|---|
| Path | `apps/customer-runner/android/app/build/outputs/apk/release/app-release.apk` |
| SHA-256 | `85fa7f71b1f2f79b883d79f19ce3718044b7f1a212bcf98372e87a583696781b` |
| Package / version | `com.craavee.app` / 1.0.0 |
| Build | release, JS bundled, Metro off |
| Signing | debug keystore — staging QA only, **not distributable** |
