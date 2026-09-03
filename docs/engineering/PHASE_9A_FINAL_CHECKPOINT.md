# Phase 9A — Final Checkpoint

Finalization pass over the admin operations console: scope audit,
security review, performance sweep, and one substantive finding that
changed a claim in the implementation report.

Branch: `feat/admin-operations-9a`. Base: `main` = `b1e18be`.

**Phase 9B is not started.**

---

## 1. Scope completed

| Area | State |
|---|---|
| Admin overview | Exception-first, count queries, no invented metrics |
| Orders — list, filters, search, pagination | Server-side throughout |
| Orders — detail + legal actions | Actions read from `order_transition_rules` |
| Failed-delivery queue + recovery | Re-attempt and cancel+refund, both pre-existing backend paths |
| Runner operations | Roster, live work, throughput, reassignment |
| Kill switch | UI over the existing `create_order` enforcement, plus the audit row |
| Operational audit visibility | Per-order history on the detail page |
| Realtime | Phase 8 architecture, reused unchanged |

Not built, per the split: inventory administration, catalog
administration, users/staff administration UI, full refund
administration, full audit administration, extended metrics. Catalog,
Inventory, Users and Promos remain Phase 2B stubs that now name 9B;
`/refunds` and `/audit` have no page and are absent from the nav.

## 2. Architecture decisions

**The UI does not decide what is legal.** `OrderActions` reads
`order_transition_rules` for the order's current status and
`actor='admin'` — the same table `enforce_order_transition` enforces. A
`packed` order therefore offers no admin action and says why. Adding a
row to that table lights the button up; the frontend needs no change.

**Every mutation goes through an Edge Function; every read goes through
RLS.** No service key in the browser, no privileged proxy route, no
client-side authorization. A disabled button is a courtesy.

**Realtime is unchanged from Phase 8** and deliberately not extended.
Nothing renders a payload — `router.refresh()` and the server component
re-queries. PostgreSQL remains the authority; reconnect recovers by
refetching on `SUBSCRIBED`.

## 3. Security / RBAC findings

All four new functions — `admin_cancel_order`, `assign_staff_role`,
`settle_runner_earnings`, `set_service_pause` — verified to have:
`verifyCaller` (JWT), an explicit `caller.role !== "admin"` gate, Zod
`safeParse` validation, the actor taken from `caller.userId` and never
the body, and `captureException` with safe context. **All four plpgsql
functions re-check the admin role themselves**, so the Edge Function
gate is not the only door; all are `SECURITY DEFINER` with
`search_path` pinned.

Probed live through the browser key:

| Check | Result |
|---|---|
| `order_transition_rules` — anon SELECT | 0 rows (no grant) |
| `order_transition_rules` — authenticated SELECT | readable |
| `order_transition_rules` — customer INSERT | refused, `42501` |
| `order_transition_rules` — admin UPDATE | refused, `42501` |
| `staff_roles` — customer | `42501`, no grant at all |
| `webhook_events` — customer | `42501` |
| `audit_logs` — customer | 0 rows (admin-only policy) |
| `order_delivery_codes` — customer | own row only (D14) |
| `order_delivery_codes` — **admin** | **0 rows — admin has no policy** |

The last line is worth stating plainly: the Console cannot show a
plaintext delivery code because an admin cannot read one. There is
nothing to redact because there is nothing to read.

**`order_transition_rules` grant (§6).** `grant select … to
authenticated` was added in 0011. The read was returning an empty set —
RLS is off on that table but there was no grant, so PostgREST answered
"no rows" and the UI concluded "no admin action": a silent wrong answer
rather than an error. Intentional posture, documented in the migration:
the contents are the published transition graph (`from_status`,
`to_status`, `actor`) — design documentation with no customer, financial
or operational data. **`anon` was not granted.** No write grant for any
client role. Enforcement remains the trigger's.

