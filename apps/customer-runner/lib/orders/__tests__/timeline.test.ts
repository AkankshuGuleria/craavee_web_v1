/**
 * Order timeline tests.
 *
 * The properties that matter here are all about HONESTY, and every one of
 * them fails silently in the UI rather than throwing: a timeline that
 * shows a step as done when it isn't, or invents a time, or implies a
 * cancelled order is still travelling, just looks plausible and lies.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTimeline,
  isTerminal,
  statusHeadline,
  type OrderStatus,
  type OrderTimestamps,
} from "../timeline.ts";

const NONE: OrderTimestamps = {
  placedAt: null,
  confirmedAt: null,
  packedAt: null,
  assignedAt: null,
  pickedUpAt: null,
  deliveredAt: null,
  cancelledAt: null,
};

const T = (s: string) => `2026-09-05T${s}:00.000Z`;

test("a step never shows a time that was not recorded", () => {
  // The core honesty property: no timestamp, no time. Ever.
  const steps = buildTimeline("packed", { ...NONE, placedAt: T("10:00"), confirmedAt: T("10:01") });
  for (const s of steps) {
    if (s.at === null) continue;
    assert.ok(
      [T("10:00"), T("10:01")].includes(s.at),
      `step ${s.key} produced a time that was never recorded: ${s.at}`,
    );
  }
});

test("steps beyond the current status are pending, not done", () => {
  const steps = buildTimeline("packed", {
    ...NONE,
    placedAt: T("10:00"),
    confirmedAt: T("10:01"),
    packedAt: T("10:20"),
  });
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  assert.equal(byKey.created.state, "done");
  assert.equal(byKey.confirmed.state, "done");
  assert.equal(byKey.packed.state, "current");
  assert.equal(byKey.assigned.state, "pending");
  assert.equal(byKey.picked_up.state, "pending");
  assert.equal(byKey.delivered.state, "pending");
});

test("a cancelled order does not display the rest of the happy path", () => {
  // Five greyed-out future steps under "Cancelled" implies it is still
  // going somewhere.
  const steps = buildTimeline("cancelled", { ...NONE, placedAt: T("10:00"), cancelledAt: T("10:05") });
  assert.equal(steps.length, 2);
  assert.equal(steps[1].key, "cancelled");
  assert.equal(steps[1].state, "failed");
  assert.ok(!steps.some((s) => s.key === "delivered"));
});

test("a failed payment shows no fulfilment steps at all", () => {
  const steps = buildTimeline("payment_failed", { ...NONE, placedAt: T("10:00") });
  assert.equal(steps.length, 2);
  assert.equal(steps[1].state, "failed");
  assert.ok(!steps.some((s) => ["packed", "assigned", "picked_up"].includes(s.key)));
});

test("an unpaid order shows nothing after 'placed' as done", () => {
  for (const status of ["created", "payment_pending"] as OrderStatus[]) {
    const steps = buildTimeline(status, { ...NONE, placedAt: T("10:00") });
    for (const s of steps.slice(1)) {
      assert.equal(s.state, "pending", `${status}: ${s.key} should be pending before payment`);
    }
  }
});

test("a failed delivery keeps the steps that genuinely happened", () => {
  // The order really was packed, assigned and picked up. Erasing that
  // would misrepresent what the store and runner actually did.
  const steps = buildTimeline("delivery_failed", {
    ...NONE,
    placedAt: T("10:00"),
    confirmedAt: T("10:01"),
    packedAt: T("10:20"),
    assignedAt: T("10:25"),
    pickedUpAt: T("10:30"),
  });
  const keys = steps.map((s) => s.key);
  assert.ok(keys.includes("picked_up"));
  assert.equal(steps[steps.length - 1].key, "delivery_failed");
  assert.equal(steps[steps.length - 1].state, "failed");
  assert.ok(!keys.includes("delivered"), "a failed delivery must not show 'Delivered'");
});

test("a recorded timestamp wins over a missing earlier one", () => {
  // Reaching a later status without an earlier timestamp is real (an admin
  // transition, a backfill). The step is shown as done with no time rather
  // than as still pending, which would contradict the status.
  const steps = buildTimeline("picked_up", {
    ...NONE,
    placedAt: T("10:00"),
    pickedUpAt: T("10:30"),
  });
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  assert.equal(byKey.packed.state, "done");
  assert.equal(byKey.packed.at, null, "no time may be invented for a missing timestamp");
  assert.equal(byKey.picked_up.state, "current");
});

test("no step hint promises a delivery time", () => {
  // An invented ETA is the most damaging fabrication in a delivery app,
  // because the customer plans around it.
  const banned = /\b(\d+\s*(min|minute|hour|hr))|eta|estimated|arriv/i;
  for (const status of [
    "created", "confirmed", "packed", "assigned", "picked_up",
    "delivered", "delivery_failed", "cancelled", "payment_failed",
  ] as OrderStatus[]) {
    for (const s of buildTimeline(status, NONE)) {
      assert.ok(!banned.test(s.hint), `${status}/${s.key} hint implies a time: "${s.hint}"`);
      assert.ok(!banned.test(s.label), `${status}/${s.key} label implies a time: "${s.label}"`);
    }
  }
});

test("every status has customer-facing wording", () => {
  for (const status of [
    "created", "payment_pending", "confirmed", "packed", "assigned",
    "picked_up", "delivered", "delivery_failed", "cancelled", "payment_failed",
  ] as OrderStatus[]) {
    const h = statusHeadline(status);
    assert.ok(h.title.length > 0 && h.body.length > 0, `${status} has no wording`);
    // The database vocabulary must not leak to the customer.
    assert.ok(!h.title.includes("_"), `${status} leaks a raw enum value`);
  }
});

test("terminal statuses are exactly the ones nothing follows", () => {
  assert.ok(isTerminal("delivered"));
  assert.ok(isTerminal("cancelled"));
  assert.ok(isTerminal("payment_failed"));
  // delivery_failed is NOT terminal: it can still be resolved.
  assert.ok(!isTerminal("delivery_failed"));
  assert.ok(!isTerminal("picked_up"));
  assert.ok(!isTerminal("confirmed"));
});
