import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addItem,
  cartCount,
  decrementItem,
  incrementItem,
  MAX_QTY_PER_LINE,
  removeItem,
  setItemQty,
  toOrderItems,
} from "../logic.ts";

const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";

test("addItem adds a new line and accumulates an existing one", () => {
  let items = addItem({}, P);
  assert.deepEqual(items, { [P]: 1 });
  items = addItem(items, P, 2);
  assert.deepEqual(items, { [P]: 3 });
});

test("qty per line is clamped to MAX_QTY_PER_LINE", () => {
  const items = addItem({}, P, 999);
  assert.equal(items[P], MAX_QTY_PER_LINE);
  assert.equal(incrementItem(items, P)[P], MAX_QTY_PER_LINE);
});

test("decrementItem removes the line when it would hit zero", () => {
  assert.deepEqual(decrementItem({ [P]: 1 }, P), {});
  assert.deepEqual(decrementItem({ [P]: 2, [Q]: 1 }, P), { [P]: 1, [Q]: 1 });
});

test("setItemQty(0) and removeItem both drop the line", () => {
  assert.deepEqual(setItemQty({ [P]: 5 }, P, 0), {});
  assert.deepEqual(removeItem({ [P]: 5, [Q]: 1 }, P), { [Q]: 1 });
  assert.deepEqual(removeItem({ [Q]: 1 }, P), { [Q]: 1 }); // no-op for a missing line
});

test("setItemQty clamps and floors", () => {
  assert.equal(setItemQty({}, P, 3.9)[P], 3);
  assert.equal(setItemQty({}, P, 50)[P], MAX_QTY_PER_LINE);
});

test("every operation returns a new object (never mutates)", () => {
  const original = { [P]: 1 };
  addItem(original, P);
  incrementItem(original, P);
  decrementItem(original, P);
  removeItem(original, P);
  assert.deepEqual(original, { [P]: 1 });
});

test("cartCount sums units across lines", () => {
  assert.equal(cartCount({}), 0);
  assert.equal(cartCount({ [P]: 2, [Q]: 3 }), 5);
});

test("toOrderItems produces the create_order wire shape and drops zero lines", () => {
  assert.deepEqual(toOrderItems({ [P]: 2, [Q]: 0 }), [{ productId: P, qty: 2 }]);
});
