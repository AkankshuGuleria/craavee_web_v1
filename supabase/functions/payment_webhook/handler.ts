// payment_webhook — API_CONTRACTS.md §3, Phase 5 §7/§8/§9/§10.
//
// The gateway (Razorpay) POSTs here — NOT an authenticated Craavee user.
// Authentication is signature verification against the RAW request body
// using the shared webhook secret (D12, EDGE_FUNCTION_ONLY). Order of
// operations is strict (Phase 5 §8):
//
//   1. read the raw body
//   2. verify the signature against those raw bytes
//   3. reject (403, no detail) on an invalid/missing signature
//   4. only THEN parse + normalize the event
//   5. redact the payload (D32) and hand normalized values to the sole
//      DB writer, process_payment_webhook (migration 0005) — one txn:
//      webhook_events dedup, server-side payment lookup by
//      gateway_order_ref, amount/currency verification, confirm / fail /
//      late-capture reconcile.
//
// The webhook is the source of truth for payment success. A client
// payment callback is never trusted (Phase 5 §17). Always acks a fast
// 2xx on a *processed* event — "processed correctly" and "payment
// succeeded" are different things (a failed-payment event is still a
// successful ack). A genuine DB fault returns 500 so the gateway retries.

import { serviceClient } from "../_shared/context.ts";
import { getGateway } from "../_shared/gateway/index.ts";
import { redact } from "../_shared/redact.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "payment_webhook";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function handlePaymentWebhook(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (req.method !== "POST") return json({ ok: false }, 405);

  // ---- 1. RAW body first (the signature is over these exact bytes).
  const rawBody = await req.text();

  // ---- gateway adapter (fail closed on a misconfigured deployed env).
  let gw;
  try {
    gw = getGateway();
  } catch (err) {
    captureException(err, { fn: FN, code: "GATEWAY_CONFIG", level: "fatal" });
    return json({ ok: false }, 500);
  }

  // ---- 2/3. signature verification BEFORE any parse. No body detail on
  // failure (don't hand an attacker a hint — §8, API_CONTRACTS.md §3).
  const sig =
    req.headers.get("x-razorpay-signature") ??
    req.headers.get("x-webhook-signature") ??
    req.headers.get("x-craavee-webhook-signature");
  if (!gw.verifyWebhookSignature(rawBody, sig)) {
    captureException(new Error("invalid or missing webhook signature"), {
      fn: FN,
      code: "WEBHOOK_SIGNATURE_INVALID",
    });
    return new Response("forbidden", { status: 403 });
  }

  // ---- 4. parse + normalize (only now that the payload is trusted).
  let evt;
  try {
    evt = gw.parseWebhookEvent(rawBody);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("UNSUPPORTED_EVENT:")) {
      // a real, signed gateway event Craavee does not act on
      // (refund.*, settlement.*, ...). Ack so the gateway stops retrying.
      return json({ ok: true, ignored: true }, 200);
    }
    captureException(err, { fn: FN, code: "WEBHOOK_PARSE_FAILED" });
    return new Response("bad request", { status: 400 });
  }

  // Dedup key: the gateway's own event id header when present, else the
  // adapter's deterministic body-derived id (both stable on redelivery).
  const eventId = req.headers.get("x-razorpay-event-id") ?? evt.gatewayEventId;

  // ---- 5. redact BEFORE the row is written (D32 — at write time, not
  // an after-the-fact pass).
  let redactedPayload: unknown;
  try {
    redactedPayload = redact(JSON.parse(rawBody));
  } catch {
    redactedPayload = { note: "unparseable body — not stored" };
  }

  const db = serviceClient();
  const { data, error } = await db.rpc("process_payment_webhook", {
    p_gateway: evt.gateway,
    p_event_id: eventId,
    p_order_ref: evt.gatewayOrderRef,
    p_payment_ref: evt.gatewayPaymentRef,
    p_outcome: evt.outcome,
    p_amount: evt.amountPaise,
    p_currency: "INR",
    p_payload: redactedPayload,
  });

  if (error) {
    captureException(error, {
      fn: FN,
      code: "WEBHOOK_PROCESS_FAULT",
      level: "fatal",
      extra: { eventId },
    });
    // 500 -> the gateway retries (correct for a transient DB fault, unlike
    // a signature/parse failure which is permanent).
    return json({ ok: false }, 500);
  }

  const result = (data ?? {}) as {
    action?: string;
    expected?: number;
    reported?: number;
    amount?: number;
  };

  // ---- §23 observability — the events worth a human's attention.
  if (result.action === "amount_mismatch" || result.action === "currency_mismatch") {
    captureException(new Error(`webhook ${result.action}`), {
      fn: FN,
      code: "PAYMENT_AMOUNT_MISMATCH",
      level: "fatal",
      extra: {
        eventId,
        expected: Number(result.expected ?? 0),
        reported: Number(result.reported ?? 0),
      },
    });
  } else if (result.action === "late_capture_reconciled") {
    captureException(new Error("late capture reconciled after order was already terminal"), {
      fn: FN,
      code: "LATE_CAPTURE_RECONCILIATION",
      level: "fatal",
      extra: { eventId, amount: Number(result.amount ?? 0) },
    });
  } else if (result.action === "unknown_order") {
    captureException(new Error("webhook for an unknown gateway order ref"), {
      fn: FN,
      code: "WEBHOOK_UNKNOWN_ORDER",
      extra: { eventId },
    });
  }

  return json({ ok: true }, 200);
}
