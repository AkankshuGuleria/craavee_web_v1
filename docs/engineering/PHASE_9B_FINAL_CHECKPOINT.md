# Phase 9B — Administration Completion

The remaining admin surfaces: inventory, catalog, users/staff, refunds
and the audit log.

Branch: `feat/admin-operations-9b`.

> **Base note.** The 9B brief said Phase 9A was merged into `main`. It is
> not — PR #16 is still open and `main` is `b1e18be`, with no migration
> 0011. Rather than merge on your behalf (the merge decision is yours),
> this branch is **stacked on `feat/admin-operations-9a`** and the PR
> targets that branch. Once #16 lands, this retargets to `main` cleanly.

**Runner earnings formula remains undefined and settlement remains
blocked.**

---

## 1. Scope completed

| Area | State |
|---|---|
| Inventory administration | `/inventory` — visibility, audited on-hand correction |
| Catalog administration | `/catalog` — create/edit, pricing, listing, audited |
| Users / staff administration | `/users` — roster and role management via `assign_staff_role` |
| Refund administration | `/refunds` — ledger + issue full or partial |
| Full audit surface | `/audit` — read-only, filtered, server-paginated |
| Operational metrics | **nothing new — see §9** |

Promos remains a Phase 2B route stub. It is in PHASE_PLAN's Phase 9 scope
but was not in the 9B brief, and a half-built surface is worse than an
honest placeholder.

## 2. Schema and API changes

Migration **0012** (0001–0011 untouched):

| Object | Why it exists |
|---|---|
| `process_admin_adjust_inventory` | Audited stock correction |
| `process_admin_upsert_product` | Audited catalog/pricing create + edit |
| `refunds_admin_view` | Makes the refund ledger readable (§6) |

New Edge Functions: `admin_adjust_inventory`, `admin_upsert_product`.
Existing functions reused unchanged for everything else —
`assign_staff_role` (built in 9A) and `refund` (Phase 5).

**Why new functions at all**, given RBAC_MATRIX §4 says an admin stock
count and a catalog edit are safe as plain RLS writes: that is still true
and the policies are untouched. What plain RLS *cannot* do is write
`audit_logs`, which is service-role-INSERT only. A price is what the next
customer pays and a stock correction is what the store claims it can
deliver — both belong in the record. Same reasoning as the 9A kill
switch: these are the audited path, not a new authority.

## 3. RBAC / security findings

Every new mutation: JWT identity, explicit `caller.role !== "admin"`
gate, Zod validation, `SECURITY DEFINER` with `search_path` pinned, and a
**second** admin check inside the plpgsql so the Edge Function is not the
only door. Store-scoped admins are held to their own store on both paths;
a null `store_id` is the all-store admin (RBAC §1).

Verified at the wire, not the UI:

| Check | Result |
|---|---|
| All 4 admin paths, unauthenticated | 401 `AUTH_REQUIRED` |
| All 4, as customer / runner / packer | 403 `FORBIDDEN` |
| Forged `actorId`/`role`/`userId` in body, customer JWT | 403, nothing written |
| Customer calling `assign_staff_role` on themselves | 403, no role granted |
| Admin stripping their own admin role | 403 (the last admin cannot lock everyone out) |
| Packer/runner grant with no store | `VALIDATION_FAILED` |
| Audit log read: customer / runner / packer | 0 rows |
| Audit log insert/update/delete as **admin** | refused by the database |

No RLS policy was weakened and no new table grant was added.

## 4. Inventory invariants

`qty_reserved` is **not adjustable**. It is owned by the order lifecycle
— `create_order` reserves, `mark_packed` consumes, a refund from
`confirmed` releases — and there is deliberately no field for it in the
request schema. A human typing into it would desynchronise it from the
orders that believe they hold that stock: the same class of corruption
migration 0011 had to fix from the other direction.

`reserved_not_above_on_hand` (0001) is the backstop. The function
surfaces it as *"N units are already reserved by live orders, so on-hand
cannot go below that"* rather than a raw `23514`, and the Console shows
that sentence verbatim.

Phase 9A's refund guarantees are re-asserted in this phase's own suite,
not assumed: a full refund from `confirmed` still releases its
reservation (`phase9b` §E), and the post-pack case is still covered by
`16_admin_operations_test.sql` §A and `phase9a` §20.34.

## 5. Catalog pricing safety

**A price change cannot reach an order that has already been placed.**
`order_items.unit_price` is a snapshot copied at `create_order` time, and
`orders.subtotal`/`payable` are stored integers — nothing recomputes from
`products.sale_price` afterwards.

**Proven to catch a regression, not merely to pass.** Injecting a
plausible "helpful" trigger that back-propagates `products.sale_price`
into `order_items` makes assertion 18 of test 17 fail with
`have: 16000, want: 8000`; dropping it makes the file green again.

The integration test checks four separate places the guarantee could
leak — `order_items.unit_price`, `orders.subtotal`, `orders.payable` and
`payments.amount` — and the browser run confirmed the same: the catalog
moved 5000 → 5500 paise while three existing orders stayed at 5000 /
6000 / 6000.

