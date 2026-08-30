// Phase 3: proves the phone/OTP format schemas actually enforce their
// constraints at runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { phoneE164Schema, otpCodeSchema } from "../primitives.ts";

test("phoneE164Schema accepts a well-formed E.164 number", () => {
  assert.equal(phoneE164Schema.safeParse("+919990000001").success, true);
});

test("phoneE164Schema rejects a number missing the leading +", () => {
  assert.equal(phoneE164Schema.safeParse("919990000001").success, false);
});

test("phoneE164Schema rejects a number with letters", () => {
  assert.equal(phoneE164Schema.safeParse("+9199900000a1").success, false);
});

test("otpCodeSchema accepts exactly 6 digits", () => {
  assert.equal(otpCodeSchema.safeParse("123456").success, true);
});

test("otpCodeSchema rejects the wrong length", () => {
  assert.equal(otpCodeSchema.safeParse("12345").success, false);
  assert.equal(otpCodeSchema.safeParse("1234567").success, false);
});

test("otpCodeSchema rejects non-digit characters", () => {
  assert.equal(otpCodeSchema.safeParse("12345a").success, false);
});
