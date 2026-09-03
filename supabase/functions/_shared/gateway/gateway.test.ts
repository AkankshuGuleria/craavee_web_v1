// Deno tests for the gateway factory's PRODUCTION-SAFETY branching
// (Phase 5 prompt §25) and the real Razorpay adapter's pure paths.
//
// Run: `npm run functions:test` (deno test).
//
// getGateway() reads Deno.env, so this must be a Deno test, not a node
// one — the node integration suite unit-tests RazorpayGateway directly
// instead.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getGateway, mockGatewayAllowed } from "./index.ts";
import { MockGateway } from "./mock.ts";
import { RazorpayGateway } from "./razorpay.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = Deno.env.get(k);
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

const NO_GATEWAY_ENV = {
  PAYMENT_GATEWAY: undefined,
  CRAAVEE_ENV: undefined,
  CRAAVEE_ALLOW_MOCK_CONTROL: undefined,
  RAZORPAY_KEY_ID: undefined,
  RAZORPAY_KEY_SECRET: undefined,
  RAZORPAY_WEBHOOK_SECRET: undefined,
};

Deno.test("local/CI dev (mock control on, no creds) -> mock adapter", () => {
  withEnv({ ...NO_GATEWAY_ENV, CRAAVEE_ALLOW_MOCK_CONTROL: "1" }, () => {
    assert(mockGatewayAllowed());
    assert(getGateway() instanceof MockGateway);
  });
});

Deno.test("PAYMENT_GATEWAY=mock is refused without CRAAVEE_ALLOW_MOCK_CONTROL", () => {
  withEnv({ ...NO_GATEWAY_ENV, PAYMENT_GATEWAY: "mock" }, () => {
    assertThrows(() => getGateway(), Error, "PRODUCTION_SAFETY");
  });
});

Deno.test("PAYMENT_GATEWAY=mock is refused when CRAAVEE_ENV=production", () => {
  withEnv(
    { ...NO_GATEWAY_ENV, PAYMENT_GATEWAY: "mock", CRAAVEE_ALLOW_MOCK_CONTROL: "1", CRAAVEE_ENV: "production" },
    () => {
      assert(!mockGatewayAllowed());
      assertThrows(() => getGateway(), Error, "PRODUCTION_SAFETY");
    },
  );
});

Deno.test("production with no Razorpay creds -> fail closed (never silently mock)", () => {
  withEnv({ ...NO_GATEWAY_ENV, CRAAVEE_ENV: "production" }, () => {
    assertThrows(() => getGateway(), Error, "PRODUCTION_SAFETY");
  });
});

Deno.test("staging with no mock control + no creds -> fail closed", () => {
  withEnv({ ...NO_GATEWAY_ENV, CRAAVEE_ENV: "staging" }, () => {
    assertThrows(() => getGateway(), Error, "PRODUCTION_SAFETY");
  });
});

Deno.test("Razorpay creds present -> the real adapter, in any environment", () => {
  withEnv(
    {
      ...NO_GATEWAY_ENV,
      CRAAVEE_ENV: "production",
      RAZORPAY_KEY_ID: "rzp_test_abc",
      RAZORPAY_KEY_SECRET: "s",
      RAZORPAY_WEBHOOK_SECRET: "w",
    },
    () => {
      assert(getGateway() instanceof RazorpayGateway);
    },
  );
});

Deno.test("RazorpayGateway: buildCheckoutParams is pure and never leaks the secret", () => {
  const gw = new RazorpayGateway("rzp_test_abc", "super-secret", "whsec");
  const params = gw.buildCheckoutParams("order_XYZ", 6000);
  assertEquals(params.key, "rzp_test_abc");
  assertEquals(params.order_id, "order_XYZ");
  assertEquals(params.amount, 6000);
  assertEquals(params.currency, "INR");
  assert(!JSON.stringify(params).includes("super-secret"));
  assert(!JSON.stringify(params).includes("whsec"));
});

Deno.test("RazorpayGateway: webhook signature round-trips, tamper fails", async () => {
  const gw = new RazorpayGateway("rzp_test_abc", "s", "whsec_test");
  const raw = JSON.stringify({ event: "payment.captured", payload: { x: 1 } });
  const { createHmac } = await import("node:crypto");
  const sig = createHmac("sha256", "whsec_test").update(raw, "utf8").digest("hex");
  assert(gw.verifyWebhookSignature(raw, sig));
  assert(!gw.verifyWebhookSignature(raw + "x", sig));
  assert(!gw.verifyWebhookSignature(raw, sig.slice(0, -1) + "0"));
  assert(!gw.verifyWebhookSignature(raw, null));
});

// ---------------------------------------------------------------------
// Phase 10A. The two tests above prove getGateway() refuses the mock in a
// deployed environment. This one guards the configuration path that fed
// it, which the code alone cannot see.
//
// `supabase/config.toml` used to carry
//
//     [edge_runtime.secrets]
//     CRAAVEE_ALLOW_MOCK_CONTROL = "1"
//
// as a local convenience. That block is not local: `supabase secrets set`
// pushes every key in it to the LINKED REMOTE project alongside the key
// being set. Observed against the real staging project — setting one
// secret reported `count: 2` and the mock flag appeared in
// `supabase secrets list`; after the block was removed the same command
// reported `count: 1`.
//
// It mattered because mockGatewayAllowed() reads
// `CRAAVEE_ENV ?? "development"`. A deployed project that simply lost
// CRAAVEE_ENV would then satisfy both halves of the check and take mock
// money rather than failing closed — the exact outcome
// "production with no Razorpay creds -> fail closed" exists to prevent.
Deno.test("config.toml never declares the mock-control flag as a pushable secret", async () => {
  const toml = await Deno.readTextFile(new URL("../../../config.toml", import.meta.url));

  // Only the [edge_runtime.secrets] block propagates to a linked project,
  // so scope the assertion to it rather than banning the string outright —
  // the prose above legitimately names the variable.
  const block = toml.match(/^\[edge_runtime\.secrets\][^\[]*/m)?.[0] ?? "";
  const declared = block
    .split("\n")
    .filter((l) => /^\s*[A-Z_]+\s*=/.test(l))
    .map((l) => l.split("=")[0].trim());

  assert(
    !declared.includes("CRAAVEE_ALLOW_MOCK_CONTROL"),
    "CRAAVEE_ALLOW_MOCK_CONTROL is declared in [edge_runtime.secrets]; it would be pushed to the linked remote project by `supabase secrets set`. Supply it from the local environment instead (scripts/serve-functions.sh, the CI workflow, or the suite's spawned server env).",
  );
  assertEquals(declared.filter((n) => n.startsWith("RAZORPAY")), [], "gateway credentials must never be declared in config.toml");
});
