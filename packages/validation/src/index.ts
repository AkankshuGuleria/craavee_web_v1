// Explicit `.ts` extensions on relative specifiers: required by strict-ESM
// consumers (Node's native module loader — used by this package's own
// __tests__ — and, later, Deno Edge Functions, which reject extensionless
// relative imports outright). Bundler tooling (Next.js/Metro/tsc with
// "moduleResolution": "bundler" + "allowImportingTsExtensions") accepts
// this form too, so it's the one specifier style that works everywhere
// this package is consumed.
export * from "./primitives.ts";
export * from "./requests.ts";
