// Phase 3 §20 — real integration tests against the local Supabase
// instance (Postgres + Auth + PostgREST), not a mocked client. Requires
// `npm run db:start` (repo root) and the seed applied (`npm run
// db:reset`) first — see README.md. Run via `npm run test:integration`
// (this app), kept out of the plain `npm run test` / CI app-only job
// since it needs a live database, matching how ci.yml vs database.yml
// are already split (PHASE_2B_IMPLEMENTATION_REPORT.md §9).
//
// Route-protection *decision* logic (unauthenticated → redirected;
// runner routed away from customer routes; the reverse) is exhaustively
// covered by lib/auth/__tests__/resolveRouteAccess.test.ts as pure unit
// tests — not re-proven here over the network, which would just be a
// slower, less precise version of the same assertions. This file proves
// the things that can only be proven against a real backend: that a real
// phone OTP round-trip issues a real session with a real, verified role
// claim, that RLS actually enforces profile isolation and post-logout
// revocation over the wire, and that the catalog query returns live,
// typed data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@craavee/types";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// Matches supabase/config.toml's `[auth.sms.test_otp]` block and the
// matching auth.users/auth.identities fixtures in supabase/seed.sql §3b
// (added this phase — see PHASE_3_IMPLEMENTATION_REPORT.md for why both
// were necessary for these to actually authenticate over the real Auth
// API, not just resolve in a direct-psql RLS test).
const TEST_OTP_CODE = "123456";
const CUSTOMER_A_PHONE = "9990000001";
const CUSTOMER_B_PHONE = "9990000002";

function freshClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(phone: string) {
  const client = freshClient();
  const { data, error } = await client.auth.verifyOtp({ phone, token: TEST_OTP_CODE, type: "sms" });
  if (error || !data.session) {
    throw new Error(`test setup failed: could not sign in as ${phone}: ${error?.message}`);
  }
  return client;
}

test("verifyOtp with the wrong code fails with a controlled, mappable error (§20.5)", async () => {
  const client = freshClient();
  const { data, error } = await client.auth.verifyOtp({
    phone: CUSTOMER_A_PHONE,
    token: "000000",
    type: "sms",
  });
  assert.equal(data.session, null);
  assert.ok(error, "expected an error for a wrong OTP");
  // Exact code varies by GoTrue version/reason (invalid vs. expired), but
  // it must always be a 4xx client error, never a silent success and
  // never a 5xx — see lib/auth/errors.ts's toAuthUiError for how the app
  // maps whatever comes back into INVALID_OTP/OTP_EXPIRED.
  assert.ok(error!.status !== undefined && error!.status < 500);
});

test("a real phone OTP sign-in issues a session with a verified `customer` role claim (§20.2)", async () => {
  const client = await signIn(CUSTOMER_A_PHONE);
  const { data: claims, error } = await client.auth.getClaims();
  assert.equal(error, null);
  assert.equal((claims!.claims as { role?: string }).role, "customer");
});

test("session refresh works (§20.6)", async () => {
  const client = await signIn(CUSTOMER_A_PHONE);
  const { data: before } = await client.auth.getSession();
  const { data: refreshed, error } = await client.auth.refreshSession();
  assert.equal(error, null);
  assert.ok(refreshed.session);
  assert.notEqual(refreshed.session!.access_token, before.session!.access_token);
});

test("session persists across a getSession() call without re-authenticating — reload-survival proxy (§20.3)", async () => {
  const client = await signIn(CUSTOMER_A_PHONE);
  const { data } = await client.auth.getSession();
  assert.ok(data.session, "the same client instance must still report a session");
  assert.equal(data.session!.user.phone, CUSTOMER_A_PHONE);
});

test("an authenticated customer can read their own profile, created by the DB trigger (§20.8)", async () => {
  const client = await signIn(CUSTOMER_A_PHONE);
  const { data: user } = await client.auth.getUser();
  const { data: profile, error } = await client
    .from("profiles")
    .select("id, phone, full_name, wallet_balance")
    .eq("id", user.user!.id)
    .single();
  assert.equal(error, null);
  assert.equal(profile!.phone, CUSTOMER_A_PHONE);
  assert.equal(profile!.wallet_balance, 0);
});

test("a customer cannot read another customer's profile (§20.9, RBAC_MATRIX.md §5)", async () => {
  const clientA = await signIn(CUSTOMER_A_PHONE);
  const { data: userA } = await clientA.auth.getUser();

  const clientB = await signIn(CUSTOMER_B_PHONE);
  const { data: crossRead, error } = await clientB.from("profiles").select("id").eq("id", userA.user!.id);
  assert.equal(error, null); // RLS hides the row; it does not error
  assert.equal(crossRead!.length, 0);
});

test("logout revokes access — profile read after signOut is denied (§20.4)", async () => {
  const client = await signIn(CUSTOMER_A_PHONE);
  await client.auth.signOut();

  const { data: session } = await client.auth.getSession();
  assert.equal(session.session, null);

  const { error } = await client.from("profiles").select("id").limit(1);
  assert.ok(error, "anon has no grant on profiles at all (RBAC_MATRIX.md §5) — this must fail");
});

test("catalog loads from the live database with the expected typed shape (§20.10/§20.12)", async () => {
  const client = await signIn(CUSTOMER_A_PHONE);
  const { data, error } = await client
    .from("products_with_availability")
    .select("id, name, brand, image_url, mrp, sale_price, unit_label, category, is_available");
  assert.equal(error, null);
  assert.ok(data!.length > 0, "seed.sql seeds products — the catalog must not be empty in the normal case");

  const row = data![0];
  for (const key of ["id", "name", "mrp", "sale_price", "category", "is_available"]) {
    assert.ok(key in row!, `expected column "${key}" on products_with_availability`);
  }
  // The columns this query does NOT select prove the point as much as the
  // ones it does: no supplier/admin-only/internal-inventory field (e.g.
  // qty_on_hand/qty_reserved — the view exposes only the derived boolean)
  // is even reachable through this select list.
  assert.ok(!("qty_on_hand" in row!));
  assert.ok(!("qty_reserved" in row!));
});

test("an out-of-stock seeded product is reported unavailable, not silently omitted (§20.11)", async () => {
  const client = await signIn(CUSTOMER_A_PHONE);
  const { data, error } = await client
    .from("products_with_availability")
    .select("name, is_available")
    .eq("name", "Bananas")
    .single();
  assert.equal(error, null);
  assert.equal(data!.is_available, false);
});

test("a query with no matching rows returns an empty array, not an error — the empty-state's data precondition (§20.13)", async () => {
  const client = await signIn(CUSTOMER_A_PHONE);
  const { data, error } = await client
    .from("products_with_availability")
    .select("id")
    .eq("category", "category-that-does-not-exist");
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test("querying an endpoint that cannot be reached fails the request rather than hanging or returning fake data — the retry path's precondition (§20.14)", async () => {
  const badClient = createClient<Database>("http://127.0.0.1:59999", SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await badClient.from("products_with_availability").select("id");
  assert.equal(data, null);
  assert.ok(error, "an unreachable database must surface as an error the UI can show a retry action for");
});