Money is entered in rupees and sent in paise (D7). The conversion happens
once in the client and the server validates the integer, so no decimal
reaches the database.

## 6. Refund behaviour

The page issues nothing itself — it calls the Phase 5 `refund` function,
which owns the amount. The box is an upper bound; blank means the full
remaining captured amount; anything above it is refused
`REFUND_EXCEEDS_CAPTURED`. The idempotency key is generated once per
dialog opening rather than per click, so a double-click replays instead
of issuing a second refund (D29).

Verified: partial refund leaves the order `confirmed`/`packed` and moving
with `payment_status = partially_refunded`; over-refund refused with no
money moved; a same-key replay produces exactly one `refunds` row; two
concurrent refunds never exceed what was captured.

**A real bug was found here.** `refunds` has an admin SELECT policy and a
SELECT grant, so it looks readable — it is not. The policy's customer
branch joins `payments`, and `payments` has no SELECT grant for
`authenticated` (deliberately: it carries gateway refs and `raw_event`,
which RBAC §5 keeps out of the browser behind two column-restricted
views). Evaluating the policy therefore needs a privilege the caller does
not have, and PostgREST answers `42501: permission denied for table
payments` — **for an admin too**. The refund ledger has been unreadable
from any client since migration 0003; nothing had tried until this phase
built the surface.

Fixed with the pattern already in the codebase rather than a grant:
`refunds_admin_view`, admin-scoped and `security_barrier`, in the same
shape as `payments_admin_view` beside it. `payments` stays ungranted, no
policy is weakened, and the customer path is untouched.

## 7. Audit behaviour

Read-only **by construction**: `audit_logs` has an admin SELECT policy
and no insert, update or delete policy for any client role, and
`authenticated` holds no write grant. Test 17 §D asserts that
structurally, and the integration suite proves an admin's own browser
client cannot insert, update or delete a row.

Server-paginated (50/page) with filters for action, target type, target
id and a date range, plus actor names resolved in one query for the ids
on the page rather than one per row.

**The raw `metadata` blob is never rendered.** Only an allowlist of
known-safe keys is read out; anything else is counted as *"N further
fields not shown"*. The blob is written by trusted server code and is not
supposed to contain secrets, but printing arbitrary JSON is how a future
field leaks by accident. A test scans every row for `eyJ`, `Bearer `,
`rzp_test_`/`rzp_live_`, `service_role`, private-key headers and every
live delivery code.

## 8. Metrics — nothing was built, and why

The brief says: *only implement metrics already defined by authoritative
docs; do not invent KPI formulas.*

**No KPI formula is defined anywhere in the repository.**
`ENGINEERING_SPECIFICATION.md` §15 routes product analytics to
Sentry/PostHog and `PHASE_PLAN.md` places that work in **Phase 11**.
`PHASE_PLAN.md` Phase 9 names a "metrics dashboard (dossier §22
targets)", but the dossier is not in the repository — `.agent-os/product/`
contains `mission.md` and `tech-stack-dossier.md`, neither of which
defines a target.

So 9B adds no metrics. The counts already on the 9A overview are derived
from authoritative definitions (queue depth is literally the count
`create_order` compares against `max_queue_depth`), and anything beyond
that — AOV, repeat rate, retention cohorts — would be invented. Building
a dashboard of made-up formulas would look like progress and be worse
than nothing.

## 9. Runner earnings

**Runner earnings formula remains undefined and settlement remains
blocked.** Unchanged from the 9A checkpoint: `ENGINEERING_SPECIFICATION.md`
§L lists it among the *"remaining genuine open decisions … correctly
deferred rather than force-resolved"*, and `verify_delivery_code` writes
`orders.delivery_fee` as an explicit placeholder.

`settle_runner_earnings` still ships with **no caller**, and 9B does not
add one. That is now enforced by a test rather than by discipline: the
suite greps the shipped source and fails if any app file references it.

## 10. Test evidence

Every command from the repo root, in CI order (`db reset` → pgTAP →
integration).

| Command | Result |
|---|---|
| `npm run db:test` | exit 0 — **570 assertions, 18 files, 0 failed** |
| `npm run test:integration` | exit 0 — **211 tests, 211 pass, 0 fail, 0 skipped, 0 todo** (66.5 s) |
| `npm run functions:test` | **8 passed, 0 failed** |
| `npm test` (unit) | **26 + 15 + 3 = 44 pass, 0 fail** |
| `npm run typecheck` | exit 0, **0 TS errors** |
| `npm run lint` | exit 0, **0 errors**, 2 warnings |
| `npm run functions:check` | exit 0 |
| `npm run build` | exit 0, **both apps compiled** |

Deltas: pgTAP 538 → **570** (test 17, +32); integration 189 → **211**
(`phase9b`, +22).

The 2 lint warnings are pre-existing in `packages/ui/handwriting-svg.tsx`
and untouched by 9B.

