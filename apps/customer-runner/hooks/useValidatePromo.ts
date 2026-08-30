import { useMutation } from "@tanstack/react-query";

import { supabase } from "../lib/supabase";

/**
 * Advisory promo preview — Phase 4 prompt §7 (ADVISORY level). Calls the
 * `validate_promo` Edge Function so the checkout screen can show a
 * discount before the customer commits. NEVER trusted: `create_order`
 * re-validates the same promo inside its transaction under the promos
 * row lock (§7 AUTHORITATIVE). This response is a UX convenience only.
 */
export interface PromoPreview {
  valid: boolean;
  discountAmount: number;
  reason?: string;
}

export function useValidatePromo() {
  return useMutation({
    mutationFn: async (args: { code: string; orderSubtotal: number }): Promise<PromoPreview> => {
      const { data } = await supabase.functions.invoke("validate_promo", {
        body: { code: args.code.trim(), orderSubtotal: args.orderSubtotal },
      });
      const env = data as { ok: boolean; data?: { valid: boolean; discountAmount?: number; reason?: string } };
      if (!env?.ok || !env.data) return { valid: false, discountAmount: 0, reason: "INVALID_PROMO" };
      return {
        valid: env.data.valid,
        discountAmount: env.data.discountAmount ?? 0,
        reason: env.data.reason,
      };
    },
  });
}
