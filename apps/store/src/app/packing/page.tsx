// Live packer queue (Phase 6 §6).
//
// Server component. The query runs as the signed-in staff user through
// the anon key, so orders_select in migration 0003 does the scoping:
// `auth_role() = 'packer' and store_id = auth_store_id() and status in
// ('confirmed','packed')`. There is no store_id filter written here on
// purpose — if this file forgot one, RLS would still return nothing from
// another store. The database is the boundary, not this page.
//
// Ordering is oldest-first: the queue is a FIFO of orders the customer is
// already waiting on. Backed by the (store_id, status, placed_at) index
// added in migration 0006.
//
// Polling, not Realtime (Phase 6 §7): a staff queue with a handful of
// concurrent viewers does not justify a subscription, and the full
// Realtime architecture is Phase 8's. `revalidate` keeps this honest
// without inventing infrastructure that a later phase has to unpick.
import Link from "next/link";
import { ArrowRight, Package } from "@phosphor-icons/react/ssr";
import { OpsShell } from "@craavee/ui";

import { STORE_NAV } from "@/lib/nav";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 15;

function minutesAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
}

export default async function StorePackingPage() {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("orders")
    .select("id, status, placed_at, confirmed_at, order_items(id, qty, fulfilled_qty, stock_out_at)")
    .eq("status", "confirmed")
    .order("placed_at", { ascending: true })
    .limit(50);

  const orders = data ?? [];

  return (
    <OpsShell
      brand="Craavee Store"
      navItems={STORE_NAV}
      active="Packing"
      title="Packing queue"
      subtitle={
        error
          ? "Could not load the queue"
          : `${orders.length} ${orders.length === 1 ? "order" : "orders"} waiting to be packed`
      }
    >
      <div className="max-w-2xl space-y-4">
        {error && (
          <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            The queue could not be loaded. Refresh to try again — nothing has been packed or changed.
          </p>
        )}

        {!error && orders.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <Package size={28} weight="duotone" className="mx-auto mb-3 text-white/40" />
            <p className="text-sm text-white/60">Nothing to pack right now.</p>
            <p className="mt-1 text-xs text-white/35">Confirmed orders appear here automatically.</p>
          </div>
        )}

        {orders.map((o) => {
          const items = o.order_items ?? [];
          const units = items.reduce((n, i) => n + i.qty, 0);
          const reconciled = items.filter((i) => i.stock_out_at !== null).length;
          return (
            <Link
              key={o.id}
              href={`/packing/${o.id}`}
              className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-white/25 hover:bg-white/10"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-mono text-sm text-white/90">{o.id.slice(0, 8)}</p>
                <p className="text-xs text-white/50">
                  {items.length} {items.length === 1 ? "line" : "lines"} · {units} units ·{" "}
                  {minutesAgo(o.confirmed_at ?? o.placed_at)}
                </p>
                {reconciled > 0 && (
                  <p className="text-xs text-amber-300/80">
                    {reconciled} {reconciled === 1 ? "line" : "lines"} already reconciled
                  </p>
                )}
              </div>
              <ArrowRight size={18} weight="bold" className="shrink-0 text-white/40" />
            </Link>
          );
        })}
      </div>
    </OpsShell>
  );
}