**One environment-dependent behaviour, stated rather than hidden:** the
pgTAP suite expects a freshly reset database. Running it *after* the
integration suites fails `11_order_creation_test.sql` on a duplicate
`promos_code_key` — pre-existing, reproduced on 9A's code too, and not a
9B regression. CI runs `db reset` → pgTAP → integration, which is the
order used above.

## 11. Browser evidence

Console at `localhost:3001` as a real admin, cross-checked against SQL.

| Flow | Evidence |
|---|---|
| Inventory refusal | Correcting `last-unit` to 0 with 1 reserved showed the server's own sentence *"1 units are already reserved by live orders, so on-hand cannot go below that"*; row unchanged |
| Inventory correction | 1 → 7 succeeded; audit row `{from:1, to:7, delta:6, reserved:1, reason:…}` attributed to the admin |
| Catalog validation | Sale price 75.00 above MRP 60.00 refused with *"The sale price cannot be above the MRP."*; price did not move |
| Catalog edit | 50.00 → 55.00 saved; SQL then showed catalog `5500` while three existing orders stayed `unit_price 5000`, `payable 6000`, `captured 6000`; audit `priceFrom 5000 → priceTo 5500` |
| Role grant | Rohan Mehta → packer; `staff_roles` row written with `granted_by` = the admin; audit `staff_role.assigned`; reverted afterwards |
| Refund (partial) | ₹20.00 of ₹60.00 on `#29340fec`; order stayed `packed`, `payment_status` → `partially_refunded`, one `refunds` row for 2000 paise with the typed reason |
| Refund dialog copy | Correctly said stock is **not** restored for a packed order, and *"the order stays packed and keeps moving"* for a partial |
| Audit filtering | Filtered by `product.updated` and `inventory.adjusted`; actor names resolved; allowlisted fields shown with *"1 further field not shown"* |
| Network failure | With the function server down, the refund dialog said *"Could not reach the server. Nothing was changed"* — and nothing had |

## 12. Performance

Every list is server-paginated (`range()` + `count: "exact"`) — inventory
40/page, catalog 40, users 30, refunds 25, audit 50. No screen fetches a
whole table. No N+1: related data (store names, actor names, payments,
orders) is fetched once per page and joined in a `Map`. Ordinary
mutations use `router.refresh()`, not a full page reload. No new Realtime
subscriptions were added — 9B's surfaces are administrative, not
operational dashboards. No Redis, no caching layer, no new indexes.

## 13. Repository hardening

**Secret scan — clean.** 119 commits scanned for Razorpay/Stripe keys,
AWS ids, GitHub PATs, Slack tokens, Google keys, private-key blocks, real
Sentry DSNs, `sb_secret_` and literal passwords: **zero hits on every
pattern**. The only JWTs decode to `iss: supabase-demo` (the public local
CLI keys). No `.env` ever committed. No machine-specific path in any 9B
file. No debug output, TODO or FIXME in the added lines.

**Licence — unchanged, still ambiguous, still documented as such.** Every
`package.json` is `"private": true` with no `license` field and there is
no root `LICENSE`. `apps/customer-runner/LICENSE` is Expo's third-party
MIT notice from `create-expo-app`; it does **not** license Craavee and it
has **not** been deleted, because no explicit project licensing decision
has been made.

## 14. Known limitations

1. **Real push to a handset — unverified.** No EAS `projectId`, no
   APNs/FCM credentials, no physical device.
2. **Real SMS OTP — unverified.** `phone_provider_disabled` locally.
3. **Razorpay live sandbox — unverified.** The adapter is implemented and
   its unit tests and mock fault injection pass; **no live sandbox
   transaction has been performed**, and none was attempted here. Every
   refund in this phase moved money inside Craavee's own wallet ledger,
   which touches no gateway at all.
4. **Sentry ingestion — unverified.** `SENTRY_DSN` unset; only the
   structured console line has been observed.
5. **`settle_runner_earnings` — blocked** on the undecided formula (§9).
6. **Promos administration not built** — Phase 9 scope, not 9B brief.
7. **No metrics dashboard** — deliberate (§8).
8. **Staff roles cannot be listed**, only written. `staff_roles` has no
   client read policy at all (RBAC §5), so the Users page shows runner
   status from `runners` and says plainly that packer/admin grants are
   visible only through the audit log. Adding a read path would mean a
   new view and a deliberate decision about exposing the staff roster;
   that was not in scope.
9. **Local Console mutations need the dev proxy.** There is no edge
   runtime container on this machine (Phase 4 §20), so
   `NEXT_PUBLIC_SUPABASE_URL` points at a throwaway proxy that routes
   `/functions/v1` to `scripts/serve-functions.sh`. Dev-only; the file is
   gitignored and nothing ships with it.

## 15. Phase 9B is complete; nothing beyond it was started

No Phase 10+ work, no analytics platform, no Redis, no load-testing, no
rollout infrastructure, no new payment provider, no Realtime
architecture change, no claim_job concurrency change.
