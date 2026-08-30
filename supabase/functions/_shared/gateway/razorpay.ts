// Real Razorpay adapter — Phase 5 (D37). Implements the D12
// PaymentGatewayAdapter contract (packages/api-contracts/src/gateway.ts /
// ./types.ts) with NO change to that interface. create_order Phase B and
// payment_webhook call only the interface; swapping mock -> razorpay is
// purely _shared/gateway/index.ts's getGateway() factory.
//
// Razorpay was selected over Cashfree per D12's preferred order: it is
// the more widely-integrated Indian gateway, its Checkout SDK is the one
// the mock adapter already emulated (name='razorpay', order_id shape,
// checkoutParams keys), and a free test-mode account needs no KYC to
// exercise Orders + webhooks end to end. Production (live-key) use is
// gated on merchant KYC — see PHASE_5_IMPLEMENTATION_REPORT.md §2/§21.
//
// Secrets (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET)
// are EDGE_FUNCTION_ONLY (SECURITY_MODEL.md §3) — read from the runtime
// env only, never bundled into a client, never logged.

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

import {
  type CreatePaymentIntentInput,
  type CreatePaymentIntentResult,
  GatewayError,
  type NormalizedPaymentEvent,
  type PaymentGatewayAdapter,
} from "./types.ts";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const INTENT_TIMEOUT_MS = 10_000;

/** Constant-time compare over the raw signature bytes (node:crypto is
 *  synchronous — keeps `verifyWebhookSignature` a plain boolean per the
 *  D12 interface, no contract change). */
function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return nodeTimingSafeEqual(ab, bb);
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

export class RazorpayGateway implements PaymentGatewayAdapter {
  readonly name = "razorpay" as const;

  // Explicit fields (not constructor parameter properties) so the module
  // parses under Node's strip-only TypeScript loader, which the Phase 5
  // integration suite uses to import this adapter directly.
  #keyId: string;
  #keySecret: string;
  #webhookSecret: string;

  constructor(keyId: string, keySecret: string, webhookSecret: string) {
    if (!keyId || !keySecret || !webhookSecret) {
      throw new Error("RazorpayGateway: keyId, keySecret and webhookSecret are all required");
    }
    this.#keyId = keyId;
    this.#keySecret = keySecret;
    this.#webhookSecret = webhookSecret;
  }

  buildCheckoutParams(gatewayOrderRef: string, amountPaise: number): Record<string, unknown> {
    // Pure function of ref + amount + the (stable) publishable key id —
    // PHASE_1_1_CORRECTIONS.md §4.3 scenario C rebuilds this on an
    // idempotent replay with NO gateway call. These are the standard
    // Razorpay Checkout options the client SDK opens the hosted sheet
    // with; `key` is the publishable key id, never the secret.
    return {
      gateway: "razorpay",
      key: this.#keyId,
      order_id: gatewayOrderRef,
      amount: amountPaise,
      currency: "INR",
      name: "Craavee",
      description: "Craavee order payment",
    };
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult> {
    // Phase B — NO Postgres transaction open (D24). Server-authoritative
    // amount only (Phase 5 prompt §5): input.amountPaise comes from
    // orders.payable, never the client.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), INTENT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${RAZORPAY_API}/orders`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${this.#keyId}:${this.#keySecret}`)}`,
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: input.currency,
          receipt: input.orderId,
          notes: { craavee_order_id: input.orderId },
        }),
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new GatewayError("razorpay order creation timed out", "timeout");
      }
      throw new GatewayError(`razorpay order creation failed: ${String(err)}`, "unavailable");
    }
    clearTimeout(timer);

    if (!res.ok) {
      // 4xx (bad request / auth) vs 5xx (gateway down) -> different retry
      // semantics for the Edge Function (both map to PAYMENT_SETUP_FAILED,
      // safe to retry with the same idempotencyKey).
      const kind = res.status >= 500 ? "unavailable" : "rejected";
      // Do NOT echo the gateway body — it can carry account detail.
      throw new GatewayError(`razorpay order creation returned ${res.status}`, kind);
    }

    const order = (await res.json()) as { id?: string; amount?: number };
    if (!order.id) {
      throw new GatewayError("razorpay order creation returned no order id", "rejected");
    }
    // Defense in depth: the gateway echoed a different amount than we asked.
    if (typeof order.amount === "number" && order.amount !== input.amountPaise) {
      throw new GatewayError("razorpay echoed an unexpected order amount", "rejected");
    }

    return {
      gatewayOrderRef: order.id,
      checkoutParams: this.buildCheckoutParams(order.id, input.amountPaise),
    };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
    // Phase 5 prompt §8 — verify against the RAW body bytes, using the
    // shared webhook secret, BEFORE any parsing. Razorpay signs the raw
    // request body with HMAC-SHA256 and sends the hex digest in
    // `X-Razorpay-Signature`.
    if (!signatureHeader) return false;
    const expected = hmacSha256Hex(this.#webhookSecret, rawBody);
    return timingSafeEqualHex(expected, signatureHeader.trim());
  }

  parseWebhookEvent(rawBody: string): NormalizedPaymentEvent {
    let p: RazorpayEvent;
    try {
      p = JSON.parse(rawBody) as RazorpayEvent;
    } catch {
      throw new Error("razorpay webhook body is not valid JSON");
    }
    const event = p.event ?? "";
    const payment = p.payload?.payment?.entity;
    const order = p.payload?.order?.entity;

    if (event === "payment.captured" || (event === "order.paid" && payment)) {
      if (!payment) throw new Error("razorpay payment.captured has no payment entity");
      return {
        gateway: "razorpay",
        gatewayEventId: `${event}:${payment.id}`,
        gatewayOrderRef: String(payment.order_id ?? order?.id ?? ""),
        gatewayPaymentRef: String(payment.id),
        outcome: "captured",
        amountPaise: Number(payment.amount ?? order?.amount ?? 0),
      };
    }
    if (event === "payment.failed") {
      if (!payment) throw new Error("razorpay payment.failed has no payment entity");
      return {
        gateway: "razorpay",
        gatewayEventId: `${event}:${payment.id}`,
        gatewayOrderRef: String(payment.order_id ?? ""),
        gatewayPaymentRef: payment.id ? String(payment.id) : null,
        outcome: "failed",
        amountPaise: Number(payment.amount ?? 0),
      };
    }
    // Any other event type (refund.*, settlement.*, order.paid without a
    // payment entity, ...) is not something Craavee acts on. The handler
    // treats this sentinel as "ack 200, do nothing" rather than a 400.
    throw new Error(`UNSUPPORTED_EVENT:${event}`);
  }
}

interface RazorpayEntity {
  id: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
}
interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    order?: { entity?: RazorpayEntity };
  };
}
