// Payment gateway abstraction — DECISION_LOG.md D12. Deno-side mirror of
// packages/api-contracts/src/gateway.ts (the edge runtime cannot import
// from outside supabase/functions/). Keep the two in sync — the
// integration suite imports the real interface and type-checks a mock
// against it.

export interface CreatePaymentIntentInput {
  orderId: string;
  amountPaise: number;
  currency: "INR";
}

export interface CreatePaymentIntentResult {
  gatewayOrderRef: string;
  checkoutParams: Record<string, unknown>;
}

export interface NormalizedPaymentEvent {
  gateway: "razorpay" | "cashfree";
  gatewayEventId: string;
  gatewayOrderRef: string;
  gatewayPaymentRef: string | null;
  outcome: "captured" | "failed";
  amountPaise: number;
}

export interface PaymentGatewayAdapter {
  readonly name: "razorpay" | "cashfree";
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult>;
  buildCheckoutParams(gatewayOrderRef: string, amountPaise: number): Record<string, unknown>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  parseWebhookEvent(rawBody: string): NormalizedPaymentEvent;
}

export class GatewayError extends Error {
  readonly kind: "timeout" | "rejected" | "unavailable";
  constructor(message: string, kind: "timeout" | "rejected" | "unavailable") {
    super(message);
    this.name = "GatewayError";
    this.kind = kind;
  }
}
