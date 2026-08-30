import { useQuery } from "@tanstack/react-query";

import { supabase } from "../lib/supabase";

/**
 * Reads a single order + its items + payment for the confirmation /
 * details screen — Phase 4 prompt §20, Phase 5 prompt §16/§18.
 *
 * Reads go through the existing RLS policies (`orders_select` /
 * `order_items_select` scoped to `customer_id = auth.uid()`,
 * `0003_rls_policies.sql`) and the `payments_customer_view`
 * security-barrier view (customers have no direct grant on `payments`).
 * This screen shows the authoritative, already-persisted figures — not
 * anything the client computed, and never anything a client-side payment
 * callback claimed (Phase 5 §17 — the webhook is the source of truth).
 *
 * Polling (D20 — polling, never Realtime for customers) is BOUNDED
 * (Phase 5 §18): while the order is still `created` (awaiting the
 * webhook) it re-reads every 5s, but stops after ~2 minutes so a stuck
 * order does not poll forever. It also stops immediately once the order
 * reaches any non-`created` state (confirmed / payment_failed /
 * cancelled).
 */
const MAX_POLLS = 24; // ~2 minutes at 5s

export type PaymentUiState =
  | "pending"
  | "captured"
  | "failed"
  | "refunded"
  | "partially_refunded";

export interface OrderDetail {
  id: string;
  status: string;
  paymentStatus: PaymentUiState;
  refundedAmount: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  walletApplied: number;
  payable: number;
  placedAt: string;
  items: { id: string; productId: string; name: string; qty: number; unitPrice: number }[];
}

export function useOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ["orders", orderId],
    enabled: !!orderId,
    refetchInterval: (q) => {
      const s = (q.state.data as OrderDetail | undefined)?.status;
      if (s && s !== "created") return false;
      return q.state.dataUpdateCount > MAX_POLLS ? false : 5000;
    },
    queryFn: async (): Promise<OrderDetail> => {
      const { data: order, error } = await supabase
        .from("orders")
        .select("id, status, subtotal, discount, delivery_fee, wallet_applied, payable, placed_at, order_items(id, product_id, qty, unit_price, products(name))")
        .eq("id", orderId!)
        .single();
      if (error) throw error;

      const { data: pay } = await supabase
        .from("payments_customer_view")
        .select("status, refunded_amount")
        .eq("order_id", orderId!)
        .maybeSingle();

      const rawItems = (order.order_items ?? []) as Array<{
        id: string;
        product_id: string;
        qty: number;
        unit_price: number;
        products: { name: string } | { name: string }[] | null;
      }>;

      return {
        id: order.id,
        status: order.status,
        paymentStatus: ((pay?.status as PaymentUiState) ?? "pending"),
        refundedAmount: (pay?.refunded_amount as number) ?? 0,
        subtotal: order.subtotal,
        discount: order.discount,
        deliveryFee: order.delivery_fee,
        walletApplied: order.wallet_applied,
        payable: order.payable,
        placedAt: order.placed_at,
        items: rawItems.map((it) => {
          const prod = (Array.isArray(it.products) ? it.products[0] : it.products) as { name: string } | null;
          return {
            id: it.id,
            productId: it.product_id,
            name: prod?.name ?? "Item",
            qty: it.qty,
            unitPrice: it.unit_price,
          };
        }),
      };
    },
  });
}
