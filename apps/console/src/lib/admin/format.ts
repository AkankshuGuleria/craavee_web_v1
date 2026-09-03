// Formatting shared by every admin surface. Kept server-safe (no "use
// client") so server components can use it too.

/** Paise -> rupees. Money is stored as an integer everywhere in this
 *  system (DATABASE_SPEC.md); it is only ever divided for display. */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Short order reference. The full uuid is still what every action sends
 *  — this is only what an operator reads out loud. */
export function shortId(id: string | null | undefined): string {
  return id ? `#${id.slice(0, 8)}` : "—";
}

/** Relative time against a caller-supplied `now`, so every row on one
 *  render is measured from the same instant (and so a server component
 *  can read the clock once, outside render). */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 0) return "just now";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function absolute(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** Minutes between two instants, or null when either is missing. */
export function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const ORDER_STATUSES = [
  "created", "confirmed", "packed", "assigned", "picked_up",
  "delivered", "delivery_failed", "cancelled", "payment_failed",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Operational grouping, not a new lifecycle state — these are the same
 *  nine statuses, coloured by what an operator should do about them. */
export function statusTone(status: string): "live" | "done" | "attention" | "dead" {
  switch (status) {
    case "delivery_failed": return "attention";
    case "delivered": return "done";
    case "cancelled":
    case "payment_failed": return "dead";
    default: return "live";
  }
}