The integration suite adds the wire-level half: every admin function
refused unauthenticated (401) and customer/runner/packer (403), and a
request carrying forged `role`, `actorId`, `storeId`, `userId` and
`amount` in the body is still the customer whose JWT it is.

## 4. Refund regression — root cause and permanent fix

`process_refund` released the inventory reservation for `confirmed`,
`assigned` **and** `delivery_failed`, on a premise its own comment
stated: *"never consumed yet — packing is a later phase."* True when
migration 0005 was written; false from 0006, when `mark_packed` began
consuming the reservation. `assigned` and `delivery_failed` are reachable
only *through* `packed`, so the release subtracted a quantity the order
no longer held — out of a **different live order's** reservation, with
`greatest(...,0)` hiding the damage from the CHECK constraint.

```
product P: on_hand 10, reserved 0
order A (3) placed          -> on_hand 10, reserved 3
mark_packed A               -> on_hand  7, reserved 0   (consumed)
A -> assigned -> picked_up -> delivery_failed
order B (2) placed          -> on_hand  7, reserved 2   (B live)
full refund of A            -> on_hand  7, reserved 0   <-- B's gone
```

B still owed 2 units while the shelf claimed all 7 were free — an
oversell produced by an admin doing the ordinary thing on a failed
delivery. Migration 0011 releases only from `confirmed`, which is what
ORDER_STATE_MACHINE #9/#14 already say ("the reservation was already
consumed at mark_packed … a physical restock is a separate admin
inventory correction").

**Both halves are pinned, and the test is proven to catch the
regression.** Reverting `process_refund` to its pre-0011 definition
against the same database makes `16_admin_operations_test.sql` assertion
6 fail with `have: 0, want: 2`; restoring the fix makes it pass. The
complementary invariant — a refund from `confirmed` must **still**
release its own reservation — is asserted immediately after, so the guard
cannot be "fixed" by removing the release altogether. Covered twice: in
pgTAP and end to end through the real Edge Functions
(`phase9a.integration.test.ts` §20.34/35).

Stale wording was corrected at the same time: 0011 carries the current
lifecycle reality in its comments rather than the pre-Phase-6 assumption.

## 5. `settle_runner_earnings` — status and authoritative source

**Mandatory review item. Conclusion: the formula is NOT defined, and the
function is therefore BLOCKED, not production-ready.**

What the authoritative sources say, verbatim:

* `ENGINEERING_SPECIFICATION.md` §L, "Remaining genuine open decisions
  (not resolved by this spec, correctly deferred rather than
  force-resolved)": *"Exact runner per-delivery earnings formula/amount —
  a pricing decision, not an architecture one; the schema
  (`runner_earnings.amount`) accepts whatever value the eventual formula
  produces."*
* `ENGINEERING_SPECIFICATION.md` §448: runner earnings formula is listed
  as *"schema present; exact per-delivery amount is a pricing/product
  decision the Phase 1 prompt didn't ask this spec to set"* — the single
  item *"correctly flagged as a deferred product decision rather than
  force-resolved."*
* `API_CONTRACTS.md` `settle_runner_earnings` specifies only the
  mechanism: *"Sets `settled_at = now()` on the targeted
  `runner_earnings` rows."* No amount rule.
* `DATABASE_SPEC.md` §10 and `DECISION_LOG.md` define the **column**
  (`integer`, paise) and nothing about how it is computed.
* `PHASE_7_IMPLEMENTATION_REPORT.md` §393: *"Runner earnings use
  `orders.delivery_fee` as a placeholder."* Migration 0007 says the same
  in code.

**No formula was invented in Phase 9A.** The function does exactly what
API_CONTRACTS specifies — stamps `settled_at` on unsettled rows — with
admin authorization, an audit row, and already-settled rows skipped so a
replay settles nothing and reports 0.

The problem is not the mechanism, it is the number. `settled_at` is an
irreversible *"this runner has been paid"* record, and the amount beside
it is an admitted placeholder. Settling it would quietly convert a
deferred pricing decision into a ledger fact. So:

