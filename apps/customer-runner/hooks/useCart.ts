import { useMemo } from "react";

import { useCartStore } from "../lib/cart/store";
import { cartCount } from "../lib/cart/logic.ts";
import { useCatalog, type CatalogProduct } from "./useCatalog";

/**
 * Joins the client cart (`{ productId -> qty }`, Zustand) with the live
 * catalog (TanStack Query) to produce renderable line items — Phase 4
 * prompt §3/§4/§21.
 *
 * The `indicativeSubtotal` here is exactly that: INDICATIVE. It exists so
 * the cart/checkout screens can show a number before the customer
 * commits. `create_order` recomputes every amount server-side from
 * `products.sale_price` at transaction time and its response is the only
 * authoritative figure (`hooks/useCreateOrder.ts`).
 *
 * `unavailableLines` / `missingLines` surface the two stale-cart cases the
 * UI must let the customer correct without silently changing the order.
 */
export interface CartLine {
  productId: string;
  qty: number;
  product: CatalogProduct | null; // null -> product vanished from the catalog
  /** indicative only */
  lineTotal: number;
  isAvailable: boolean;
}

export interface CartView {
  lines: CartLine[];
  count: number;
  isEmpty: boolean;
  /** INDICATIVE subtotal (paise). Never sent to the server, never trusted. */
  indicativeSubtotal: number;
  /** lines whose product exists but is currently sold out */
  unavailableLines: CartLine[];
  /** lines whose product is no longer in the catalog at all */
  missingLines: CartLine[];
  /** true when the cart can be taken to checkout as-is */
  canCheckout: boolean;
  isCatalogLoading: boolean;
  isCatalogError: boolean;
}

export function useCart(): CartView {
  const items = useCartStore((s) => s.items);
  const catalog = useCatalog();

  return useMemo(() => {
    const byId = new Map((catalog.data ?? []).map((p) => [p.id, p]));
    const lines: CartLine[] = Object.entries(items)
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => {
        const product = byId.get(productId) ?? null;
        return {
          productId,
          qty,
          product,
          lineTotal: product ? product.salePrice * qty : 0,
          isAvailable: !!product && product.isAvailable,
        };
      });

    const unavailableLines = lines.filter((l) => l.product && !l.product.isAvailable);
    const missingLines = lines.filter((l) => !l.product);
    const indicativeSubtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

    return {
      lines,
      count: cartCount(items),
      isEmpty: lines.length === 0,
      indicativeSubtotal,
      unavailableLines,
      missingLines,
      canCheckout:
        lines.length > 0 &&
        unavailableLines.length === 0 &&
        missingLines.length === 0 &&
        !catalog.isPending,
      isCatalogLoading: catalog.isPending,
      isCatalogError: catalog.isError,
    };
  }, [items, catalog.data, catalog.isPending, catalog.isError]);
}
