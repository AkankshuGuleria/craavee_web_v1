# Craavee — Customer Experience Master Plan

**Date:** 2026-09-05
**Status:** Audit and plan. One implementation slice selected; the rest is planning.

This document is the reference research, the journey map, the information
architecture and the phased plan. It is **not** a claim that any of it is
built. What is built is recorded in
`CUSTOMER_EXPERIENCE_CURRENT_STATE.md`.

---

## 1. Reference research — method and its limits

Four products were researched: **Amazon, Blinkit, AJIO, Tata CLiQ**.

**An honest limitation up front.** The brief asks to prioritise official
product and help pages. Amazon's help pages (`amazon.com/gp/help/...`)
return **HTTP 503 to automated fetches**, so the Amazon findings below
come from search-result summaries and secondary sources, **not** from
reading the official pages directly. Tata CLiQ's help and track-order
pages are publicly indexed and their structure is reflected below. No
screenshots were captured, and **no proprietary copy is reproduced** —
what follows are structural patterns and principles.

### 1.1 Amazon

| | |
|---|---|
| **Does well** | "Your Orders" is a first-class destination reachable from the profile tab, not buried in settings. Orders are **searchable and filterable by date range and order type** — the recognition that order history is a *retrieval* problem, not just a list. Returns and refunds are tracked **from inside the order**, so the customer never has to find a separate "returns" area. |
| **Feels slow / cluttered** | The account area is an enormous grid of tiles; finding a specific capability is a scanning exercise. Order cards carry many competing actions. |
| **Friction** | Support is reached through a deep self-service tree; the path from "problem with this order" to "help about this specific thing" is long. |
| **Borrow as principle** | **Order history is a destination, and support is contextual to an order** — not a separate silo. |
| **Avoid** | The tile-grid account screen. Craavee has far fewer capabilities and should show them as a short list, not a grid pretending to be dense. |

### 1.2 Blinkit

| | |
|---|---|
| **Does well** | Persistent **bottom navigation** with task-driven destinations. Category tabs simplify a large catalogue without a navigation round trip. Critically: **only in-stock items for the serving dark store are shown**, which removes a whole class of disappointment before it happens. Real-time order progression is the centrepiece of post-purchase. |
| **Feels cluttered** | Home carries heavy promotional density; the actual products compete with merchandising. |
| **Friction** | Category tabs plus bottom nav plus banners means several competing navigation systems on one screen. |
| **Borrow as principle** | **Availability truth before the customer commits**, and **progression as the post-purchase centrepiece**. |
| **Avoid** | Stacking three navigation systems. Craavee already shows availability honestly (`is_available` server-computed) — that is the same principle, arrived at independently. |

### 1.3 AJIO

| | |
|---|---|
| **Does well** | Wishlist is a genuine first-class destination, and the wishlist→cart conversion is a designed path rather than an afterthought. |
| **Friction** | Reported difficulty locating return/refund actions, and filters that are hard to use to narrow to a specific intent. |
| **Borrow as principle** | **A wishlist must have a designed route into the cart**, or it becomes a graveyard. |
| **Avoid** | Filters that do not visibly change the result set. Craavee's toolbar shows a live result count precisely to avoid this. |

### 1.4 Tata CLiQ

| | |
|---|---|
| **Does well** | A clearly structured help centre organised by **the customer's problem** — payments, cancellation, returns and refunds — rather than by internal department. "My Orders" is the single tracking entry point. |
| **Friction** | Support fragments into many channels and email addresses; the customer has to choose a channel before describing the problem. |
| **Borrow as principle** | **Organise support by the customer's problem, not by our org chart.** |
| **Avoid** | Making the customer pick a channel first. Craavee should let them pick the *problem* first. |

### 1.5 Craavee's own principles, derived from the above

1. **Availability truth before commitment** — never let a customer invest attention in something they cannot have.
2. **The order is the unit of post-purchase.** Tracking, support and refunds all hang off an order, not off separate silos.
3. **Support is organised by problem, never by channel or department.**
4. **Every list is a retrieval problem** once it is longer than a screen.
5. **Say what is actually known.** No fabricated ETA, popularity, or ranking. Where we do not know, say so.
6. **Fewer, calmer surfaces.** Craavee has a fraction of Amazon's capability surface and should look like it, not imitate density it does not have.