* it ships with **no caller** — nothing in the Console reaches it,
  confirmed by grep across `apps/`;
* the migration and the handler both carry an explicit BLOCKED notice;
* the implementation report's earlier claim that it was "built and
  tested, waiting only for a surface" has been corrected.

**This needs a product decision from the owner, not an engineering one,
and Phase 9A does not make it.**

## 6. Test evidence

Every command run from the repo root against a clean
`supabase db reset`.

| Command | Result |
|---|---|
| `npm run db:test` | exit 0 — **538 assertions, 17 files, 0 failed** |
| `npm run test:integration` | exit 0 — **189 tests, 189 pass, 0 fail, 0 skipped, 0 todo** (54.5 s) |
| `npm run functions:test` | **8 passed, 0 failed** |
| `npm test` (unit) | **26 + 15 + 3 = 44 pass, 0 fail, 0 skipped, 0 todo** |
| `npm run typecheck` | exit 0, **0 TS errors** |
| `npm run lint` | exit 0 — **0 errors**, 2 warnings |
| `npm run build` | exit 0 — **both apps compiled** |

The 2 lint warnings are pre-existing in
`packages/ui/src/components/ui/handwriting-svg.tsx`
(`react-hooks/set-state-in-effect`), untouched by 9A.

Environment-dependent notes, stated rather than hidden: the integration
suites need a running local Supabase stack and spawn their own Edge
Function server per suite on distinct ports; they run serially
(`--test-concurrency=1`) because they share one database. Nothing is
skipped or conditionally disabled.

**Unused-import sweep.** `no-unused-vars` is deliberately off in
`eslint.config.js` (documented: typescript-eslint does not yet support TS
7.x), so lint would not catch one. A manual sweep of every new/changed
Console file found none.

## 7. Browser verification evidence

Console at `localhost:3001`, real admin JWT, live database.

| Flow | Evidence |
|---|---|
| Overview numbers | Cross-checked against SQL: 13 failed / ₹780.00, 23 confirmed, 49 packed, 0 live, 3 online, 13 delivered, 9 cancelled, 4 payment_failed — **all exact** after the bounded-query rewrite |
| Admin cancel + refund | `#ff43c2c4` → `cancelled` / `refunded` / ₹60.00, `order.cancelled` + `refund.issued` audit rows carrying the typed reason; inventory unchanged (878 on hand, 0 reserved) |
| Failed-delivery retry | `#db45d890` → `assigned`, new runner, **fresh `delivery_code_hash`**, visible on the runner roster |
| Kill switch pause | Store `is_open=false` with the reason; `service.paused` audit row attributed to the admin |
| `create_order` during pause | **HTTP 422 `STORE_CLOSED`** with the operator's reason surfaced |
| Kill switch resume | `service.resumed` audited, reason cleared, `create_order` → **200 OK** |
| Realtime | External `confirmed → packed` with no browser interaction moved the overview 23 → 22 awaiting and 49 → 50 packed within ~3 s |
| Reconnect posture | `realtime.subscription` shows `claims_role=admin` — authorized before join, per the Phase 8 fix |
| Error handling | An expired injected session produced *"Your session expired. Sign in again."* — an auth failure distinguished from a generic error, as §30 requires |

## 8. Kill-switch verification

Enforcement is `create_order`'s and was not duplicated in the client. The
Console writes the flag through `process_set_service_pause`; migration
0004 step 4 reads it inside the same transaction that creates the order.
Browser evidence above; five integration tests cover pause-blocks-order,
audit + reason clearing, refusal to close without a reason, three
concurrent pause requests, and a checkout racing the pause — the last
asserting the only two acceptable outcomes (a complete valid order, or a
clean `STORE_CLOSED`), never a partial.

## 9. Realtime verification

One channel per mounted staff screen, no new sockets, no customer socket.
Payload never rendered. Verified live above.

## 10. Performance

