import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  addItem,
  type CartItems,
  decrementItem,
  incrementItem,
  removeItem,
  setItemQty,
} from "./logic.ts";

/**
 * Client cart store — Phase 4 prompt §3.
 *
 * Holds ONLY `{ productId -> qty }`. Never a price, subtotal, delivery
 * fee, discount, wallet amount, payable, or inventory count — every one
 * of those is recomputed server-side by `create_order` at checkout. All
 * mutations delegate to the pure functions in `./logic.ts`. Persisted to
 * AsyncStorage so a cart survives an app restart (a per-device
 * convenience, still never authoritative).
 */
interface CartState {
  items: CartItems;
  add: (productId: string, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: {},
      add: (productId, qty = 1) => set((s) => ({ items: addItem(s.items, productId, qty) })),
      setQty: (productId, qty) => set((s) => ({ items: setItemQty(s.items, productId, qty) })),
      increment: (productId) => set((s) => ({ items: incrementItem(s.items, productId) })),
      decrement: (productId) => set((s) => ({ items: decrementItem(s.items, productId) })),
      remove: (productId) => set((s) => ({ items: removeItem(s.items, productId) })),
      clear: () => set({ items: {} }),
    }),
    {
      name: "craavee-cart",
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
