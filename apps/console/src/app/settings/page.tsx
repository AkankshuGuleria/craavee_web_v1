// Service controls — Phase 9 §15, ENGINEERING_SPECIFICATION.md §11.
//
// The "kill switch" is `stores.is_open`, and it is worth being precise
// about where it actually bites, because the interesting part is not on
// this page: create_order (migration 0004, step 4) reads the flag INSIDE
// the transaction that creates the order and raises STORE_CLOSED. A
// checkout racing a pause is therefore resolved by Postgres, not by this
// UI and not by a disabled button in the customer app.
//
// Existing orders deliberately keep moving. The spec is explicit: "a
// paused store rejects new create_order calls but nothing about a pause
// touches orders already in flight". Pausing is not an emergency stop for
// the whole business; it stops new work arriving.
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/lib/realtime/RealtimeRefresh";
import { CONSOLE_NAV } from "@/lib/nav";
import { OpsShell } from "@craavee/ui";

import { ServiceControls, type StoreState } from "./ServiceControls";

export const dynamic = "force-dynamic";

async function load(): Promise<{ stores: StoreState[]; error: string | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("stores")
    .select("id, name, is_open, pause_reason, max_queue_depth")
    .order("name");
  if (error) return { stores: [], error: error.message };

  // Live queue depth against the threshold, so the number on screen is
  // the same one create_order compares (0004 step 4) rather than a
  // different definition of "busy".
  const { data: live } = await supabase
    .from("orders")
    .select("store_id, status")
    .not("status", "in", "(delivered,cancelled,payment_failed,delivery_failed)");
  const depth = new Map<string, number>();
  for (const o of ((live ?? []) as { store_id: string }[])) {
    depth.set(o.store_id, (depth.get(o.store_id) ?? 0) + 1);
  }

  return {
    error: null,
    stores: ((data ?? []) as {
      id: string; name: string; is_open: boolean; pause_reason: string | null; max_queue_depth: number;
    }[]).map((s) => ({
      id: s.id,
      name: s.name,
      isOpen: s.is_open,
      pauseReason: s.pause_reason,
      maxQueueDepth: s.max_queue_depth,
      liveOrders: depth.get(s.id) ?? 0,
    })),
  };
}

export default async function ConsoleSettingsPage() {
  await requireAdmin();
  const { stores, error } = await load();
  const paused = stores.filter((s) => !s.isOpen).length;

  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Settings"
      title="Service controls"
      subtitle={
        error
          ? "Could not load store settings"
          : paused > 0
            ? `${paused} of ${stores.length} ${stores.length === 1 ? "store is" : "stores are"} paused — no new orders accepted there`
            : "Taking orders"
      }
    >
      <RealtimeRefresh table="orders" storeId={null} />
      <ServiceControls stores={stores} loadError={error} />
    </OpsShell>
  );
}
