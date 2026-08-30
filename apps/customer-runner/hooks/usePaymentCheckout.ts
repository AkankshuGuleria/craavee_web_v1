import { useCallback, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import type { PaymentIntent } from "@craavee/api-contracts";

/**
 * Opens the gateway's APPROVED hosted checkout (Razorpay Checkout) with
 * the server-built `checkoutParams` — Phase 5 prompt §16/§17.
 *
 * Craavee never collects card/UPI credentials itself: `paymentIntent.
 * checkoutParams` is exactly what Razorpay's own SDK needs to present its
 * hosted sheet. The client-side result of that sheet is PROVISIONAL only
 * (§17): a success callback here just refreshes the order query so the
 * screen re-polls — the order is not "confirmed" until the verified
 * `payment_webhook` says so (§18). A dismissed/failed sheet leaves the
 * order exactly where it was (`created`, reservation intact) so the
 * customer can retry with the same attempt.
 *
 * The native Razorpay SDK (`react-native-razorpay`) is loaded lazily so
 * it is not a hard dependency of the JS bundle — `available` is false
 * until it is linked into an EAS build (PHASE_5_IMPLEMENTATION_REPORT.md
 * §13). When it is unavailable the order screen still works: it falls
 * back to bounded polling and a "check again" affordance.
 */
type RazorpayModule = {
  default?: { open: (opts: Record<string, unknown>) => Promise<unknown> };
  open?: (opts: Record<string, unknown>) => Promise<unknown>;
};

let cachedModule: RazorpayModule | null | undefined;

function loadRazorpay(): RazorpayModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // Optional native dependency — present only once linked into an EAS
    // build (PHASE_5_IMPLEMENTATION_REPORT.md §13). `req` is `require`
    // read off the global so neither the bundler nor lint treats a
    // missing module as a hard error; a plain `import` would.
    const req = (globalThis as { require?: (id: string) => unknown }).require;
    cachedModule = (req ? req("react-native-razorpay") : null) as RazorpayModule | null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export interface UsePaymentCheckout {
  available: boolean;
  status: "idle" | "opening" | "dismissed" | "submitted" | "error";
  open: (intent: PaymentIntent, orderId: string) => Promise<void>;
}

export function usePaymentCheckout(): UsePaymentCheckout {
  const qc = useQueryClient();
  const [status, setStatus] = useState<UsePaymentCheckout["status"]>("idle");
  const mod = loadRazorpay();
  const opener = mod?.default?.open ?? mod?.open ?? null;

  const open = useCallback(
    async (intent: PaymentIntent, orderId: string) => {
      if (!opener) {
        setStatus("error");
        return;
      }
      setStatus("opening");
      try {
        // `checkoutParams` is the gateway-defined options object built by
        // the server adapter (RazorpayGateway.buildCheckoutParams) — key
        // id, order_id, amount, currency, name. Craavee adds nothing
        // sensitive to it here.
        await opener(intent.checkoutParams as Record<string, unknown>);
        // provisional only — the webhook is the source of truth (§17).
        setStatus("submitted");
      } catch {
        // the sheet was dismissed or the payment failed on the gateway
        // side; the order is untouched and can be retried.
        setStatus("dismissed");
      } finally {
        qc.invalidateQueries({ queryKey: ["orders", orderId] });
      }
    },
    [opener, qc],
  );

  return { available: !!opener, status, open };
}
