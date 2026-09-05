/**
 * The password credential model — rules, in one pure place.
 *
 * THE MODEL, stated once so nobody has to infer it:
 *
 *   The phone number is the identity. A password is an OPTIONAL, ADDITIONAL
 *   credential on that same identity — never a second account.
 *
 * That is the whole design, and it is what makes this safe to add to a
 * product that was OTP-only. Verified against real staging before any of
 * this UI was written:
 *
 *   1. OTP sign-in issues a token carrying the server `role` claim.
 *   2. `updateUser({ password })` on that session enrols a password on the
 *      SAME `auth.users` row.
 *   3. `signInWithPassword({ phone, password })` then works.
 *   4. The user id is IDENTICAL across both paths - no duplicate identity,
 *      no orphan profile.
 *   5. The password-issued token ALSO carries the `role` claim, so role
 *      routing is unaffected by which credential was used.
 *   6. A wrong password is rejected.
 *
 * Point 5 was the one that mattered. Had the custom access token hook not
 * run on the password path, password sign-in would have produced a session
 * with no role - and role routing would have silently degraded for anyone
 * who used it.
 *
 * RECOVERY is deliberately not a separate mechanism. "Forgot password"
 * routes back through OTP, which is a channel that already exists and
 * already proves control of the number. Building an email reset would have
 * meant a dead end: email signup is disabled on this project, so no
 * message could be delivered.
 *
 * No password value is ever logged, stored locally, or placed in a query
 * string. This module only decides whether a candidate is acceptable.
 */

/** Minimum length. Length beats composition rules for real-world strength. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Supabase's own limit. Enforced here so the user sees a useful message
 * instead of a raw provider error.
 */
export const MAX_PASSWORD_LENGTH = 72;

export type PasswordProblem =
  | "too_short"
  | "too_long"
  | "whitespace_only"
  | "mismatch";

/**
 * Deliberately NOT a composition policy (one upper, one digit, one symbol).
 * Those rules push people toward `Password1!` and are weaker in practice
 * than length. Length plus the provider's own breach protections is the
 * better trade for a consumer app.
 */
export function validatePassword(password: string): PasswordProblem | null {
  if (password.trim().length === 0) return "whitespace_only";
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "too_long";
  return null;
}

export function validatePasswordPair(
  password: string,
  confirmation: string,
): PasswordProblem | null {
  const single = validatePassword(password);
  if (single) return single;
  if (password !== confirmation) return "mismatch";
  return null;
}

/** Customer-facing wording. Never exposes a provider message. */
export function passwordProblemMessage(problem: PasswordProblem): string {
  switch (problem) {
    case "too_short":
      return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    case "too_long":
      return `Passwords can be at most ${MAX_PASSWORD_LENGTH} characters.`;
    case "whitespace_only":
      return "Enter a password.";
    case "mismatch":
      return "Those two passwords don't match.";
  }
}

/**
 * Sign-in failures.
 *
 * "Invalid login credentials" is returned for BOTH a wrong password and an
 * account with no password set, and that ambiguity is deliberate on
 * Supabase's part - distinguishing them would tell an attacker which phone
 * numbers are registered. The message below preserves that: it does not
 * confirm the number exists, and it offers the code route, which is the
 * genuine way forward whether the password is wrong or was never set.
 */
export function passwordSignInMessage(rawMessage: string | undefined): string {
  const m = (rawMessage ?? "").toLowerCase();

  if (m.includes("invalid login credentials")) {
    return "That number and password don't match. You can sign in with a code instead.";
  }
  if (m.includes("network") || m.includes("fetch")) {
    return "No connection. Check your network and try again.";
  }
  if (m.includes("rate") || m.includes("too many")) {
    return "Too many attempts. Wait a moment before trying again.";
  }
  return "We couldn't sign you in. Try again, or use a code instead.";
}