Sweep found two queries that read rows in order to count them — the
overview's failed/packed/live lists, and the settings page pulling every
non-terminal order to group by store. Both are now `head: true` counts,
including the stale-packed check. Verified the displayed numbers are
unchanged against SQL.

One row fetch is deliberately left: the money-at-risk figure needs a sum
and PostgREST cannot aggregate without an RPC. Capped at 500 rows, and
the tile reads "at least ₹X" when truncated rather than quietly
under-reporting.

Order list: `range()` + `count: "exact"`, 25/page, against the existing
`idx_orders_store_status_placed`. No N+1 in any list — related data is
fetched once and joined in a Map. No full-page reload for ordinary
actions (`router.refresh()`). No Redis, no new indexes.

## 11. Repository hardening

**Secret scan — clean.** `gitleaks`/`trufflehog` are not installed and
this phase installs no tooling, so all history was dumped and scanned for
secret *shapes*: Razorpay live/test keys, Stripe keys, AWS ids and
secrets, GitHub PATs, Slack tokens, Google API keys, Twilio SIDs,
private-key blocks, real Sentry DSNs, Expo tokens, `sb_secret_`, literal
password assignments. **Zero hits on every pattern.** The only JWTs
decode to `{"iss":"supabase-demo","role":"anon"}` and `…"service_role"…`
— the public local-development keys that ship with the Supabase CLI,
identical on every machine, not secrets. No `.env` was ever committed;
`.gitignore` covers `.env`, `.env*.local`, `*.pem`, `*.p8`. History was
not rewritten and did not need to be.

**Licence posture — ambiguous, documented, unchanged.** Every
`package.json` is `"private": true` with no `license` field, and there is
no root `LICENSE`. That is consistent with proprietary/all-rights-
reserved, but **the repository has never stated a deliberate top-level
licensing posture**, so this checkpoint records the ambiguity rather than
inventing a project licence.

`apps/customer-runner/LICENSE` is Expo's MIT notice
(`Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)`), left by
`create-expo-app`. It is third-party attribution for template code and
**does not license the Craavee project**. It has not been deleted:
removing a third-party licence notice is the owner's decision, not an
engineering one. Flagged for the owner.

**Dev ports.** Store 3000, Console 3001, pinned in both `dev` and
`start`, with `dev:store` / `dev:console` / `dev:web` at the root.
Verified running simultaneously — both returned 200 at the same time.

## 12. Remaining production limitations

Unchanged by this phase. Admin UI existing does not verify any of them.

1. **Real push to a handset — unverified.** No EAS `projectId`, no
   APNs/FCM credentials, no physical device.
2. **Real SMS OTP — unverified.** `phone_provider_disabled` locally; no
   provider configured and none invented.
3. **Razorpay live sandbox — unverified.** Adapter implemented, unit
   tests and mock fault injection pass; **no live sandbox transaction has
   been performed**, and none was attempted in this phase.
4. **Sentry ingestion — unverified.** The shim is wired into all four new
   functions with safe context, but `SENTRY_DSN` is unset, so only the
   structured console line has been observed.
5. **`settle_runner_earnings` — blocked** on the undecided earnings
   formula (§5).
6. **No admin control of runner availability** — no backend capability
   exists; not faked.
7. **`assign_staff_role` has no UI** — that is 9B.
8. **The admin console is not "complete"** — 9B is a substantial
   remaining slice.

## 13. Phase 9B

**Phase 9B is not started.**

`assign_staff_role` is built, tested and waiting only for a surface.
`settle_runner_earnings` needs a product decision first, not a UI.
Inventory and catalog administration are plain admin RLS writes with
`reserved_not_above_on_hand` as the database backstop — no new Edge
Function expected. Audit and refund consoles have their data available
today.

One thing 9B should not inherit uncritically: §4 exists because a comment
in migration 0005 was true when written and quietly stopped being true
two phases later. Assertions about "what has happened by now" age; the
state machine does not.
