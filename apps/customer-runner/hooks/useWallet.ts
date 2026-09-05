/**
 * Wallet balance and its ledger.
 *
 * NO BACKEND CHANGE. `wallet_ledger_select` already permits
 * `customer_id = auth.uid()` and `profiles.wallet_balance` is already
 * readable. This closes a gap that mattered: Craavee's refunds are
 * **wallet-only** by decision (D38), so until now a refunded customer got
 * their money back and had **no way to see it**. The credit existed, the
 * evidence did not.
 *
 * The balance comes from `profiles.wallet_balance`, not from summing the
 * ledger. That column is the authoritative figure the checkout spends
 * against, and it is written in the same transaction as the ledger row
 * (D10). Summing client-side would produce a second, subtly different
 * number the moment a page was stale — and two numbers for one balance is
 * how a customer stops trusting a wallet.
 */
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../lib/auth/AuthProvider";
import { supabase } from "../lib/supabase";

/** The six reasons the schema actually defines. */
export type WalletReason =
  | "promo_credit"
  | "referral_credit"
  | "refund"
  | "manual_adjustment"
  | "checkout_redemption"
  | "reservation_reversal";

export interface WalletEntry {
  id: string;
  /** Signed paise. Negative means spent. */
  delta: number;
  reason: WalletReason;
  orderId: string | null;
  createdAt: string;
}

/**
 * Customer-facing wording for each reason.
 *
 * The enum is internal vocabulary. "reservation_reversal" is precise and
 * means nothing to a person; "Order didn't go through" is what actually
 * happened to them. Nothing here invents a reason the schema does not
 * have — all six are mapped, so an unmapped value cannot silently render
 * as a raw enum.
 */
export function walletReasonLabel(reason: WalletReason): string {
  switch (reason) {
    case "refund":
      return "Refund";
    case "promo_credit":
      return "Promotional credit";
    case "referral_credit":
      return "Referral credit";
    case "checkout_redemption":
      return "Used at checkout";
    case "reservation_reversal":
      return "Order didn't go through";
    case "manual_adjustment":
      return "Adjustment by Craavee";
  }
}

export function useWalletBalance() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ["wallet", "balance", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("wallet_balance")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return (data?.wallet_balance as number) ?? 0;
    },
  });
}

/**
 * The most recent movements. Bounded rather than paginated: this is a
 * summary on an account screen, not a statement. A full paginated
 * statement is a separate screen and a separate decision.
 */
export const WALLET_RECENT_LIMIT = 20;

export function useWalletLedger() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ["wallet", "ledger", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<WalletEntry[]> => {
      const { data, error } = await supabase
        .from("wallet_ledger")
        // RLS scopes this to the caller. No client-side customer filter -
        // adding one would imply the server needs help enforcing ownership.
        .select("id, delta, reason, order_id, created_at")
        .order("created_at", { ascending: false })
        .limit(WALLET_RECENT_LIMIT);

      if (error) throw error;

      return (data ?? []).map((row) => {
        const r = row as {
          id: string;
          delta: number;
          reason: WalletReason;
          order_id: string | null;
          created_at: string;
        };
        return {
          id: r.id,
          delta: r.delta,
          reason: r.reason,
          orderId: r.order_id,
          createdAt: r.created_at,
        };
      });
    },
  });
}
