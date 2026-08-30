import { test } from "node:test";
import assert from "node:assert/strict";

import { ERROR_CODES } from "@craavee/api-contracts";

import { isCartCorrection, toOrderUiError } from "../errors.ts";

test("every mapped code produces a non-empty title + message and never leaks a raw string", () => {
  for (const code of ["INSUFFICIENT_STOCK", "INVALID_PROMO", "STORE_CLOSED", "PAYMENT_SETUP_FAILED"]) {
    const e = toOrderUiError(code);
    assert.ok(e.title.length > 0 && e.message.length > 0);
    assert.ok(!/postgres|pg_|sqlstate|P0001/i.test(e.message));
  }
});

test("an unknown / undefined code falls back to a safe generic message", () => {
  assert.equal(toOrderUiError(undefined).title, "Couldn't place your order");
  assert.equal(toOrderUiError("SOME_NEW_CODE").retryable, true);
});

test("cart-correction codes are flagged, transient ones are not", () => {
  assert.equal(isCartCorrection("INSUFFICIENT_STOCK"), true);
  assert.equal(isCartCorrection("ITEM_UNAVAILABLE"), true);
  assert.equal(isCartCorrection("INVALID_PROMO"), true);
  assert.equal(isCartCorrection("PAYMENT_SETUP_FAILED"), false);
  assert.equal(isCartCorrection("STORE_CLOSED"), false);
});

test("the canonical catalogue's customer-relevant codes are all handled (no silent fallthrough for a known code)", () => {
  const customerFacing = ERROR_CODES.filter((c) =>
    ["VALIDATION_FAILED", "AUTH_REQUIRED", "FORBIDDEN", "INVALID_ADDRESS", "STORE_CLOSED", "SERVICE_UNAVAILABLE", "ITEM_UNAVAILABLE", "INSUFFICIENT_STOCK", "INSUFFICIENT_BALANCE", "INVALID_PROMO", "PROMO_LIMIT_REACHED", "ORDER_ALREADY_EXISTS", "PAYMENT_SETUP_FAILED", "PAYMENT_RECONCILIATION_REQUIRED", "RATE_LIMITED"].includes(c),
  );
  for (const code of customerFacing) {
    const e = toOrderUiError(code);
    assert.notEqual(e.title, "Couldn't place your order", `${code} should have a specific mapping, not the fallback`);
  }
});
