# Backend Readiness — craavee_web_v1

## Can we safely begin backend implementation now?

**No — not the backend itself, not yet.** Three things have to happen
first, and none of them are "start writing Edge Functions":

1. **[DECISION NEEDED] Resolve the product-domain mismatch.** The existing
   repository is built around an in-venue/event-ordering domain model
   (venues, tables, seats, event credits) — this matches the dossier's own
   description of the **superseded v1.1 scope**, not the campus hyperlocal
   quick-commerce v2.0 model this dossier defines. Before any schema or
   Edge Function is written, the founder needs to explicitly confirm: are
   we discarding the venue/table/seat framing entirely and rebuilding the
   data model around campus/store/hostel-address, or is there a hybrid
   intended? Writing `stores`, `zones`, `addresses` (block/floor/room)
   against a codebase that still thinks in `venues`/`tables` will produce
   confused, half-migrated code. This is a product decision, not an
   engineering one — it belongs to the founder before Phase 1.

2. **The engineering specification does not exist yet.** The dossier is
   explicit that it is a *product* dossier and states its own freeze
   checklist (§24) as a precondition for coding: complete DDL, every RLS
   policy written out, the role→capability matrix, Edge Function
   signatures, API contracts, the order transition table, webhook
   idempotency behaviour, wallet/promo rules, error code catalogue,
   environment variables/secrets, deployment topology, and "definition of
   done" per phase. None of these exist in this repository or anywhere
   else discovered on this machine. Per the dossier's own working method
   (§24): "hand an implementation agent one phase at a time with its gate
   criteria attached... do not hand it this document and ask for an app."
   **The next artifact is the engineering specification, not code.**

3. **The operations-track items are off the engineering clock entirely**
   and are called out in the dossier itself as higher-risk than anything
   in code: payment gateway KYC (3–7 days), university permission
   (unpredictable, "the single most underrated risk in this plan"), FSSAI
   registration (7–15 days), business entity/bank account (3–10 days).
   These are not verifiable from a repository audit — the founder should
   confirm their status directly, since dossier §17 says they should have
   started "day one" of the 26-day plan.

## What actually can start now (non-product-logic groundwork)

The following are safe to do regardless of the domain-model decision above,
because they're infrastructure, not schema:

- Add Supabase project + local dev environment, `.env.example`.
- Add `@supabase/supabase-js`, wire a typed client (server + browser
  variants).
- Stand up Sentry.
- Decide and record the actual repository/monorepo structure for the four
  surfaces (dossier's freeze checklist item 1: "repository structure") —
  currently only the Next.js web app exists; the Expo customer/runner app
  has not been started at all.

## Recommended first backend phase (once the spec exists)

Per dossier §19/§20, Phase P0 gate order is: **schema → auth → order flow
→ payment flow**, with the explicit engineering gate "Days 1–6: phone OTP
signup works and a catalog renders from the live database, deployed."
Given this repository has zero database and zero real auth today, the
correct first phase is:

1. Supabase project provisioning + complete DDL (all 14 dossier tables,
   `store_id` on every relevant row, indexes and constraints from dossier
   §11) — as a reviewable migration, not ad hoc SQL.
2. Supabase Auth (phone OTP) wired end-to-end for the customer surface
   only, deployed, with a catalog page reading from the live database
   (replacing `src/lib/products.ts`'s static array).
3. RLS policies written alongside the schema, not after — the dossier's
   freeze checklist treats "every RLS policy, written out" as a
   pre-coding artifact, not a hardening pass.

**Do not start with payments, runner assignment, or the console.** Those
depend on the order lifecycle existing first, and the dossier's own gate
table sequences them at days 7–12 and 13–20 respectively.

## What NOT to reuse from the current repository

- `src/db/migrations/001_initial_schema.sql` — SQLite-flavored, wrong
  domain model, no RLS, no reservation semantics. Do not extend it; replace
  it.
- `src/db/repositories/*` and `src/server/services/*` — fully stubbed, zero
  logic to preserve. Fine to delete/rewrite freely.
- `src/app/api/*` — in-memory, unauthenticated, no validation. Same.
- `src/types/index.ts` domain types (`Venue`, `Table`, `Order.seat`) — encode
  the wrong domain model; will need a genuine rewrite, not a rename.

## What IS worth reusing

- The Next.js 16 / TypeScript strict / Tailwind v4 web app skeleton for the
  Store and Console surfaces (dossier explicitly specifies Next.js for
  these).
- The visual design system (`DESIGN.md`, the clay/glass component library)
  — dossier §15 treats visual credibility as a conversion mechanism, and
  real design work already exists here that doesn't need to be redone,
  independent of the backend rebuild.
- `AddressSheet.tsx`'s reverse-geocoding pattern as a reference for the
  "detect current location" UX, even though the structured
  block/floor/room capture itself still needs to be built from scratch.
