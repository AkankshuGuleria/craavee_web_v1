# Inventory

Canonical source: `docs/engineering/DATABASE_SPEC.md` §6 (schema) and §14
(locking strategy). Reservation semantics decision:
`docs/engineering/DECISION_LOG.md` D11 (`qty_on_hand`/`qty_reserved`
split, `FOR UPDATE`, not `SKIP LOCKED` — deliberately different from the
runner-claim locking choice, D13). Stock-out handling (packer-side, not a
separate inventory concern): `docs/engineering/API_CONTRACTS.md`
`mark_stock_out`.
