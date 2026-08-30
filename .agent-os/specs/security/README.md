# Security

Canonical source: `docs/engineering/SECURITY_MODEL.md` (full threat model,
auth flow, secrets/environment classification) and
`docs/engineering/RBAC_MATRIX.md` (authorization). Governing rule
throughout this project: the database is the final enforcement layer,
never the client.
