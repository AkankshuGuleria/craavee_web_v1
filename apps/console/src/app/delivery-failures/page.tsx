// Failed-delivery recovery queue — Phase 9 §7.
//
// This queue exists because Phase 8 shipped `delivery_failed` as a real
// exit for a runner who cannot hand an order over, and then had nowhere
// to put the result: PHASE_8_FINAL_CHECKPOINT.md §9(7) records that these
// orders "accumulate until an admin acts" and are "visible only in the
// database". Every row here is a customer who paid and has nothing.
//
// The two recovery actions are not invented for this screen. They are
// ORDER_STATE_MACHINE.md #13 (reassign) and #14 (cancel + full refund),
// the only two admin transitions out of `delivery_failed` — and the page
// reads that fact out of `order_transition_rules` at request time rather
// than hardcoding it, so a rule change lands here without a code change.
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/lib/realtime/RealtimeRefresh";
import { CONSOLE_NAV } from "@/lib/nav";
import { OpsShell } from "@craavee/ui";

import { FailureQueue, type FailedOrder, type EligibleRunner } from "./FailureQueue";

export const dynamic = "force-dynamic";

interface OrderRow {
  id: string;
  store_id: string;
  status: string;
  payable: number;
  placed_at: string | null;
  runner_id: string | null;
  order_items: { qty: number }[] | null;
  addresses: { block: string; floor: string | null; room: string; landmark: string | null } | null;
}

async function load(): Promise<{
  orders: FailedOrder[];
  runners: EligibleRunner[];
  actions: string[];
  now: number;
  error: string | null;
}> {
  const now = Date.now();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, store_id, status, payable, placed_at, runner_id, order_items(qty), addresses(block, floor, room, landmark)",
    )
    .eq("status", "delivery_failed")
    .order("placed_at", { ascending: true })
    .limit(200);

  if (error) return { orders: [], runners: [], actions: [], now, error: error.message };

  const rows = (data ?? []) as unknown as OrderRow[];
  const ids = rows.map((o) => o.id);

  // The reason lives where mark_delivery_failed put it (0008): the audit
  // row's metadata. It is not duplicated onto `orders`, so it is read
  // back from the audit log rather than denormalised for this screen.
  const reasons = new Map<string, { reason: string | null; at: string }>();
  if (ids.length) {
    const { data: logs } = await supabase
      .from("audit_logs")
      .select("entity_id, metadata, created_at")
      .eq("action", "order.delivery_failed")
      .in("entity_id", ids)
      .order("created_at", { ascending: false });
    for (const l of (logs ?? []) as { entity_id: string; metadata: Record<string, unknown>; created_at: string }[]) {
      // Newest first, so the first row per order is the latest attempt.
      if (!reasons.has(l.entity_id)) {
        reasons.set(l.entity_id, { reason: (l.metadata?.reason as string) ?? null, at: l.created_at });
      }
    }
  }

  // Who is holding each failed order, and who could take it instead.
  const { data: runnerRows } = await supabase
    .from("runners")
    .select("id, store_id, is_online, profiles(full_name)")
    .order("joined_at", { ascending: true });

  // A runner with a live job cannot take another (one-live-job, D13).
  // Computing it here only greys the option out; claim_job and
  // process_admin_reassign are what actually refuse.
  const { data: liveRows } = await supabase
    .from("orders")
    .select("runner_id")
    .in("status", ["assigned", "picked_up"])
    .not("runner_id", "is", null);
  const busy = new Set(((liveRows ?? []) as { runner_id: string }[]).map((r) => r.runner_id));

  const runners: EligibleRunner[] = ((runnerRows ?? []) as unknown as {
    id: string; store_id: string; is_online: boolean; profiles: { full_name: string | null } | null;
  }[]).map((r) => ({
    id: r.id,
    storeId: r.store_id,
    name: r.profiles?.full_name ?? "Unnamed runner",
    isOnline: r.is_online,
    busy: busy.has(r.id),
  }));

  const runnerName = new Map(runners.map((r) => [r.id, r.name]));

  const { data: rules } = await supabase
    .from("order_transition_rules")
    .select("to_status")
    .eq("from_status", "delivery_failed")
    .eq("actor", "admin");

  return {
    now,
    error: null,
    runners,
    actions: ((rules ?? []) as { to_status: string }[]).map((r) => r.to_status),
    orders: rows.map((o) => {
      const r = reasons.get(o.id);
      const a = o.addresses;
      return {
        id: o.id,
        storeId: o.store_id,
        status: o.status,
        payable: o.payable,
        placedAt: o.placed_at,
        failedAt: r?.at ?? null,
        reason: r?.reason ?? null,
        runnerId: o.runner_id,
        runnerName: o.runner_id ? (runnerName.get(o.runner_id) ?? "Unknown runner") : null,
        units: (o.order_items ?? []).reduce((n, i) => n + i.qty, 0),
        location: a ? [a.block && `Block ${a.block}`, a.floor && `Floor ${a.floor}`, `Room ${a.room}`].filter(Boolean).join(" · ") : "—",
        landmark: a?.landmark ?? null,
      };
    }),
  };
}

export default async function DeliveryFailuresPage() {
  await requireAdmin();
  const { orders, runners, actions, now, error } = await load();

  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Failures"
      title="Failed deliveries"
      subtitle={
        error
          ? "Could not load the queue"
          : orders.length === 0
            ? "Nothing waiting — every delivery either landed or is still in flight"
            : `${orders.length} ${orders.length === 1 ? "order needs" : "orders need"} a decision`
      }
    >
      {/* Live because a delivery can fail while this page is open — and
          because a colleague resolving one should remove it here too. */}
      <RealtimeRefresh table="orders" storeId={null} />
      <FailureQueue orders={orders} runners={runners} actions={actions} now={now} loadError={error} />
    </OpsShell>
  );
}