---

## 2. Complete customer journey

```
NEW USER      launch → phone → OTP → (profile) → address → Home
RETURNING     launch → session restore (SecureStore) → cached Home → continue
DISCOVERY     Home → category rail → Browse → filter/sort → Product
SEARCH        Search → debounced results → filter/sort → Product → back (state kept)
PURCHASE      Cart → Checkout (address, promo, wallet) → Razorpay → webhook → confirmed
POST-PURCHASE Order → tracking → packed → assigned → picked up → delivery code → delivered
AFTER         Order history → order detail → reorder? → support? → refund → wallet
FAILURE       network / payment failed / payment pending / out of stock /
              session expired / delivery failed
```

**Where the journey currently breaks:** after `confirmed`, a customer can
watch one order they navigated to, and then the journey **ends**. There is
no way to see a past order, no way to get back to an order they closed, no
support entry, no account. That is the largest hole in the product, and it
is why the implementation slice below is order history.

---

## 3. Information architecture

Craavee has four jobs, not twelve. The IA should say so.

```
DISCOVER            Home · Search · Browse(category, filters, sort)
BUY                 Product · Cart · Checkout · Payment
TRACK               Order detail · timeline · delivery code
MANAGE              Orders · Account (profile, addresses, wallet, support)
```

### 3.1 Navigation recommendation

**Recommended: a 4-tab bottom navigation — Home · Orders · Cart · Account**
— adopted in a later slice, not this one.

Reasoning, and the honest counter-argument:

- Craavee's post-purchase journey is currently unreachable. A tab is the
  cheapest possible fix for "I closed the app, where is my order?"
- Cart already has a persistent contextual bar; promoting it to a tab
  would **duplicate** that affordance. The bar appears only when there is
  something in it, which is better than a permanently dimmed tab.
- **Therefore the likely correct answer is a 3-tab bar — Home · Orders ·
  Account — with the cart staying contextual.** That is a Craavee
  decision, not a copy of Blinkit's five-tab bar.

**This slice does not introduce a tab bar.** Changing the root navigation
affects every screen and deserves its own review. Orders is reached from
the Home header in the interim, which is honest about being interim.

---

## 4. Capability matrix — what is real

Full detail in `CUSTOMER_EXPERIENCE_CURRENT_STATE.md`. Summary:

| Capability | Status |
|---|---|
| Phone + OTP auth, session restore | **DONE** |
| Catalog, category rail, browse, filters, sort | **DONE** (Slice 3) |
| Search (server-side, debounced, cancelled) | **DONE** (Slice 2/3) |
| Product detail | **DONE** (Slice 2) |
| Cart (persisted), checkout, promo, wallet | **DONE** |
| Razorpay + webhook authority | **DONE, externally verified** |
| Single-order tracking | **PARTIAL** — no timeline, unreachable once closed |
| **Order history** | **MISSING (frontend only)** ← this slice |
| **Order timeline** | **MISSING (frontend only)** ← this slice |
| Addresses | **PARTIAL** — add + select only; no edit/delete/default |
| Account screen | **MISSING (frontend only)** |
| **Wishlist** | **MISSING (BACKEND)** — see §6 |
| **Support** | **MISSING (BACKEND)** — see §6 |
| Reorder | **BLOCKED** — needs an availability-checked path; see §6 |
| Refunds | **DONE but invisible** — wallet-only (D38); no refund history UI |
| Notifications | **PARTIAL** — dispatcher works; no EAS projectId, so unverified |
| Real SMS | **BLOCKED** — no provider chosen |

---

## 5. Backend requirement reports (§44 — reported, NOT built)

Three capabilities the brief asks about have **no backend whatsoever**. Per
§44 I stopped rather than adding tables.

### 5.1 Wishlist — MISSING BACKEND

