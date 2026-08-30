// Packer order detail (Phase 6 §8/§9).
//
// Shows only what is needed to assemble the bag: the lines, their
// quantities, and how much of each is still outstanding. Deliberately NOT
// shown: the customer's identity, their address, their wallet ledger, the
// payment record, or any gateway payload. The packer is not being asked
// to deliver the order, and `addresses` is scoped to customer-or-admin in
// migration 0003 — this page does not widen that, and Phase 7's runner
// surface is where delivery detail belongs.
import { notFound } from "next/navigation";
import { OpsShell } from "@craavee/ui";

import { STORE_NAV } from "@/lib/nav";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PackingActions } from "./PackingActions";

export const dynamic = "force-dynamic";

export default async function PackingDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requireStaff();
  const { orderId } = await params;
  const supabase = await createClient();

  // No store filter here on purpose — orders_select already restricts a
  // packer to their own store's confirmed/packed orders, so an order from
  // elsewhere simply does not exist for this session.
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, placed_at, confirmed_at, packed_at, order_items(id, qty, fulfilled_qty, stock_out_at, product_id, products(name))")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) notFound();

  const items = (order.order_items ?? []).map((i) => ({
    id: i.id,
    name: (i.products as { name: string } | null)?.name ?? "Unknown item",
    qty: i.qty,
    fulfilledQty: i.fulfilled_qty,
    reconciled: i.stock_out_at !== null,
  }));

  return (
    <OpsShell
      brand="Craavee Store"
      navItems={STORE_NAV}
      active="Packing"
      title={`Order ${order.id.slice(0, 8)}`}
      subtitle={
        order.status === "packed"
          ? "Packed — nothing left to do"
          : `${items.length} ${items.length === 1 ? "line" : "lines"} to pick`
      }
    >
      <PackingActions orderId={order.id} status={order.status} items={items} />
    </OpsShell>
  );
}
