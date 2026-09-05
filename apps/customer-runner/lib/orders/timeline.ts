/**
 * The order timeline — derived entirely from timestamps that actually
 * exist on the `orders` row.
 *
 * `orders` carries `placed_at`, `confirmed_at`, `packed_at`,
 * `assigned_at`, `picked_up_at`, `delivered_at` and `cancelled_at`. Every
 * step below reads one of those columns and NOTHING is inferred: a step
 * is "done" only if its timestamp is present, and the time shown is the
 * real recorded time.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 *   * No estimated delivery time. Nothing in the schema records a
 *     promise, an SLA or a courier estimate, so any ETA would be invented
 *     — and an invented ETA on a delivery app is the single most
 *     damaging thing you can fabricate, because the customer plans around
 *     it.
 *   * No map, no GPS, no "your runner is 4 minutes away". There is no
 *     location infrastructure. `assigned_at` and `picked_up_at` are the
 *     entire truth about where an order is.
 *   * No fake progress. An order sitting at `confirmed` shows three steps
 *     done and the rest genuinely pending, rather than a bar creeping
 *     forward on a timer.
 *
 * Pure: no React, no network, so the terminal/branching rules are unit
 * testable.
 */

export type OrderStatus =
  | "created"
  | "payment_pending"
  | "confirmed"
  | "packed"
  | "assigned"
  | "picked_up"
  | "delivered"
  | "delivery_failed"
  | "cancelled"
  | "payment_failed";

/** The timestamp columns the timeline reads. All optional on the row. */
export interface OrderTimestamps {
  placedAt: string | null;
  confirmedAt: string | null;
  packedAt: string | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}

export interface TimelineStep {
  key: string;
  label: string;
  /** Detail line. Never a promise — only what happened. */
  hint: string;
  at: string | null;
  state: "done" | "current" | "pending" | "failed";
}

/** Statuses after which nothing further will happen. */
export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "delivered",
  "cancelled",
  "payment_failed",
]);

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * The happy path, in order. `delivery_failed` is NOT a step — it is a
 * branch off `picked_up`, and rendering it inline would imply every order
 * passes through it.
 */
const HAPPY_PATH: { key: OrderStatus; label: string; hint: string; field: keyof OrderTimestamps }[] = [
  { key: "created", label: "Order placed", hint: "We received your order.", field: "placedAt" },
  { key: "confirmed", label: "Confirmed", hint: "Payment confirmed and the store accepted it.", field: "confirmedAt" },
  { key: "packed", label: "Packed", hint: "The store has packed your items.", field: "packedAt" },
  { key: "assigned", label: "Runner assigned", hint: "A runner is on the way to collect it.", field: "assignedAt" },
  { key: "picked_up", label: "Picked up", hint: "Your order is on its way to you.", field: "pickedUpAt" },
  { key: "delivered", label: "Delivered", hint: "Handed over and confirmed with your code.", field: "deliveredAt" },
];

export function buildTimeline(status: OrderStatus, ts: OrderTimestamps): TimelineStep[] {
  // A cancelled or failed-payment order never travelled the happy path.
  // Showing five greyed-out future steps under "Cancelled" implies it is
  // still going somewhere, so those orders get a short, truthful timeline.
  if (status === "cancelled") {
    return [
      { key: "created", label: "Order placed", hint: "We received your order.", at: ts.placedAt, state: "done" },
      { key: "cancelled", label: "Cancelled", hint: "This order was cancelled.", at: ts.cancelledAt, state: "failed" },
    ];
  }

  if (status === "payment_failed") {
    return [
      { key: "created", label: "Order placed", hint: "We received your order.", at: ts.placedAt, state: "done" },
      { key: "payment_failed", label: "Payment failed", hint: "The payment did not go through. Nothing was charged.", at: null, state: "failed" },
    ];
  }

  const reachedIndex = HAPPY_PATH.findIndex((s) => s.key === status);

  const steps: TimelineStep[] = HAPPY_PATH.map((step, i) => {
    const at = ts[step.field];
    let state: TimelineStep["state"];

    if (at) {
      // A recorded timestamp is the strongest evidence a step happened,
      // and is trusted over the status field.
      state = i === reachedIndex ? "current" : "done";
    } else if (reachedIndex >= 0 && i < reachedIndex) {
      // Reached a later status without this one's timestamp. That is a
      // real possibility (a backfill, an admin transition), so the step is
      // shown as done but with no time rather than as still pending.
      state = "done";
    } else {
      state = "pending";
    }

    return { key: step.key, label: step.label, hint: step.hint, at, state };
  });

  // Still awaiting payment: the order exists but nothing after it is real
  // yet. Only the first step is done.
  if (status === "created" || status === "payment_pending") {
    return steps.map((s, i) =>
      i === 0 ? { ...s, state: s.at ? "current" : "pending" } : { ...s, state: "pending" },
    );
  }

  // A failed delivery attaches to the end rather than replacing the path:
  // the order genuinely was packed, assigned and picked up.
  if (status === "delivery_failed") {
    return [
      ...steps.slice(0, 5),
      {
        key: "delivery_failed",
        label: "Delivery failed",
        hint: "We couldn't complete the delivery. Support can help sort this out.",
        at: null,
        state: "failed",
      },
    ];
  }

  return steps;
}

/**
 * Customer-facing status wording.
 *
 * The database vocabulary is for the state machine, not for a person
 * standing in a corridor waiting for food. `picked_up` in particular is
 * about the runner; "On the way" is about the customer.
 */
export function statusHeadline(status: OrderStatus): { title: string; body: string } {
  switch (status) {
    case "created":
    case "payment_pending":
      return { title: "Payment pending", body: "We're confirming your payment with the gateway." };
    case "confirmed":
      return { title: "Order confirmed", body: "The store will start packing shortly." };
    case "packed":
      return { title: "Packed", body: "Waiting for a runner to collect your order." };
    case "assigned":
      return { title: "Runner assigned", body: "A runner is heading to the store." };
    case "picked_up":
      return { title: "On the way", body: "Have your delivery code ready." };
    case "delivered":
      return { title: "Delivered", body: "Thanks for ordering with Craavee." };
    case "delivery_failed":
      return { title: "Delivery failed", body: "We couldn't complete this delivery." };
    case "cancelled":
      return { title: "Cancelled", body: "This order was cancelled." };
    case "payment_failed":
      return { title: "Payment failed", body: "Nothing was charged. You can try again." };
  }
}
