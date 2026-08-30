# Craavee — Mission [DOSSIER]

Source: Craavee Product & Engineering Dossier v2.0, compiled 19 Aug 2026,
founder Soumyadeb. Supersedes v1.1, which scoped Craavee as a single-event
tool. This file is a condensed pointer into that document, not a
replacement for it — see the PDF for full detail, and see
`docs/audit/PHASE_0_REPOSITORY_AUDIT.md` §28 for how the current codebase
compares against it.

## Thesis

Hyperlocal quick-commerce for university campuses. India's quick-commerce
leaders deliver in ten minutes to a pin on a map; on a campus that pin is
the main gate, and students can't be reached past it economically by
existing players. Craavee puts a stocked micro-store inside/adjacent to
campus and uses student runners on foot for a 200–600m last mile instead of
a 3km one — same ten minutes, a fraction of the delivery cost.

## Beachhead

University campuses. Launch event: a campus hackathon (~800 users in one
room, 30 hours) used as the first 30 hours of real trading, not a demo.

## Four surfaces, one auth system

| Surface | Role | Platform |
|---|---|---|
| Customer | `customer` | Expo (Android/iOS/web) |
| Store/Packer | `packer` | Next.js (tablet/web) |
| Runner | `runner` | Expo (Android/iOS) |
| Console (admin/ops) | `admin` | Next.js (web) |

Authorization: a `role` claim in the Supabase JWT, enforced by Postgres
Row-Level Security. Enforcement never lives in the client.

## Non-negotiables

- Real payments (Razorpay or Cashfree) from launch hour one — **not** event
  credits.
- Six database-enforced correctness guarantees (no duplicate orders, no
  duplicate captures, no overselling, no double assignment, one live job
  per runner, no illegal order transitions).
- `store_id` on every inventory/order row from day one (multi-store-ready
  schema, single store at launch).
- Structured campus addressing (hostel/block/floor/room) — never free text.
- Feature freeze at day 21 of the 26-day plan; verification (k6 + live
  dry run) days 22–26.

## Launch

Mid-September 2026. Phase P0 exit criteria: 30 hours of continuous trading
survived, one store, one campus, real payments, contribution per order
measured.

## Status as of Phase 1 (2026-08-29)

The existing repository still does **not** implement this mission — it
implements a different, earlier product shape (in-venue/event ordering:
venues, tables, seats, event credits). See
`docs/audit/IMPLEMENTATION_GAP_MATRIX.md` for specifics; that finding is
unchanged by Phase 1.

**What changed in Phase 1:** the domain-model ambiguity Phase 0 flagged as
a blocker is now resolved, explicitly and permanently. Craavee v2.0 as
described above **is** the product. The launch hackathon (dossier §5) is
represented purely as a launch campaign / acquisition source — it is not,
and must never become, a parallel domain model. See
`docs/engineering/DECISION_LOG.md` D1 and D22, and
`docs/engineering/ENGINEERING_SPECIFICATION.md` §19 for the full
resolution and its consequences (nothing hackathon-specific exists in the
core order/inventory/auth/payment schema; after the hackathon, the exact
same system continues serving every customer, unmodified).

The full engineering specification for building this mission now exists
at `docs/engineering/` — see `ENGINEERING_SPECIFICATION.md` as the entry
point. Implementation has not started; Phase 2 ("Foundation" —
`docs/engineering/PHASE_PLAN.md`) is the next phase, pending review of
this specification.
