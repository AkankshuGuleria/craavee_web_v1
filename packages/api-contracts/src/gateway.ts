// Payment gateway abstraction boundary — DECISION_LOG.md D12.
//
// `create_order` (Phase B) and `payment_webhook` (Phase 5) call ONLY this
// interface, never a gateway SDK directly. Exactly one adapter implements
// it per environment: a **mock** adapter in Phase 4 (local integration
// tests), swapped for a real Razorpay/Cashfree adapter in Phase 5 behind
// the same interface with no change to the calling control flow
// (PHASE_PLAN.md Phase 4/5).
//
// This file is the CONTRACT only. Implementations live outside
// packages/api-contracts:
//   - supabase/functions/_shared/gateway/mock.ts   (Phase 4 mock)
//   - supabase/functions/_shared/gateway/razorpay.ts (Phase 5, not built)

/** Amounts are always integer paise (D7). */
export interface CreatePaymentIntentInput {
  orderId: string;
  amountPaise: number;
  /** Opaque per-gateway currency code; "INR" for both supported gateways. */
  currency: "INR";
}

export interface CreatePaymentIntentResult {
  /** The gateway's own order/intent reference — persisted to
   *  `payments.gateway_order_ref` in Phase C. */
  gatewayOrderRef: string;
  /** Everything the client SDK needs to open the gateway's hosted
   *  checkout. Shape is gateway-defined and opaque to Craavee; it is a
   *  pure function of `gatewayOrderRef` + amount, so it can be rebuilt on
   *  an idempotent replay without a second gateway call
   *  (PHASE_1_1_CORRECTIONS.md §4.3 scenario C). */
  checkoutParams: Record<string, unknown>;
}

/** Normalized shape `parseWebhookEvent` produces from a raw gateway
 *  payload — Phase 5 consumes this; defined here so the contract is
 *  complete. */
export interface NormalizedPaymentEvent {
  gateway: "razorpay" | "cashfree";
  gatewayEventId: string;
  gatewayOrderRef: string;
  gatewayPaymentRef: string | null;
  /** "captured" or "failed" — the two outcomes Craavee acts on. */
  outcome: "captured" | "failed";
  amountPaise: number;
}

export interface PaymentGatewayAdapter {
  /** Gateway name, matching the `payments.gateway` CHECK
   *  (`'razorpay' | 'cashfree'`); the mock adapter reports `'razorpay'`
   *  so the persisted row is schema-valid. */
  readonly name: "razorpay" | "cashfree";

  /** Phase B — called with NO Postgres transaction open (D24). */
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult>;

  /** Rebuild the client checkout params for an order whose
   *  `gateway_order_ref` is already known — pure, no network call. */
  buildCheckoutParams(gatewayOrderRef: string, amountPaise: number): Record<string, unknown>;

  /** Phase 5 — webhook signature verification against the raw body. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;

  /** Phase 5 — normalize a raw gateway webhook payload. */
  parseWebhookEvent(rawBody: string): NormalizedPaymentEvent;
}

/** Thrown by an adapter when the gateway call itself fails or times out —
 *  the Edge Function maps this to `PAYMENT_SETUP_FAILED` (safe to retry
 *  with the same idempotencyKey). */
export class GatewayError extends Error {
  readonly kind: "timeout" | "rejected" | "unavailable";
  constructor(message: string, kind: "timeout" | "rejected" | "unavailable") {
    super(message);
    this.name = "GatewayError";
    this.kind = kind;
  }
}
