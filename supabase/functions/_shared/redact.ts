// Webhook payload redaction — SECURITY_MODEL.md §4 / DECISION_LOG.md D32.
//
// Redaction happens AT WRITE TIME (before the row is committed), not as a
// later cleanup pass — payment-instrument identifiers (UPI VPA, full card
// number, bank account / IFSC, contact email/phone) are stripped; what
// remains is enough for reconciliation (amount, gateway order/payment
// refs, status, timestamps) without being enough to reconstruct a
// customer's payment instrument.
//
// Both `webhook_events.payload` and `payments.raw_event` store the
// output of this function, never the raw gateway body.

const SENSITIVE_KEYS = new Set([
  "vpa",
  "email",
  "contact",
  "card",
  "card_id",
  "bank",
  "bank_transfer",
  "wallet",
  "acquirer_data",
  "customer_id",
  "token_id",
  "upi",
  "emi",
]);

const KEEP_CARD_KEYS = new Set(["last4", "network", "type", "issuer"]);

function redactValue(key: string, value: unknown): unknown {
  if (key === "card" && value && typeof value === "object") {
    // keep only the non-identifying descriptors of the card
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (KEEP_CARD_KEYS.has(k)) out[k] = v;
    }
    return out;
  }
  if (SENSITIVE_KEYS.has(key)) return "[redacted]";
  return redact(value);
}

/** Deep-clone `input` with every sensitive key redacted. Pure — never
 *  mutates the argument. */
export function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => redact(v));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = redactValue(k, v);
    }
    return out;
  }
  return input;
}
