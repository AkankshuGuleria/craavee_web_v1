import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
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
 * Polling (D20 — polling, never Realtime for customers). Phase 8
 * completes D20's schedule; Phase 5 only implemented the narrow
 * payment-confirmation window (5s while `created`).
 *
 * D20, in full:
 *   * 8s while the app is foregrounded and the order is non-terminal
 *   * backing off to 30s after 2 minutes with no state change
 *   * stopped entirely when backgrounded, resuming on foreground
 *
 * This is not a UX preference. It is the stated mitigation for the
 * dossier's launch-day failure #4 — socket fan-out at 800 concurrent
 * customers — which is why a customer never opens a Realtime channel no
 * matter how much nicer that would look next to the staff surfaces.
 *
 * The tracking screen also refetches immediately after any mutation
 * (the mutation hooks invalidate `["orders", id]`), so the poll interval
 * bounds how stale a *passively* watched screen can be, never how long
 * an action takes to reflect.
 */
const POLL_FAST_MS = 8_000;
const POLL_SLOW_MS = 30_000;
const BACKOFF_AFTER_MS = 120_000;

/** Terminal states stop polling: nothing further will change. */
const TERMINAL = new Set(["delivered", "cancelled", "payment_failed"]);

/** True while the app is foregrounded. D20 stops polling entirely when
 *  backgrounded — a screen nobody is looking at should not spend the
 *  customer's battery or our request budget. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

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
  const appActive = useAppActive();
  // When the status last actually changed — not when we last polled.
  // Backing off on "time since the last request" would never back off at
  // all, since every poll resets it.
  // `at` is stamped on the first interval evaluation rather than here:
  // Date.now() during render is impure, and react-hooks/purity rejects it.
  const lastChange = useRef<{ status: string | null; at: number | null }>({ status: null, at: null });

  return useQuery({
    queryKey: ["orders", orderId],
    enabled: !!orderId,
    // Resume promptly when the customer comes back to the app rather
    // than waiting out a full interval.
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const status = (q.state.data as OrderDetail | undefined)?.status ?? null;

      if (lastChange.current.at === null || status !== lastChange.current.status) {
        lastChange.current = { status, at: Date.now() };
      }

      // D20: stopped entirely when backgrounded.
      if (!appActive) return false;
      // Nothing further will happen to a terminal order.
      if (status && TERMINAL.has(status)) return false;

      const idleFor = Date.now() - (lastChange.current.at ?? Date.now());
      return idleFor > BACKOFF_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;
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
