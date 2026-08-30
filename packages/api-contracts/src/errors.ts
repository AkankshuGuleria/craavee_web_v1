// Canonical error code catalogue — API_CONTRACTS.md §5, verbatim. Every
// Edge Function response's `error.code` is one of these; clients branch
// on `code`, never on `message` (API_CONTRACTS.md: "do not rely on
// arbitrary human-readable strings as API contracts").
export const ERROR_CODES = [
  // Input validation (API_CONTRACTS.md §4 concern 1) — the §5 table
  // never named the code for a malformed request; `400` + a `details`
  // field was specified without a `code`. Named here (Phase 4) so the
  // envelope's "code is always one of the catalogue" rule holds for a
  // validation failure too.
  "VALIDATION_FAILED",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "INVALID_ADDRESS",
  "STORE_CLOSED",
  "SERVICE_UNAVAILABLE",
  "ITEM_UNAVAILABLE",
  "INSUFFICIENT_STOCK",
  "INSUFFICIENT_BALANCE",
  // Promo failures (Phase 4). API_CONTRACTS.md §3 `create_order`
  // describes an "INVALID_PROMO-class rejection" in its execution
  // narrative but §5's table predated a concrete promo-error split;
  // these two names are the ones the Phase 4 prompt §22 requires and are
  // added to the canonical catalogue here (see API_CONTRACTS.md §5,
  // updated, and PHASE_4_IMPLEMENTATION_REPORT.md §12).
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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
