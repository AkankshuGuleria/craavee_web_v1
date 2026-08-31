# Phase 8 — Final Git Checkpoint

Phase 8 (delivery failure recovery, Realtime, notifications) is merged.
This records what was verified, against which SHAs, and — equally
important — what is still **not** verified.

---

## 1. Merge

| | |
|---|---|
| PR | [#13 — feat: add realtime updates and notifications](https://github.com/AkankshuGuleria/craavee_web_v1/pull/13) |
| Base | `main` |
| Head | `4d87110` |
| Sync merge (main → branch) | `8c11695` |
| **Merge commit** | **`3fbe299`** |
| **main after merge** | **`3fbe299c1a7ffe06aa8cf2340c7dcf5938ae3b20`** (now `ada865d` with this document) |
| main before merge | `1266345` (PR #12, Phase 7) |
| Method | merge commit — no squash, no rebase, no force push |
| Merged at | 2026-08-31 20:14 UTC |
| Diff | 34 files, +3570 / −118 |
| Open PRs in this stack | **0** |

Working tree clean, local `main` fast-forwarded to `3fbe299`.

## 2. CI on the actual merge SHA

Not branch-level results — these ran against `3fbe299` itself.

| Workflow | Run ID | SHA | Result |
|---|---|---|---|
| CI | [`33434909107`](https://github.com/AkankshuGuleria/craavee_web_v1/actions/runs/33434909107) | `3fbe299` | **success** |
| Database | [`33434909062`](https://github.com/AkankshuGuleria/craavee_web_v1/actions/runs/33434909062) | `3fbe299` | **success** |
| CI | [`33435840453`](https://github.com/AkankshuGuleria/craavee_web_v1/actions/runs/33435840453) | `ada865d` | **success** |

`ada865d` is this document, merged as PR #14 — the only difference from
`3fbe299` is this one markdown file. The Database workflow is
path-filtered to `supabase/** | scripts/** | apps/customer-runner/__tests__/** | packages/**`,
so it correctly did not re-run for a docs-only change; `33434909062` at
`3fbe299` is the run that covers the code tree, and that tree is byte
-identical on `ada865d`.

The Database workflow ran the complete chain from a clean reset —
`0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010` —
then the pgTAP suite, the Deno checks, and the integration suites.

## 3. Test counts on main

All figures read out of the run logs for `3fbe299`, not from a local run.

| Suite | Count | Source |
|---|---|---|
| pgTAP | **500 / 500**, 16 files, "ALL GREEN" | Database `33434909062` |
| Integration | **164 / 164** | Database `33434909062` |
| Gateway (Deno) | **8 passed / 0 failed** | Database `33434909062` |
| Unit | **44 / 44** (26 + 15 + 3) | CI `33434909107` |
| Typecheck | clean | CI |
| Lint | 0 errors, 2 warnings (pre-existing, `packages/ui/handwriting-svg.tsx`) | CI |
| Build | Store ✓ and Console ✓ compiled | CI |

pgTAP per file: 82, 24, 14, 14, 14, 10, 16, 24, 4, 3, 14, 45, 50, 57, 89,
40 = **500**. Phase 8 contributed `15_delivery_failure_test.sql` (40) and
27 integration tests; nothing existing was weakened or removed.

> An earlier draft of the Phase 8 report quoted 486. That was an
> arithmetic slip on my part when summing by hand — the suites never
> changed, and 460 → 500 matches the Phase 7 baseline exactly. The
> implementation report has been corrected.

## 4. Scope review of the merged diff

The full diff was read, not just the file list. Searched for and **found
nothing**: Redis, analytics/telemetry SDKs, load-test tooling, rollout or
feature-flag machinery, other payment providers, unrelated commerce
features, secrets or credentials, machine-specific paths, `.env` or local
config files.

The only matches for "Redis" are two lines in the report saying there
isn't any. The only hardcoded JWTs are the well-known Supabase **local
demo** keys (`iss: supabase-demo`), used as fallbacks exactly as the five
pre-existing integration suites on `main` already do.

**Console additions are not Phase 9 admin work.** The Console gained a
staff sign-in, a `requireAdmin` gate, and real data behind the existing
Phase 2B board — because without an authenticated identity every query
returned nothing and there was no state to broadcast. It performs **zero**
writes: no `.rpc(`, `.insert(`, `.update(`, `.delete(` or
`functions.invoke` anywhere in `apps/console/src`. The inherited "Assign"
button has no handler and does nothing. The real admin/operations console
remains Phase 9 work and has not been started.

## 5. Phase 8 decisions, re-confirmed at the source

| | Decision | Evidence |
|---|---|---|
| A | PostgreSQL is authoritative | no client writes state from a payload |
| B | Realtime is not an event log | the Store/Console handler takes **no argument** — the payload is unreachable; the runner hook only invalidates queries |
| C | Clients refetch after reconnect | `router.refresh()` / `invalidateQueries` on `SUBSCRIBED`, demonstrated live (§7) |
| D | Customers hold no persistent socket | `.channel(` exists in exactly three files — Store, Console, runner hook; a CI test scans the shipped source every run |
| E | Staff Realtime scoped to Store/Runner/Console | same three files; RLS scopes what each receives |
| F | No unauthorized refund on failure | `process_mark_delivery_failed` contains no refund/wallet/payment statement at all; verified live — payment stayed `captured`, `refunded_amount` 0, zero `refunds` rows |
| G | Delivery code never in a notification | titles/bodies are fixed literal strings with **no interpolation of order data** — a code cannot appear by construction |
| H | No secrets in payloads | same; plus a test scanning every queued payload for the order's real code, long digit runs, `eyJ`, `Bearer`, `razorpay`, `wallet` |

## 6. Native validation (carried from the pre-merge verification against `main`)

**iOS — `Craavee_iPhone17`.** Customer placed a real order, D20 polling
measured at the gateway: ~8 s foreground, ~30 s after the 2-minute
backoff, **0 requests while backgrounded**, resumed on foreground. While
the customer sat on the order screen `realtime.subscription` held no
customer row. Runner: claim → picked up → *Can't deliver this* with
reason; `delivery_failed`, runner retained, code destroyed, audit row
written, no money moved. Releasing a claimed job from psql moved the
screen to "No live job" untouched.

**Android — `Craavee_Pixel7_API36`.** Same runner flow with reason
"customer unreachable"; two runner subscriptions with distinct topics;
same live-release behaviour.

**Web.** Store as packer 18 → 17 (`claims_role=packer` + store filter);
Console as admin Placed 31 → 30, Packed 88 → 89. Both within ~2 s, no
reload.

## 7. Reconnect / refetch

Demonstrated by stopping the Realtime container mid-change:

1. Console connected, board correct.
2. Container stopped → the page showed *"Live updates disconnected —
   reconnecting"* and held its now-stale rows rather than pretending.
3. An order was packed **while disconnected** — that event can never be
   delivered.
4. Container restarted → banner cleared, board corrected itself
   (Placed 30 → 29, Packed 89 → 90).

Recovery was by refetching on `SUBSCRIBED`, never by replaying a missed
event.

## 8. Performance and cleanup

| Measurement | Result |
|---|---|
| `subscribe()` → `SUBSCRIBED` | 3–6 ms |
| Steady-state update latency | 228–232 ms median |
| Forced reconnect → delivering again | ~0.7 s |
| `register_push_token` round trip | 68 ms |
| Subscription rows after unmount | drain to **0** within ~10 s |

One socket per signed-in client, one subscription per mounted staff
screen. No Redis, no pooling layer, nothing added to the infrastructure.

## 9. Production limitations — still open, not fixed by this merge

These are infrastructure that exists, not behaviour that has been
observed working in production. Do not treat any of them as done.

1. **Real push to a handset: NOT verified.** Token registration,
   notification construction, the outbox and the dispatcher all exist and
   are tested. But there is no EAS `projectId`, no APNs/FCM credentials,
   and no physical device — `push_tokens` had **zero** rows from either
   the simulator or the emulator after granting permission. No handset
   has ever received a Craavee push. The dispatcher is also unscheduled:
   nothing invokes it on a timer.
2. **Real SMS OTP: NOT verified.** The local fixed test OTP works;
   `/auth/v1/otp` returns `phone_provider_disabled` because no SMS
   provider is configured, and none was invented. Production SMS remains
   an external verification task.
3. **Razorpay live sandbox: NOT verified.** The adapter is implemented,
   its unit tests pass, and mock fault injection passes. No live sandbox
   transaction has been performed. Unchanged since Phase 5.
4. **Sentry ingestion: NOT verified.** The shim is wired into all three
   new Edge Functions with safe context (`fn`, `userId`, `orderId`,
   `code` — never a JWT, delivery code or gateway secret), but
   `SENTRY_DSN` is unset, so only the structured console line has ever
   been observed. Unchanged since Phase 4.
5. **A real notification tap is untested**, for the same reason as (1).
   The deep-link route the handler navigates to works; the path from a
   delivered notification does not exist to test.
6. **One Realtime flake, once**, immediately after a container restart: a
   listener never became live within 20 s. Not reproduced in five
   subsequent full runs. `listen()` now resubscribes rather than waiting
   longer, but the cause is unproven and is recorded as unproven.
7. `delivery_failed` orders accumulate until an admin acts. The Console
   board has no column for them — today they are visible only in the
   database.

## 10. Phase 9

**Phase 9 has not been started.** No `feat/admin-console` branch exists,
no admin product code was modified, and nothing in this merge implements
admin operations, analytics, load testing or production rollout.

The next phase is the full admin/operations console — using the
infrastructure that now exists rather than adding more of it. Its first
two obvious inputs are item (7) above and item (1): a `delivery_failed`
queue an admin can actually work, and push credentials so the
notifications the system already queues can be delivered.

## 11. Environment

Unchanged. Craavee on internal APFS at `~/Craavee/craavee_web_v1`, the T7
still exFAT and untouched, AdityaNet and Cartograph untouched, no new
tooling installed. Internal free space ~22 GiB.
