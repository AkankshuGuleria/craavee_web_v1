// Mock payment gateway — Phase 4 ONLY (PHASE_PLAN.md Phase 4, Phase 4
// prompt §33). Validates the D12 contract end-to-end without touching a
// real money gateway. Phase 5 replaces this with a real Razorpay/Cashfree
// adapter behind the identical interface — no change to create_order's
// control flow.
//
// No real gateway SDK. No real secrets. `gatewayOrderRef` is a
// deterministic function of the orderId so a replay rebuilds the same
// checkout params without a second "call".

import {
  type CreatePaymentIntentInput,
  type CreatePaymentIntentResult,
  GatewayError,
  type NormalizedPaymentEvent,
  type PaymentGatewayAdapter,
} from "./types.ts";

export type MockMode = "ok" | "timeout" | "fail";

export class MockGateway implements PaymentGatewayAdapter {
  readonly name = "razorpay" as const;
  private readonly mode: MockMode;

  constructor(mode: MockMode = "ok") {
    this.mode = mode;
  }

  buildCheckoutParams(gatewayOrderRef: string, amountPaise: number): Record<string, unknown> {
    // Pure function of ref + amount — PHASE_1_1_CORRECTIONS.md §4.3
    // scenario C relies on this being rebuildable with no gateway call.
    return {
      gateway: "razorpay",
      mock: true,
      key: "rzp_test_mock",
      order_id: gatewayOrderRef,
      amount: amountPaise,
      currency: "INR",
    };
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult> {
    if (this.mode === "timeout") {
      await new Promise((r) => setTimeout(r, 50));
      throw new GatewayError("mock gateway timed out", "timeout");
    }
    if (this.mode === "fail") {
      throw new GatewayError("mock gateway rejected the intent", "rejected");
    }
    // A stable ref: same order -> same ref (idempotent replay safety).
    const gatewayOrderRef = `mock_order_${input.orderId.replace(/-/g, "")}`;
    return {
      gatewayOrderRef,
      checkoutParams: this.buildCheckoutParams(gatewayOrderRef, input.amountPaise),
    };
  }

  verifyWebhookSignature(_rawBody: string, signatureHeader: string | null): boolean {
    // Phase 4 has no webhook path; a Phase 5 real adapter does HMAC here.
    return signatureHeader === "mock-signature";
  }

  parseWebhookEvent(rawBody: string): NormalizedPaymentEvent {
    const p = JSON.parse(rawBody) as Record<string, unknown>;
    return {
      gateway: "razorpay",
      gatewayEventId: String(p.event_id ?? ""),
      gatewayOrderRef: String(p.order_id ?? ""),
      gatewayPaymentRef: p.payment_id ? String(p.payment_id) : null,
      outcome: p.status === "captured" ? "captured" : "failed",
      amountPaise: Number(p.amount ?? 0),
    };
  }
}
