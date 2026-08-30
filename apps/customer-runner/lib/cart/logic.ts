/**
 * Pure cart operations — Phase 4 prompt §3/§4. No React, no storage, no
 * network: just `Record<productId, qty>` transforms, unit-tested directly
 * (`__tests__/logic.test.ts`). `store.ts` wraps these in a persisted
 * Zustand store.
 *
 * Qty per line is clamped to 1..MAX_QTY_PER_LINE (matches
 * `@craavee/validation`'s `quantitySchema`; the server re-checks 1..20
 * regardless — this is a UX guard, never the enforcement point).
 */
export const MAX_QTY_PER_LINE = 20;

export type CartItems = Record<string, number>;

const clampQty = (n: number): number => Math.max(0, Math.min(MAX_QTY_PER_LINE, Math.floor(n)));

export function addItem(items: CartItems, productId: string, qty = 1): CartItems {
  const next = clampQty((items[productId] ?? 0) + qty);
  if (next <= 0) return items;
  return { ...items, [productId]: next };
}

export function setItemQty(items: CartItems, productId: string, qty: number): CartItems {
  const next = clampQty(qty);
  if (next <= 0) return removeItem(items, productId);
  return { ...items, [productId]: next };
}

export function incrementItem(items: CartItems, productId: string): CartItems {
  return { ...items, [productId]: clampQty((items[productId] ?? 0) + 1) };
}

export function decrementItem(items: CartItems, productId: string): CartItems {
  const next = (items[productId] ?? 0) - 1;
  if (next <= 0) return removeItem(items, productId);
  return { ...items, [productId]: next };
}

export function removeItem(items: CartItems, productId: string): CartItems {
  if (!(productId in items)) return items;
  const { [productId]: _removed, ...rest } = items;
  return rest;
}

/** Total units across all lines (for a cart badge). */
export function cartCount(items: CartItems): number {
  return Object.values(items).reduce((a, b) => a + b, 0);
}

/** The wire shape create_order expects: `[{ productId, qty }]`. */
export function toOrderItems(items: CartItems): { productId: string; qty: number }[] {
  return Object.entries(items)
    .filter(([, qty]) => qty > 0)
    .map(([productId, qty]) => ({ productId, qty }));
}
