// Adapter selection — Phase 5 (D37).
//
//   create_order Phase B / payment_webhook call `getGateway()` and use
//   ONLY the PaymentGatewayAdapter interface — the control flow does not
//   change between the mock and the real adapter (Phase 5 prompt §3).
//
// Selection + production safety (Phase 5 prompt §25):
//   * PAYMENT_GATEWAY=razorpay (or unset) -> the real Razorpay adapter,
//     which REQUIRES RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET /
//     RAZORPAY_WEBHOOK_SECRET. Missing creds -> throw (fail closed).
//   * PAYMENT_GATEWAY=mock -> the mock adapter, allowed ONLY when
//     CRAAVEE_ALLOW_MOCK_CONTROL=1 AND CRAAVEE_ENV is not
//     production/staging. Otherwise -> throw.
//   * unset PAYMENT_GATEWAY + no Razorpay creds + mock explicitly
//     permitted (local / CI) -> the mock, so the Phase 4 integration
//     suite keeps working with no config. This fallback NEVER applies
//     once CRAAVEE_ENV is production/staging or CRAAVEE_ALLOW_MOCK_CONTROL
//     is unset — a deployed environment with no gateway creds fails
//     closed rather than silently taking mock money.

import { MockGateway, type MockMode } from "./mock.ts";
import { RazorpayGateway } from "./razorpay.ts";
import type { PaymentGatewayAdapter } from "./types.ts";

function env(name: string): string | undefined {
  return Deno.env.get(name) || undefined;
}

/** Mock adapter is permitted only in an explicitly non-production dev/CI
 *  context. */
export function mockGatewayAllowed(): boolean {
  const e = (env("CRAAVEE_ENV") ?? "development").toLowerCase();
  return env("CRAAVEE_ALLOW_MOCK_CONTROL") === "1" && e !== "production" && e !== "staging";
}

function razorpayCreds() {
  return {
    keyId: env("RAZORPAY_KEY_ID"),
    keySecret: env("RAZORPAY_KEY_SECRET"),
    webhookSecret: env("RAZORPAY_WEBHOOK_SECRET"),
  };
}

export function getGateway(mode: MockMode = "ok"): PaymentGatewayAdapter {
  const explicit = (env("PAYMENT_GATEWAY") ?? "").toLowerCase();

  if (explicit === "mock") {
    if (!mockGatewayAllowed()) {
      throw new Error(
        "PRODUCTION_SAFETY: PAYMENT_GATEWAY=mock requires CRAAVEE_ALLOW_MOCK_CONTROL=1 and a non-production/non-staging CRAAVEE_ENV",
      );
    }
    return new MockGateway(mode);
  }

  if (explicit === "razorpay" || explicit === "") {
    const c = razorpayCreds();
    const haveCreds = !!(c.keyId && c.keySecret && c.webhookSecret);
    if (!haveCreds) {
      if (explicit === "" && mockGatewayAllowed()) return new MockGateway(mode);
      throw new Error(
        "PRODUCTION_SAFETY: the Razorpay adapter requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET — refusing to process payments without them",
      );
    }
    return new RazorpayGateway(c.keyId!, c.keySecret!, c.webhookSecret!);
  }

  throw new Error(`PRODUCTION_SAFETY: unknown PAYMENT_GATEWAY '${explicit}'`);
}

export { GatewayError } from "./types.ts";
export type { PaymentGatewayAdapter } from "./types.ts";
