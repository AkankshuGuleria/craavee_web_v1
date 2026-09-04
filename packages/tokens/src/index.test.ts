// The tokens are data, so the tests are about the RULES that make them
// trustworthy rather than about the values themselves. A test asserting
// `brand === "#178a50"` would only restate the source and would have to
// be edited every time the brand is tuned — it would protect nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { color, space, radius, touchTarget, motion, font } from "./index.ts";

test("the token source imports nothing platform-specific", async () => {
  // The whole point of this package: it must be readable from a Deno edge
  // function, a browser bundle and a React Native runtime alike.
  const src = await (await import("node:fs/promises")).readFile(
    new URL("./index.ts", import.meta.url), "utf8",
  );
  const imports = src.match(/^\s*import\s.+$/gm) ?? [];
  assert.deepEqual(imports, [], `token source must have no imports, found: ${imports.join(" | ")}`);
});

test("both surfaces expose the same semantic keys", () => {
  // A screen written against `consumer` must be portable to `ops` without
  // discovering a missing colour at runtime.
  assert.deepEqual(
    Object.keys(color.consumer).sort(),
    Object.keys(color.ops).sort(),
    "consumer and ops must stay structurally identical",
  );
});

test("every touch target meets the 44pt platform minimum", () => {
  for (const [k, v] of Object.entries(touchTarget)) {
    assert.ok(v >= 44, `touchTarget.${k} is ${v}, below the 44pt minimum`);
  }
});

test("spacing is a 4pt grid", () => {
  for (const [k, v] of Object.entries(space)) {
    assert.equal(v % 4, 0, `space.${k} = ${v} is off the 4pt grid`);
  }
});

test("reduced motion has somewhere to collapse to", () => {
  // `instant` must be > 0: a zero-duration transition can be skipped
  // mid-flight by some runtimes, leaving a half-applied style.
  assert.ok(motion.duration.instant > 0);
  assert.ok(motion.duration.instant < motion.duration.fast);
});

test("the type scale and its line heights stay in step", () => {
  assert.deepEqual(Object.keys(font.size), Object.keys(font.lineHeight));
  for (const k of Object.keys(font.size) as (keyof typeof font.size)[]) {
    assert.ok(font.lineHeight[k] > font.size[k], `${k} line height must exceed its font size`);
  }
});

test("radius names are ordered, so `lg` is never smaller than `md`", () => {
  const order = ["xs", "sm", "md", "lg", "xl"] as const;
  for (let i = 1; i < order.length; i++) {
    assert.ok(radius[order[i]] > radius[order[i - 1]], `radius.${order[i]} must exceed radius.${order[i - 1]}`);
  }
});

test("the generated artefacts are in sync with the source", async () => {
  // dist/ is committed so a clone builds with no codegen step. This test
  // is the price of that: regenerate, compare, fail loudly on drift. It
  // is what stops the old failure mode — a hand-edited config quietly
  // disagreeing with the tokens it claims to mirror.
  const { readFile } = await import("node:fs/promises");
  const { tailwindCjs, tokensCss } = await import("../build.ts");
  const cases: [string, string][] = [
    ["../dist/tailwind.cjs", tailwindCjs()],
    ["../dist/tokens.css", tokensCss()],
  ];
  for (const [rel, expected] of cases) {
    const onDisk = await readFile(new URL(rel, import.meta.url), "utf8");
    assert.equal(onDisk, expected, `${rel} is stale — run \`npm run build -w @craavee/tokens\``);
  }
});
