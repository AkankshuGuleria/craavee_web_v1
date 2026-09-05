/**
 * Order history — the customer's own orders, newest first, paginated.
 *
 * NO BACKEND CHANGE. `orders_select` (0003_rls_policies.sql) already
 * permits `customer_id = auth.uid()`, and `order_items_select` permits
 * items of orders you own. The history screen was missing entirely on the
 * client; the data was always readable.
 *
 * Paginated from the first version rather than "later": an order list is
 * the one customer surface that grows without bound, and a screen that
 * works for a month and then downloads a year of orders is a defect
 * shipped on a delay.
 *
 * Never persisted to disk. Order state is money and fulfilment state, and
 * the persistence allowlist (`lib/query/persist.ts`) deliberately excludes
 * the `orders` key — a rehydrated "out for delivery" from yesterday is
 * exactly the failure the tracking P0 was about.
 */
import { useInfiniteQuery } from "@tanstack/react-query";

import { supabase } from "../lib/supabase";
import type { OrderStatus } from "../lib/orders/timeline";

export const ORDERS_PAGE_SIZE = 15;

export interface OrderSummary {
  id: string;
  status: OrderStatus;
  payable: number;
  placedAt: string;
  /** Enough of the contents to recognise the order without opening it. */
  itemCount: number;
  firstItemName: string | null;
  /**
   * Needed to explain a ₹0.00 payable. A wallet-covered order really did
   * cost nothing at checkout, but a bare "₹0.00" in a list reads as a
   * rendering fault - the detail screen says "Paid by wallet" and the list
   * has to be able to say the same.
   */
  walletApplied: number;
}

interface OrdersPage {
  orders: OrderSummary[];
  total: number;
  nextPage: number | null;
}

type OrdersKey = readonly ["orders", "list"];

export function useOrders() {
  return useInfiniteQuery<OrdersPage, Error, { pages: OrdersPage[]; pageParams: number[] }, OrdersKey, number>({
    queryKey: ["orders", "list"] as const,
    initialPageParam: 0,
    // Short: a customer opening history usually just placed something, and
    // an order that moved from packed to picked_up while they were looking
    // at the list should not be stale for a minute.
    staleTime: 15_000,
    getNextPageParam: (last: OrdersPage) => last.nextPage,

    queryFn: async ({ pageParam, signal }): Promise<OrdersPage> => {
      const page = pageParam;
      const from = page * ORDERS_PAGE_SIZE;

      const { data, error, count } = await supabase
        .from("orders")
        .select(
          "id, status, payable, wallet_applied, placed_at, order_items(id, qty, products(name))",
          { count: "exact" },
        )
        // RLS restricts this to the caller's own orders; no client-side
        // customer filter is applied, because a client-side filter would
        // imply the server needed help enforcing ownership. It does not.
        .order("placed_at", { ascending: false })
        .range(from, from + ORDERS_PAGE_SIZE - 1)
        .abortSignal(signal);

      if (error) throw error;

      const orders: OrderSummary[] = (data ?? []).map((row) => {
        const r = row as {
          id: string;
          status: OrderStatus;
          payable: number;
          wallet_applied: number;
          placed_at: string;
          order_items: { id: string; qty: number; products: { name: string } | { name: string }[] | null }[] | null;
        };
        const items = r.order_items ?? [];
        const firstProduct = items[0]?.products;
        const name = Array.isArray(firstProduct) ? firstProduct[0]?.name : firstProduct?.name;

        return {
          id: r.id,
          status: r.status,
          payable: r.payable,
          placedAt: r.placed_at,
          // Line count, not summed quantity: "3 items" meaning three
          // different products is what a customer recognises the order by.
          itemCount: items.length,
          firstItemName: name ?? null,
          walletApplied: r.wallet_applied ?? 0,
        };
      });

      const total = count ?? orders.length;
      const seen = from + orders.length;

      return {
        orders,
        total,
        nextPage: seen < total && orders.length > 0 ? page + 1 : null,
      };
    },
  });
}

export function flattenOrders(pages: OrdersPage[] | undefined): {
  orders: OrderSummary[];
  total: number;
} {
  if (!pages || pages.length === 0) return { orders: [], total: 0 };
  return { orders: pages.flatMap((p) => p.orders), total: pages[0].total };
}
