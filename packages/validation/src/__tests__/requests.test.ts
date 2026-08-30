// Phase 2B-scoped test: proves the Zod schemas in ../requests.ts actually
// enforce their constraints at runtime, not just that they typecheck.
// Uses Node's built-in test runner (`node --test`) with native TS type
// stripping — no new test framework dependency for a foundation phase
// that has no business logic to test yet, just contracts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOrderRequestSchema,
  verifyDeliveryCodeRequestSchema,
  claimJobRequestSchema,
  assignStaffRoleRequestSchema,
} from "../requests.ts";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

test("createOrderRequestSchema accepts a well-formed request", () => {
  const result = createOrderRequestSchema.safeParse({
    idempotencyKey: VALID_UUID,
    addressId: VALID_UUID,
    items: [{ productId: VALID_UUID, qty: 2 }],
  });
  assert.equal(result.success, true);
});

test("createOrderRequestSchema rejects an empty items array", () => {
  const result = createOrderRequestSchema.safeParse({
    idempotencyKey: VALID_UUID,
    addressId: VALID_UUID,
    items: [],
  });
  assert.equal(result.success, false);
});

test("createOrderRequestSchema rejects qty above the 20 per-line cap", () => {
  const result = createOrderRequestSchema.safeParse({
    idempotencyKey: VALID_UUID,
    addressId: VALID_UUID,
    items: [{ productId: VALID_UUID, qty: 21 }],
  });
  assert.equal(result.success, false);
});

test("createOrderRequestSchema rejects a non-UUID addressId", () => {
  const result = createOrderRequestSchema.safeParse({
    idempotencyKey: VALID_UUID,
    addressId: "not-a-uuid",
    items: [{ productId: VALID_UUID, qty: 1 }],
  });
  assert.equal(result.success, false);
});

test("createOrderRequestSchema accepts the optional promoCode + useWallet, and strips unknown keys", () => {
  const result = createOrderRequestSchema.safeParse({
    idempotencyKey: VALID_UUID,
    addressId: VALID_UUID,
    items: [{ productId: VALID_UUID, qty: 1 }],
    promoCode: "HACKFEST",
    useWallet: true,
    // a client trying to smuggle a price/total is ignored — the parsed
    // object never carries these (Phase 4 prompt §12)
    payable: 1,
    subtotal: 1,
  });
  assert.equal(result.success, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.success ? result.data : {}, "payable"),
    false,
  );
});

test("createOrderRequestSchema rejects qty below 1", () => {
  assert.equal(
    createOrderRequestSchema.safeParse({
      idempotencyKey: VALID_UUID,
      addressId: VALID_UUID,
      items: [{ productId: VALID_UUID, qty: 0 }],
    }).success,
    false,
  );
});

test("verifyDeliveryCodeRequestSchema requires exactly 4 digits", () => {
  assert.equal(
    verifyDeliveryCodeRequestSchema.safeParse({ orderId: VALID_UUID, code: "1234" }).success,
    true
  );
  assert.equal(
    verifyDeliveryCodeRequestSchema.safeParse({ orderId: VALID_UUID, code: "123" }).success,
    false
  );
  assert.equal(
    verifyDeliveryCodeRequestSchema.safeParse({ orderId: VALID_UUID, code: "12345" }).success,
    false
  );
  assert.equal(
    verifyDeliveryCodeRequestSchema.safeParse({ orderId: VALID_UUID, code: "12ab" }).success,
    false
  );
});

test("claimJobRequestSchema requires a UUID-shaped orderId", () => {
  assert.equal(claimJobRequestSchema.safeParse({ orderId: VALID_UUID }).success, true);
  assert.equal(claimJobRequestSchema.safeParse({ orderId: "123" }).success, false);
});

test("assignStaffRoleRequestSchema only accepts the three staff role values", () => {
  assert.equal(
    assignStaffRoleRequestSchema.safeParse({ profileId: VALID_UUID, role: "packer" }).success,
    true
  );
  assert.equal(
    assignStaffRoleRequestSchema.safeParse({ profileId: VALID_UUID, role: "customer" }).success,
    false
  );
});
