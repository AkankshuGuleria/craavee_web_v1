import { useCallback, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";

import type { CreateOrderResponse } from "@craavee/api-contracts";

import { toOrderItems } from "../lib/cart/logic.ts";
import { useCartStore } from "../lib/cart/store";
import { toOrderUiError, type OrderUiError } from "../lib/orders/errors.ts";
import { supabase } from "../lib/supabase";

/**
 * Drives a checkout attempt against the `create_order` Edge Function —
 * Phase 4 prompt §13/§14.
 *
 * Idempotency (§14): ONE `idempotencyKey` is generated per checkout
 * ATTEMPT and reused for every retry of that attempt (network failure,
 * `PAYMENT_SETUP_FAILED`, user tapping "retry"). A NEW key is generated
 * only when the customer deliberately starts a fresh checkout
 * (`resetAttempt`). The key never comes from the server.
 *
 * The response's financial summary is the ONLY authoritative one — the
 * cart's indicative subtotal is never trusted (§12).
 */
export interface CheckoutInput {
  addressId: string;
  promoCode?: string;
  useWallet?: boolean;
}

type Status = "idle" | "submitting" | "success" | "error";

interface Envelope {
  ok: boolean;
  data?: CreateOrderResponse;
  error?: { code: string };
}

export interface UseCreateOrder {
  status: Status;
  order: CreateOrderResponse | null;
  error: OrderUiError | null;
  errorCode: string | null;
  submit: (input: CheckoutInput) => Promise<CreateOrderResponse | null>;
  /** Start a brand-new checkout attempt (new idempotency key). */
  resetAttempt: () => void;
}

export function useCreateOrder(): UseCreateOrder {
  const qc = useQueryClient();
  const clearCart = useCartStore((s) => s.clear);
  const items = useCartStore((s) => s.items);

  const keyRef = useRef<string>(Crypto.randomUUID());
  const [status, setStatus] = useState<Status>("idle");
  const [order, setOrder] = useState<CreateOrderResponse | null>(null);
  const [error, setError] = useState<OrderUiError | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const resetAttempt = useCallback(() => {
    keyRef.current = Crypto.randomUUID();
    setStatus("idle");
    setOrder(null);
    setError(null);
    setErrorCode(null);
  }, []);

  const submit = useCallback(
    async (input: CheckoutInput): Promise<CreateOrderResponse | null> => {
      setStatus("submitting");
      setError(null);
      setErrorCode(null);

      const body = {
        idempotencyKey: keyRef.current,
        addressId: input.addressId,
        items: toOrderItems(items),
        ...(input.promoCode ? { promoCode: input.promoCode } : {}),
        ...(input.useWallet ? { useWallet: true } : {}),
      };

      const invoked = await supabase.functions.invoke("create_order", { body });

      // supabase-js surfaces a non-2xx with the response body attached;
      // unwrap the canonical envelope either way.
      const envelope: Envelope =
        (invoked.error ? await safeJson(invoked.error) : (invoked.data as Envelope)) ??
        { ok: false, error: { code: "UNKNOWN" } };

      if (!envelope.ok || !envelope.data) {
        const code = envelope.error?.code ?? "UNKNOWN";
        setErrorCode(code);
        setError(toOrderUiError(code));
        setStatus("error");
        return null;
      }

      setOrder(envelope.data);
      setStatus("success");
      // Nothing in this phase mutated the catalog rows we read, but the
      // reservation just changed availability — Phase 3 §7's note: the
      // create_order call site owns this invalidation.
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      // Clear the cart only once the order actually exists.
      clearCart();
      return envelope.data;
    },
    [items, qc, clearCart],
  );

  return { status, order, error, errorCode, submit, resetAttempt };
}

async function safeJson(err: unknown): Promise<Envelope | null> {
  try {
    const ctx = (err as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") return await ctx.json();
  } catch {
    /* fall through */
  }
  return null;
}
