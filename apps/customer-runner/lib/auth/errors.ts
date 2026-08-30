/**
 * Canonical auth error codes for the customer-runner UI (Phase 3 §18).
 *
 * Never surface a raw Supabase/PostgREST error message to the end user —
 * map it to one of these first. `message` here is the fallback shown in
 * the UI when nothing more specific is known; it deliberately does not
 * reveal internals (e.g. never distinguishes "phone not found" from
 * "wrong OTP," matching SECURITY_MODEL.md §2's enumeration-resistance
 * note: Supabase's own generic responses already avoid confirming/denying
 * account existence, and this mapping preserves that rather than adding
 * back a more specific message client-side).
 */
export const AUTH_ERROR_CODES = [
  "INVALID_PHONE",
  "OTP_SEND_FAILED",
  "INVALID_OTP",
  "OTP_EXPIRED",
  "SESSION_EXPIRED",
  "NETWORK_ERROR",
  "RATE_LIMITED",
  "UNKNOWN",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export interface AuthUiError {
  code: AuthErrorCode;
  message: string;
}

const MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_PHONE: "Enter a valid phone number, including the country code.",
  OTP_SEND_FAILED: "Couldn't send a code right now. Please try again in a moment.",
  INVALID_OTP: "That code isn't right. Check the SMS and try again.",
  OTP_EXPIRED: "That code has expired. Request a new one.",
  SESSION_EXPIRED: "Your session expired. Please sign in again.",
  NETWORK_ERROR: "No connection. Check your network and try again.",
  RATE_LIMITED: "Too many attempts. Wait a moment before trying again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

/**
 * Maps a thrown/returned Supabase Auth error (or a network failure) to a
 * canonical code. Supabase's JS client doesn't expose a stable per-case
 * error *code* for every phone-OTP failure mode in every version (some
 * are HTTP-status-only), so this matches on `status` first (stable across
 * SDK versions) and falls back to a message substring only where no
 * status is available — never the other way around.
 */
export function toAuthUiError(error: unknown): AuthUiError {
  if (error instanceof Error && error.message === "Network request failed") {
    return { code: "NETWORK_ERROR", message: MESSAGES.NETWORK_ERROR };
  }

  const status = (error as { status?: number } | null)?.status;
  const rawMessage = (error as { message?: string } | null)?.message?.toLowerCase() ?? "";

  if (status === 429) {
    return { code: "RATE_LIMITED", message: MESSAGES.RATE_LIMITED };
  }
  if (rawMessage.includes("expired")) {
    return { code: "OTP_EXPIRED", message: MESSAGES.OTP_EXPIRED };
  }
  if (rawMessage.includes("token") && (rawMessage.includes("invalid") || rawMessage.includes("otp"))) {
    return { code: "INVALID_OTP", message: MESSAGES.INVALID_OTP };
  }
  if (rawMessage.includes("phone") && rawMessage.includes("invalid")) {
    return { code: "INVALID_PHONE", message: MESSAGES.INVALID_PHONE };
  }
  if (status === 400 || status === 422) {
    // A 400/422 with no clearer signal is treated as the send-side
    // failure (the more common of the two 400-shaped cases in practice —
    // OTP send validation), not silently swallowed as UNKNOWN.
    return { code: "OTP_SEND_FAILED", message: MESSAGES.OTP_SEND_FAILED };
  }

  return { code: "UNKNOWN", message: MESSAGES.UNKNOWN };
}
