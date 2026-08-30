# Agent OS — Craavee

Status: **Phase 1 (engineering specification) complete, 2026-08-29.**
Initialized fresh in Phase 0 the same day — no prior Agent OS installation
was found anywhere in this repository or on this machine before that
session. The repo's `.gitignore` contains a `.kilo/` entry, indicating a
different AI coding tool (Kilo Code) was used on this project previously, but
that workspace was never committed and its contents are not recoverable from
git history.

Phase 0 flagged one blocking product-domain ambiguity (venue/table model
vs. campus hyperlocal model) as a precondition for writing a spec. That
ambiguity was resolved explicitly by the founder at the start of Phase 1:
Craavee v2.0 (campus hyperlocal quick-commerce) is the product; the
launch hackathon is a campaign, not a parallel domain. See
`product/mission.md` (updated) and `docs/engineering/DECISION_LOG.md` D1
for the full resolution.

This is an EXISTING, partially-built codebase, not a greenfield project.
Nothing in this folder should be read as a request to re-plan the product
from scratch — see `../docs/audit/PHASE_0_REPOSITORY_AUDIT.md` for the full
discovery findings that this structure is based on.

## Contents

- `product/mission.md` — product definition, sourced from the Craavee
  Product & Engineering Dossier v2.0 (external source of truth, not derived
  from code).
- `product/tech-stack-dossier.md` — the technology decisions the dossier
  locks in (§12), reproduced verbatim as reference.
- `standards/existing-codebase-facts.md` — technology and conventions
  **actually observed** in the current repository. Nothing in this file is
  inferred or recommended; every line is a fact traceable to a specific file.
- `specs/` — pointers into `docs/engineering/`, the canonical engineering
  specification produced in Phase 1 (schema, RLS, API contracts, order
  state machine, security model, deployment topology, test strategy,
  13-phase implementation plan with gates). Per the dossier's own closing
  instruction (§24): "hand an implementation agent one phase at a time
  with its gate criteria attached... do not hand it this document and ask
  for an app" — `docs/engineering/PHASE_PLAN.md` is built exactly for
  that purpose. Implementation has **not** started; this phase is
  specification only, pending human review.

## Source-of-truth discipline

Every claim in this folder and in `docs/audit/` is tagged with one of:
- **[FACT]** — observed directly in the existing codebase or git history.
- **[DOSSIER]** — a requirement stated in Craavee Product & Engineering
  Dossier v2.0.
- **[RECOMMENDATION]** — an engineering judgment call, clearly labeled as
  such, not a decision already made.
- **[DECISION NEEDED]** — an open question for the founder, not resolved by
  either the code or the dossier.

Do not collapse these categories when extending this folder.
