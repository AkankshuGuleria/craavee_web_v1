// The allowlist is a money-safety rule, so it is tested as one. The point
// is not that `catalog` persists — it is that everything else does not,
// including keys nobody has written yet.
import test from "node:test";
import assert from "node:assert/strict";
import { shouldPersistQuery } from "../persist.ts";

const q = (key: unknown[], status = "success") =>
  ({ queryKey: key, state: { status } }) as never;

test("the catalog persists", () => {
  assert.equal(shouldPersistQuery(q(["catalog"])), true);
});

test("nothing money-bearing or personal persists", () => {
  for (const key of [["orders"], ["orders", "abc"], ["payments"], ["profile"], ["addresses"]]) {
    assert.equal(shouldPersistQuery(q(key)), false, `${key[0]} must never be written to disk`);
  }
});

test("an unknown key defaults to NOT persisting", () => {
  // The safe default: a query added later is excluded until someone
  // deliberately allows it.
  assert.equal(shouldPersistQuery(q(["wallet"])), false);
  assert.equal(shouldPersistQuery(q(["something-new"])), false);
});

test("a failed catalog query is not persisted", () => {
  // Rehydrating an error would show a failure the user never hit.
  assert.equal(shouldPersistQuery(q(["catalog"], "error")), false);
  assert.equal(shouldPersistQuery(q(["catalog"], "pending")), false);
});

test("a malformed key is refused rather than assumed safe", () => {
  assert.equal(shouldPersistQuery(q([])), false);
  assert.equal(shouldPersistQuery(q([123])), false);
});
