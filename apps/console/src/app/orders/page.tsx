// Console live operations board (Phase 8, §21).
//
// Server component: the query runs as the signed-in admin through the
// anon key, so `orders_select` (migration 0003) decides what is
// returned. No store filter is written here — an admin has all-store
// scope, and if this file were wrong RLS would still be the boundary.
//
// The board's visuals are untouched (OrdersBoard.tsx is the Phase 2B
// markup verbatim). What changed is that the metrics and columns are now
// derived from real rows rather than hardcoded constants, which is what
// makes a live update meaningful at all.
//
// `requireAdmin` was added this phase because without it the Console had
// no authenticated identity, so every authoritative query returned
// nothing and there was no real state to broadcast.
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { OrdersBoard, type BoardColumn, type BoardMetric } from "./OrdersBoard";

export const dynamic = "force-dynamic";

const COLUMNS: { id: string; title: string; status: string }[] = [
  { id: "placed", title: "Placed", status: "confirmed" },
  { id: "packed", title: "Packed", status: "packed" },
  { id: "assigned", title: "Assigned", status: "assigned" },
  { id: "picked-up", title: "Picked Up", status: "picked_up" },
  { id: "delivered", title: "Delivered", status: "delivered" },
];

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

interface BoardData {
  metrics: BoardMetric[];
  kanbanColumns: BoardColumn[];
}

/** Kept out of the component body deliberately: `Date.now()` is impure and
 *  must not run during render (react-hooks/purity). It is read once here
 *  and threaded through, which also means every relative time on one
 *  render is measured from the same instant. */
async function loadBoard(): Promise<BoardData> {
  const now = Date.now();
  const supabase = await createClient();

  const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("orders")
    .select("id, status, placed_at, delivered_at, order_items(qty)")
    .gte("placed_at", since)
    .order("placed_at", { ascending: false })
    .limit(200);

  const orders = (data ?? []) as {
    id: string;
    status: string;
    placed_at: string | null;
    delivered_at: string | null;
    order_items: { qty: number }[] | null;
  }[];

  const kanbanColumns: BoardColumn[] = COLUMNS.map((c) => {
    const rows = orders.filter((o) => o.status === c.status);
    return {
      id: c.id,
      title: c.title,
      count: rows.length,
      orders: rows.slice(0, 6).map((o) => ({
        id: `#${o.id.slice(0, 8)}`,
        items: `${(o.order_items ?? []).reduce((n, i) => n + i.qty, 0)} items`,
        time: ago(o.placed_at, now),
        // A confirmed order still waiting after 10 minutes is the one an
        // operator should look at first.
        priority:
          c.status === "confirmed" &&
          !!o.placed_at &&
          now - new Date(o.placed_at).getTime() > 10 * 60 * 1000,
      })),
    };
  });

  const lastHour = orders.filter(
    (o) => o.placed_at && now - new Date(o.placed_at).getTime() < 60 * 60 * 1000,
  ).length;

  const delivered = orders.filter((o) => o.delivered_at && o.placed_at);
  const avgMins = delivered.length
    ? Math.round(
        delivered.reduce(
          (n, o) => n + (new Date(o.delivered_at!).getTime() - new Date(o.placed_at!).getTime()) / 60000,
          0,
        ) / delivered.length,
      )
    : 0;

  const { count: activeRunners } = await supabase
    .from("runners")
    .select("id", { count: "exact", head: true })
    .eq("is_online", true);

  const queueDepth = orders.filter((o) => ["confirmed", "packed"].includes(o.status)).length;

  const metrics: BoardMetric[] = [
    { label: "Orders / hr", value: String(lastHour), change: "", warning: false },
    { label: "Avg fulfillment", value: delivered.length ? `${avgMins}m` : "\u2014", change: "", warning: false },
    { label: "Active runners", value: String(activeRunners ?? 0), change: "", warning: false },
    {
      label: "Queue depth",
      value: String(queueDepth),
      change: queueDepth >= 10 ? "Near capacity" : "",
      warning: queueDepth >= 10,
    },
  ];

  return { metrics, kanbanColumns };
}

export default async function ConsoleOrdersPage() {
  await requireAdmin();
  const { metrics, kanbanColumns } = await loadBoard();
  return <OrdersBoard metrics={metrics} kanbanColumns={kanbanColumns} />;
}
