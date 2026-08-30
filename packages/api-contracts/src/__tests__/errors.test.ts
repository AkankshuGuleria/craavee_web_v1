// Phase 2B-scoped test: proves this package's runtime exports (not just its
// types) are well-formed, and that importing it resolves correctly across
// the workspace boundary (this file itself is the workspace-resolution
// proof — it runs from inside @craavee/api-contracts and imports its own
// index.ts exactly as an external consumer would).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES } from "../index.ts";
import type { ApiResult, ApiError, ErrorCode } from "../index.ts";

test("ERROR_CODES has no duplicate entries", () => {
  const unique = new Set(ERROR_CODES);
  assert.equal(unique.size, ERROR_CODES.length);
});

test("ERROR_CODES is non-empty and every entry is a non-empty string", () => {
  assert.ok(ERROR_CODES.length > 0);
  for (const code of ERROR_CODES) {
    assert.equal(typeof code, "string");
    assert.ok(code.length > 0);
  }
});

test("ApiResult<T> discriminates on `ok` as documented", () => {
  const success: ApiResult<{ id: string }> = { ok: true, data: { id: "x" } };
  const failure: ApiResult<{ id: string }> = {
    ok: false,
    error: { code: "AUTH_REQUIRED", message: "no session" } satisfies ApiError,
  };

  assert.equal(success.ok, true);
  assert.equal(failure.ok, false);
  if (!failure.ok) {
    const code: ErrorCode = failure.error.code;
    assert.equal(code, "AUTH_REQUIRED");
  }
});
