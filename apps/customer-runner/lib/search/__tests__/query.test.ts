/**
 * Search query-sanitiser tests.
 *
 * These pin a security property, not a formatting preference. PostgREST's
 * `or=(...)` filter is a comma-separated list inside parentheses, so an
 * unsanitised search box lets the customer append filters of their own -
 * including ones that widen what the view returns.
 *
 * The real exported function is imported rather than mirrored, so the
 * test fails if the implementation drifts.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MIN_QUERY_LENGTH, sanitiseQuery } from "../query.ts";

test("a comma cannot inject an extra PostgREST or-term", () => {
  const out = sanitiseQuery("milk,is_listed.eq.false");
  assert.ok(!out.includes(","), `comma survived sanitising: ${out}`);
  assert.equal(out, "milk is_listed.eq.false");
});

test("parentheses cannot close the or-group early", () => {
  const out = sanitiseQuery("a(b)c");
  assert.ok(!out.includes("("));
  assert.ok(!out.includes(")"));
});

test("a star cannot widen the ilike pattern", () => {
  assert.ok(!sanitiseQuery("a*b").includes("*"));
});

test("whitespace is collapsed, not merely trimmed", () => {
  assert.equal(sanitiseQuery("  toned    milk  "), "toned milk");
});

test("sanitising never lengthens input", () => {
  for (const s of ["milk", "a,b,c", "  x  ", "(*)", "amul curd", ""]) {
    assert.ok(sanitiseQuery(s).length <= s.length, `grew: ${JSON.stringify(s)}`);
  }
});

test("ordinary product searches pass through untouched", () => {
  // The guard must not mangle legitimate input - a sanitiser that breaks
  // real searches gets removed by the next person who hits it.
  for (const s of ["milk", "amul curd", "Sting", "750 ml"]) {
    assert.equal(sanitiseQuery(s), s);
  }
});

test("the minimum query length is short enough to be useful, long enough to filter", () => {
  // One character matches nearly the whole catalogue and is a wasted round
  // trip; above three starts refusing real brand searches ("KFC", "Amul").
  assert.ok(MIN_QUERY_LENGTH >= 2 && MIN_QUERY_LENGTH <= 3);
});
