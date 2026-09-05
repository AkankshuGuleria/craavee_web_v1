/**
 * Password credential rules.
 *
 * The properties worth pinning here are the ones that fail SILENTLY and
 * dangerously: an error message that confirms a phone number exists, or a
 * provider string leaking to the customer.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordProblemMessage,
  passwordSignInMessage,
  validatePassword,
  validatePasswordPair,
} from "../password.ts";

test("a password shorter than the minimum is rejected", () => {
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1)), "too_short");
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH)), null);
});

test("the provider's own length ceiling is enforced client-side", () => {
  // Otherwise the customer sees a raw provider error instead of a useful one.
  assert.equal(validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1)), "too_long");
  assert.equal(validatePassword("a".repeat(MAX_PASSWORD_LENGTH)), null);
});

test("whitespace is not a password", () => {
  assert.equal(validatePassword("          "), "whitespace_only");
});

test("a long password is not silently truncated or 'fixed'", () => {
  // Truncating to fit would mean the stored credential differs from what the
  // customer typed - they would then fail to sign in with their own password.
  const long = "b".repeat(MAX_PASSWORD_LENGTH + 20);
  assert.equal(validatePassword(long), "too_long");
});

test("confirmation mismatch is caught before anything is sent", () => {
  assert.equal(validatePasswordPair("correct-horse", "correct-horse"), null);
  assert.equal(validatePasswordPair("correct-horse", "correct-horsE"), "mismatch");
});

test("length is checked before mismatch, so the more useful error wins", () => {
  assert.equal(validatePasswordPair("short", "different"), "too_short");
});

test("no composition policy is enforced", () => {
  // Deliberate: composition rules push people toward "Password1!", which is
  // weaker in practice than length. If someone adds one later, this test
  // should make them argue for it rather than slip it in.
  assert.equal(validatePassword("all lowercase letters no digits"), null);
});

test("a failed sign-in never confirms whether the number is registered", () => {
  // Supabase returns "Invalid login credentials" for BOTH a wrong password
  // and an account that has no password set. Preserving that ambiguity is
  // the point - distinguishing them would tell an attacker which phone
  // numbers exist.
  const msg = passwordSignInMessage("Invalid login credentials");
  for (const leak of ["not found", "no account", "not registered", "doesn't exist", "no password"]) {
    assert.ok(!msg.toLowerCase().includes(leak), `message leaks account existence: "${msg}"`);
  }
  // And it still offers a real way forward.
  assert.ok(/code/i.test(msg), "message should offer the OTP route");
});

test("raw provider strings never reach the customer", () => {
  for (const raw of [
    "Invalid login credentials",
    "AuthApiError: something internal",
    "fetch failed",
    "over_request_rate_limit",
    undefined,
  ]) {
    const msg = passwordSignInMessage(raw);
    assert.ok(!msg.includes("AuthApiError"), `leaked provider class: ${msg}`);
    assert.ok(!msg.includes("over_request_rate_limit"), `leaked provider code: ${msg}`);
    assert.ok(msg.length > 0);
  }
});

test("every problem has customer-facing wording with no enum leakage", () => {
  for (const p of ["too_short", "too_long", "whitespace_only", "mismatch"] as const) {
    const msg = passwordProblemMessage(p);
    assert.ok(msg.length > 0);
    assert.ok(!msg.includes("_"), `raw enum leaked into copy: ${msg}`);
  }
});
