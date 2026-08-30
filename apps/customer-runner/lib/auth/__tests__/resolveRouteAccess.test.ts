// Phase 3: proves the pure routing-decision function's every branch,
// including the redirect-loop-shaped edge cases (an unsupported role must
// never bounce between two route groups) — without a network call, a
// rendered component, or Expo Router itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRouteAccess } from "../resolveRouteAccess.ts";

test("still loading returns null regardless of role/segment", () => {
  assert.equal(resolveRouteAccess({ isLoading: true, role: null, segment: "customer" }), null);
});

test("no session, on an auth screen: allow", () => {
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: null, segment: "auth" }), {
    action: "allow",
  });
});

test("no session, on a protected route: redirect to phone entry", () => {
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: null, segment: "customer" }), {
    action: "redirect",
    to: "/(auth)/phone",
  });
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: null, segment: "runner" }), {
    action: "redirect",
    to: "/(auth)/phone",
  });
});

test("customer role: allowed on customer routes, redirected elsewhere", () => {
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: "customer", segment: "customer" }), {
    action: "allow",
  });
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: "customer", segment: "runner" }), {
    action: "redirect",
    to: "/(customer)",
  });
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: "customer", segment: "auth" }), {
    action: "redirect",
    to: "/(customer)",
  });
});

test("runner role: allowed on runner routes, redirected away from customer routes", () => {
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: "runner", segment: "runner" }), {
    action: "allow",
  });
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: "runner", segment: "customer" }), {
    action: "redirect",
    to: "/(runner)",
  });
});

test("packer/admin: routed to the unsupported-role screen, not either app route group", () => {
  for (const role of ["packer", "admin"] as const) {
    assert.deepEqual(resolveRouteAccess({ isLoading: false, role, segment: "customer" }), {
      action: "redirect",
      to: "/unsupported-role",
    });
    assert.deepEqual(resolveRouteAccess({ isLoading: false, role, segment: "auth" }), {
      action: "redirect",
      to: "/unsupported-role",
    });
  }
});

test("packer/admin already on the unsupported-role screen: allow (no redirect loop)", () => {
  for (const role of ["packer", "admin"] as const) {
    assert.deepEqual(resolveRouteAccess({ isLoading: false, role, segment: "unsupported" }), {
      action: "allow",
    });
  }
});

test("customer/runner landing on the unsupported-role screen are sent back to their own group", () => {
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: "customer", segment: "unsupported" }), {
    action: "redirect",
    to: "/(customer)",
  });
  assert.deepEqual(resolveRouteAccess({ isLoading: false, role: "runner", segment: "unsupported" }), {
    action: "redirect",
    to: "/(runner)",
  });
});
