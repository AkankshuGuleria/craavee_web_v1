// Canonical error catalogue — a Deno-side mirror of
// packages/api-contracts/src/errors.ts (the edge runtime cannot import
// from outside supabase/functions/). The integration test suite imports
// the REAL ERROR_CODES from @craavee/api-contracts and asserts this list
// is identical, so drift fails CI.
export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "INVALID_ADDRESS",
  "STORE_CLOSED",
  "SERVICE_UNAVAILABLE",
  "ITEM_UNAVAILABLE",
  "INSUFFICIENT_STOCK",
  "INSUFFICIENT_BALANCE",
  "INVALID_PROMO",
  "PROMO_LIMIT_REACHED",
  "PAYMENT_FAILED",
  "PAYMENT_SETUP_FAILED",
  "PAYMENT_RECONCILIATION_REQUIRED",
  "PAYMENT_ORDER_STATE_MISMATCH",
  "REFUND_EXCEEDS_CAPTURED",
  "PAYMENT_PENDING",
  "ORDER_ALREADY_EXISTS",
  "INVALID_ORDER_TRANSITION",
  "JOB_ALREADY_CLAIMED",
  "RUNNER_ALREADY_ASSIGNED",
  "DELIVERY_CODE_INVALID",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// HTTP status per code — API_CONTRACTS.md §2/§5.
const HTTP_STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  INVALID_ADDRESS: 400,
  STORE_CLOSED: 422,
  SERVICE_UNAVAILABLE: 422,
  ITEM_UNAVAILABLE: 422,
  INSUFFICIENT_STOCK: 422,
  INSUFFICIENT_BALANCE: 422,
  INVALID_PROMO: 422,
  PROMO_LIMIT_REACHED: 422,
  PAYMENT_FAILED: 422,
  PAYMENT_SETUP_FAILED: 422,
  PAYMENT_RECONCILIATION_REQUIRED: 500,
  PAYMENT_ORDER_STATE_MISMATCH: 409,
  REFUND_EXCEEDS_CAPTURED: 422,
  PAYMENT_PENDING: 202,
  // 200 in the catalogue is the *silent idempotent replay* case, which
  // returns an `ok` envelope with the existing order — not this code. As
  // an *error* code (a same-key / different-payload conflict) it is 409.
  ORDER_ALREADY_EXISTS: 409,
  INVALID_ORDER_TRANSITION: 409,
  JOB_ALREADY_CLAIMED: 409,
  RUNNER_ALREADY_ASSIGNED: 409,
  DELIVERY_CODE_INVALID: 400,
  RATE_LIMITED: 429,
  VALIDATION_FAILED: 400,
};

export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}

const CODE_SET = new Set<string>(ERROR_CODES);

/**
 * A plpgsql business-rule failure is raised as `'<CODE>: <detail>'` with
 * SQLSTATE P0001 (migration 0004, same convention as the existing
 * enforce_order_transition trigger). supabase-js surfaces it as
 * `error.message`. Recover the canonical ErrorCode from the prefix; if
 * the prefix is not a known code (a genuine unexpected DB fault), return
 * null so the caller emits a 500 without leaking the raw message.
 */
export function parseDbError(message: string | undefined): { code: ErrorCode; detail: string } | null {
  if (!message) return null;
  const idx = message.indexOf(": ");
  const prefix = idx === -1 ? message : message.slice(0, idx);
  if (!CODE_SET.has(prefix)) return null;
  return { code: prefix as ErrorCode, detail: idx === -1 ? "" : message.slice(idx + 2) };
}
