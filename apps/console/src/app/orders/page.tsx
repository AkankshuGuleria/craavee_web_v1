// Operational order list — Phase 9A §4.
//
// Server-side filtering, searching and pagination. The browser never
// receives the order table: the query is built from the URL, `range()`
// asks Postgres for one page, and `count: "exact"` gives the total
// without shipping the rows. That matters operationally — this page has
// to stay usable at 50,000 orders, not 200.
//
// Filters live in the URL so an operator can bookmark "everything that
// failed today" and share the link with whoever is on shift.
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/lib/realtime/RealtimeRefresh";
import { CONSOLE_NAV } from "@/lib/nav";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/admin/format";

import { OrderList, type OrderRow, type RunnerOption, type StoreOption } from "./OrderList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
// A uuid, or the 8-char prefix the Console shows as the order reference.
const ID_PREFIX = /^[0-9a-f]{4,}$/i;

interface Search {
  status?: string;
  store?: string;
  runner?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: string;
}

export default async function ConsoleOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const now = Date.now();
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select(
      "id, status, payable, placed_at, delivered_at, store_id, runner_id, order_items(qty)",
      { count: "exact" },
    );

  // Narrowed against the enum before it reaches the query: an unknown
  // ?status= is ignored rather than passed through to Postgres.
  const status = (ORDER_STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as OrderStatus)
    : null;
  if (status) query = query.eq("status", status);
  if (sp.store) query = query.eq("store_id", sp.store);
  if (sp.runner === "none") query = query.is("runner_id", null);
  else if (sp.runner) query = query.eq("runner_id", sp.runner);
  if (sp.from) query = query.gte("placed_at", new Date(sp.from).toISOString());
  if (sp.to) {
    // An inclusive end date: "to 5 Sep" should include the whole of 5 Sep.
    const end = new Date(sp.to);
    end.setHours(23, 59, 59, 999);
    query = query.lte("placed_at", end.toISOString());
  }

  // Order-id search only. Searching by customer name would need a join
  // through profiles on every row — RBAC permits an admin to read it, but
  // it is a different (and slower) query, and the operational lookup an
  // admin actually does from a support call is the order reference.
  const q = (sp.q ?? "").trim().replace(/^#/, "");
  if (q && ID_PREFIX.test(q)) query = query.ilike("id", `${q}%`);

  const { data, count, error } = await query
    .order("placed_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const rows = (data ?? []) as unknown as {
    id: string; status: string; payable: number; placed_at: string | null;
    delivered_at: string | null; store_id: string; runner_id: string | null;
    order_items: { qty: number }[] | null;
  }[];

  const [{ data: runnerRows }, { data: storeRows }] = await Promise.all([
    supabase.from("runners").select("id, store_id, profiles(full_name)"),
    supabase.from("stores").select("id, name").order("name"),
  ]);

  const runners: RunnerOption[] = ((runnerRows ?? []) as unknown as {
    id: string; store_id: string; profiles: { full_name: string | null } | null;
  }[]).map((r) => ({ id: r.id, storeId: r.store_id, name: r.profiles?.full_name ?? "Unnamed runner" }));
  const runnerName = new Map(runners.map((r) => [r.id, r.name]));
  const stores: StoreOption[] = ((storeRows ?? []) as { id: string; name: string }[]).map((s) => ({
    id: s.id, name: s.name,
  }));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  const orders: OrderRow[] = rows.map((o) => ({
    id: o.id,
    status: o.status,
    payable: o.payable,
    placedAt: o.placed_at,
    units: (o.order_items ?? []).reduce((n, i) => n + i.qty, 0),
    storeName: storeName.get(o.store_id) ?? "—",
    runnerName: o.runner_id ? (runnerName.get(o.runner_id) ?? "Unknown") : null,
  }));

  const total = count ?? 0;
  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Orders"
      title="Orders"
      subtitle={
        error
          ? "Could not load orders"
          : total === 0
            ? "No orders match these filters"
            : `${total.toLocaleString("en-IN")} matching · page ${page} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`
      }
    >
      <RealtimeRefresh table="orders" storeId={null} />
      <OrderList
        orders={orders}
        runners={runners}
        stores={stores}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        now={now}
        loadError={error?.message ?? null}
      />
    </OpsShell>
  );
}
