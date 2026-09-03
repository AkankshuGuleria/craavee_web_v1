// Catalog administration — Phase 9B.
//
// The safety property worth stating up front, because it is the thing an
// operator will worry about: changing a price here CANNOT change what
// anyone has already paid. `order_items.unit_price` is a snapshot copied
// at create_order time, and `orders.subtotal`/`payable` are stored
// integers — nothing recomputes from `products.sale_price` afterwards.
// A price edit affects the next customer and nobody else. Test 17 pins
// that so it stays true.
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONSOLE_NAV } from "@/lib/nav";

import { CatalogBoard, type ProductRow } from "./CatalogBoard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function ConsoleCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; store?: string; listed?: string; page?: string }>;
}) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const supabase = await createClient();

  let query = supabase
    .from("products")
    .select("id, store_id, name, brand, category, unit_label, mrp, sale_price, is_listed", { count: "exact" });

  if (sp.store) query = query.eq("store_id", sp.store);
  if (sp.listed === "1") query = query.eq("is_listed", true);
  if (sp.listed === "0") query = query.eq("is_listed", false);
  const q = (sp.q ?? "").trim();
  if (q) query = query.ilike("name", `%${q}%`);

  const { data, count, error } = await query
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data: storeRows } = await supabase.from("stores").select("id, name").order("name");
  const stores = ((storeRows ?? []) as { id: string; name: string }[]);
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  const products: ProductRow[] = ((data ?? []) as {
    id: string; store_id: string; name: string; brand: string | null; category: string;
    unit_label: string | null; mrp: number; sale_price: number; is_listed: boolean;
  }[]).map((p) => ({
    id: p.id, storeId: p.store_id, storeName: storeName.get(p.store_id) ?? "—",
    name: p.name, brand: p.brand, category: p.category, unitLabel: p.unit_label,
    mrp: p.mrp, salePrice: p.sale_price, isListed: p.is_listed,
  }));

  const total = count ?? 0;
  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Catalog"
      title="Catalog"
      subtitle={
        error ? "Could not load the catalog"
          : `${total.toLocaleString("en-IN")} product${total === 1 ? "" : "s"} · page ${page} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`
      }
    >
      <CatalogBoard
        products={products}
        stores={stores}
        defaultStoreId={admin.storeId ?? stores[0]?.id ?? ""}
        total={total} page={page} pageSize={PAGE_SIZE}
        loadError={error?.message ?? null}
      />
    </OpsShell>
  );
}
