/**
 * Maps a `create_order` / `validate_promo` error `code` (the canonical
 * `@craavee/api-contracts` catalogue) to a customer-facing message and a
 * flag for whether it is a "fix your cart / checkout choices" situation
 * vs. a transient "try again" situation — Phase 4 prompt §21/§22/§28.
 *
 * Never surfaces a raw Postgres or gateway string (§22). The client
 * branches on `code`, never on `message`.
 */
import type { ErrorCode } from "@craavee/api-contracts";

export interface OrderUiError {
  title: string;
  message: string;
  /** true -> the customer must change the cart / address / promo / wallet
   *  choice before retrying; false -> a plain retry may succeed. */
  needsCorrection: boolean;
  /** true -> retrying with the SAME idempotency key is safe and correct. */
  retryable: boolean;
}

const MAP: Partial<Record<ErrorCode | "UNKNOWN", OrderUiError>> = {
  VALIDATION_FAILED: { title: "Something's off", message: "Please review your cart and try again.", needsCorrection: true, retryable: false },
  AUTH_REQUIRED: { title: "Session expired", message: "Please sign in again to place your order.", needsCorrection: true, retryable: false },
  FORBIDDEN: { title: "Not allowed", message: "This account can't place customer orders.", needsCorrection: true, retryable: false },
  INVALID_ADDRESS: { title: "Address problem", message: "Pick a delivery address that belongs to you.", needsCorrection: true, retryable: false },
  SERVICE_UNAVAILABLE: { title: "Not deliverable right now", message: "We can't deliver to this address at the moment. Try another address or check back soon.", needsCorrection: true, retryable: true },
  STORE_CLOSED: { title: "Store closed", message: "The store isn't taking orders right now. Please try again later.", needsCorrection: false, retryable: true },
  ITEM_UNAVAILABLE: { title: "Item unavailable", message: "One or more items in your cart are no longer available. Remove them to continue.", needsCorrection: true, retryable: false },
  INSUFFICIENT_STOCK: { title: "Not enough stock", message: "There isn't enough stock for one of your items. Lower the quantity or remove it.", needsCorrection: true, retryable: false },
  INSUFFICIENT_BALANCE: { title: "Wallet is empty", message: "Your wallet balance can't cover any of this order. Uncheck “Use wallet” and pay the full amount.", needsCorrection: true, retryable: false },
  INVALID_PROMO: { title: "Promo not valid", message: "That promo code can't be applied. Remove it to continue.", needsCorrection: true, retryable: false },
  PROMO_LIMIT_REACHED: { title: "Promo already used", message: "This promo has reached its usage limit. Remove it to continue.", needsCorrection: true, retryable: false },
  ORDER_ALREADY_EXISTS: { title: "Already ordered", message: "This checkout was already submitted. Start a new order.", needsCorrection: true, retryable: false },
  PAYMENT_SETUP_FAILED: { title: "Payment setup failed", message: "We couldn't start the payment. Tap retry — your cart is safe.", needsCorrection: false, retryable: true },
  PAYMENT_RECONCILIATION_REQUIRED: { title: "Payment needs review", message: "Your payment went through but we couldn't record it. Support has been alerted — don't pay again.", needsCorrection: false, retryable: false },
  RATE_LIMITED: { title: "Too many attempts", message: "Please wait a moment before trying again.", needsCorrection: false, retryable: true },
};

const FALLBACK: OrderUiError = {
  title: "Couldn't place your order",
  message: "Something went wrong. Please try again in a moment.",
  needsCorrection: false,
  retryable: true,
};

export function toOrderUiError(code: string | undefined): OrderUiError {
  return (code && MAP[code as ErrorCode]) || FALLBACK;
}

/** Error codes that mean "the customer needs to fix the cart/checkout"
 *  — the checkout screen shows a correction state rather than a retry
 *  button (Phase 4 prompt §4/§21). */
export function isCartCorrection(code: string | undefined): boolean {
  return toOrderUiError(code).needsCorrection;
}
