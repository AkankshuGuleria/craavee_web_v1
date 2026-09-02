// Inventory administration — Phase 9B.
//
// Two numbers per row, and they mean different things. `on hand` is what
// is physically on the shelf and an admin may correct it. `reserved` is
// what live orders have already claimed, owned entirely by the order
// lifecycle — it is shown so the operator understands why a correction
// can be refused, never edited.
//
// Available = on_hand - reserved is the number a customer effectively
// sees (products_with_availability), so it is the one sorted on: the rows
// that matter are the ones about to run out.
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONSOLE_NAV } from "@/lib/nav";

import { InventoryBoard, type InventoryRow } from "./InventoryBoard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function ConsoleInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; store?: string; low?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const supabase = await createClient();

  let query = supabase
    .from("inventory")
    .select("qty_on_hand, qty_reserved, store_id, product_id, products!inner(name, brand, category, sale_price, is_listed)",
            { count: "exact" });

  if (sp.store) query = query.eq("store_id", sp.store);
  const q = (sp.q ?? "").trim();
  if (q) query = query.ilike("products.name", `%${q}%`);

  const { data, count, error } = await query
    .order("qty_on_hand", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data: storeRows } = await supabase.from("stores").select("id, name").order("name");
  const storeName = new Map(((storeRows ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  const rows: InventoryRow[] = ((data ?? []) as unknown as {
    qty_on_hand: number; qty_reserved: number; store_id: string; product_id: string;
    products: { name: string; brand: string | null; category: string; sale_price: number; is_listed: boolean };
  }[]).map((i) => ({
    storeId: i.store_id,
    storeName: storeName.get(i.store_id) ?? "—",
    productId: i.product_id,
    name: i.products.name,
    brand: i.products.brand,
    category: i.products.category,
    salePrice: i.products.sale_price,
    isListed: i.products.is_listed,
    onHand: i.qty_on_hand,
    reserved: i.qty_reserved,
  }));

  // A "low stock" view is a filter over what is already on the page
  // rather than a second query, because "low" has no authoritative
  // threshold anywhere in the spec — it is a lens, not a business rule.
  const shown = sp.low === "1" ? rows.filter((r) => r.onHand - r.reserved <= 5) : rows;
  const total = count ?? 0;

  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Inventory"
      title="Inventory"
      subtitle={
        error ? "Could not load inventory"
          : `${total.toLocaleString("en-IN")} product${total === 1 ? "" : "s"} stocked · page ${page} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`
      }
    >
      <InventoryBoard
        rows={shown}
        stores={((storeRows ?? []) as { id: string; name: string }[])}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        loadError={error?.message ?? null}
      />
    </OpsShell>
  );
}
