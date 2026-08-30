import { test } from "node:test";
import assert from "node:assert/strict";
import { toAuthUiError } from "../errors.ts";

test("maps a 429 to RATE_LIMITED", () => {
  assert.equal(toAuthUiError({ status: 429, message: "rate limit exceeded" }).code, "RATE_LIMITED");
});

test("maps an expired-token message to OTP_EXPIRED", () => {
  assert.equal(toAuthUiError({ status: 403, message: "Token has expired" }).code, "OTP_EXPIRED");
});

test("maps an invalid-token message to INVALID_OTP", () => {
  assert.equal(toAuthUiError({ status: 403, message: "Token is invalid" }).code, "INVALID_OTP");
});

test("maps a network failure to NETWORK_ERROR", () => {
  assert.equal(toAuthUiError(new Error("Network request failed")).code, "NETWORK_ERROR");
});

test("maps an unrecognized 400 to OTP_SEND_FAILED", () => {
  assert.equal(toAuthUiError({ status: 400, message: "something odd" }).code, "OTP_SEND_FAILED");
});

test("maps a completely unknown error to UNKNOWN without throwing", () => {
  assert.equal(toAuthUiError(null).code, "UNKNOWN");
  assert.equal(toAuthUiError(undefined).code, "UNKNOWN");
  assert.equal(toAuthUiError("a plain string").code, "UNKNOWN");
});