- **Problem.** No `wishlist` table, no column, no code. Nothing to read.
- **Minimal schema.** `wishlist_items (customer_id uuid references
  profiles(id), product_id uuid references products(id), created_at
  timestamptz default now(), primary key (customer_id, product_id))`.
  The composite PK gives idempotent add for free — no duplicate rows,
  no race.
- **RLS.** `enable` + `force`; select/insert/delete `using (customer_id =
  auth.uid())`. It is the first customer-*writable* table in the product,
  so it needs a deliberate write policy — everything else writes through
  Edge Functions.
- **Index.** The PK covers `(customer_id, product_id)`; add
  `(customer_id, created_at desc)` for the list ordering.
- **Security impact.** Low — it is not money and not order state. The one
  real question is **anonymous behaviour**: either require auth (simplest,
  and this app is auth-gated anyway) or keep a local list and reconcile on
  sign-in (a merge conflict problem for a feature that has none today).
  **Recommendation: authenticated-only.**
- **Test plan.** pgTAP for RLS isolation (customer A cannot see or delete
  B's rows) and for idempotent re-add.

### 5.2 Support — MISSING BACKEND

- **Problem.** No ticket, thread or message table. No human support
  system exists.
- **Do NOT build a support inbox.** The honest interim is a **contextual
  support surface** that classifies the problem against capabilities that
  genuinely exist (payment state, refund state, delivery state) and tells
  the customer what is true — and, where nothing can be done in-app, says
  so rather than opening a ticket into a void.
- Any real ticketing needs a decision about who staffs it. That is an
  operational decision, not an engineering one.

### 5.3 Reorder — BLOCKED, not missing

- Orders and items exist, so a naive "buy again" is trivially possible —
  which is exactly the trap. Products may be **de-listed, sold out, or
  repriced** since the order.
- Reorder must therefore be an **availability-checked add-to-cart** that
  reports what could not be added and why. Requires no schema change but
  does require a designed partial-success path, so it is deferred.

---

## 6. Data gaps (not schema gaps)

- **Product imagery: 0 of 24 products have an `image_url`.** The image
  architecture handles loaded / absent / failed distinctly, so the app is
  ready; the data is not. **Population is a data task**, not a code task.
- **Catalogue is 24 products across 8 categories.** No claim about
  ranking, relevance or filter behaviour at scale can be made from it.

---

## 7. Future instrumentation points (§49 — documented, not built)

No analytics platform is added. Points worth instrumenting later: search
performed / zero-result, category selected, filter applied, product
viewed, add to cart, checkout started, payment initiated / succeeded /
failed, order confirmed, tracking opened, support contacted, reorder.

---

## 8. Phased implementation plan

| Phase | Contents | Backend needed |
|---|---|---|
| CX-A | Auth polish, progressive profile | No |
| **CX-B/C/D** | Home, discovery, search, filters, product | **Done — PRs #24–#26** |
| **CX-F₁** | **Order history + order detail timeline** | **No** ← **this slice** |
| CX-F₂ | Root tab navigation (Home · Orders · Account) | No |
| CX-E₂ | Address book: edit, delete, default | No |
| CX-H | Account screen, wallet + refund history | No |
| CX-D₂ | Wishlist | **Yes — §5.1** |
| CX-G | Support framework | **Yes — §5.2** |
| CX-F₃ | Reorder with availability check | No (design work) |
| CX-I | Performance + accessibility pass | No |

**Ordering rationale:** every no-backend phase comes first, so the
backend decisions in §5 can be taken deliberately rather than under
delivery pressure.

---

## 9. Selected slice for this run

**CX-F₁ — Order history and order detail timeline.**

Chosen because it is (a) the largest hole in the journey — the product
currently forgets your order the moment you close it, (b) a **launch
blocker** already recorded in the Phase 10 audit as B20, and (c)
implementable with **zero backend change**: existing RLS already lets a
customer read their own `orders`, `order_items`, `refunds` and
`wallet_ledger`.

Wishlist and support were explicitly **not** chosen despite being named in
the brief, because both require schema decisions that §44 says to report
rather than make.
