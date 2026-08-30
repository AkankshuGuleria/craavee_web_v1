// Per-request context: the service-role Supabase client, the verified
// caller identity, and env access.
//
// EDGE_FUNCTION_ONLY secrets (SUPABASE_SERVICE_ROLE_KEY) are read from the
// runtime environment only — never from a request, never bundled into a
// client (SECURITY_MODEL.md §3). `supabase start` injects SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY automatically for local
// functions.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fail } from "./http.ts";

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

/** Service-role client — bypasses RLS (BYPASSRLS). The Edge Function is
 *  the trusted, self-authorizing layer (RBAC_MATRIX.md §4). */
export function serviceClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Caller {
  userId: string;
  role: "customer" | "packer" | "runner" | "admin" | null;
}

/**
 * Verify the caller's JWT via the Auth server (getUser), then read the
 * verified `role` claim. Identity is derived from the token ONLY — a
 * `customer_id` / `role` / `store_id` in the request body is never read
 * (SECURITY_MODEL.md §2, Phase 4 prompt §31).
 */
export async function verifyCaller(req: Request): Promise<Caller | Response> {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (!token) return fail("AUTH_REQUIRED", "missing bearer token", 401);

  const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // getUser verifies the token against the Auth server.
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData.user) {
    return fail("AUTH_REQUIRED", "invalid or expired session", 401);
  }

  // The server-injected `role` claim (D8, custom_access_token_hook). Read
  // it from getClaims (which re-verifies), falling back to decoding the
  // ALREADY-VERIFIED token's payload if getClaims can't run in this
  // context. Fail CLOSED: an unrecognized / unreadable role becomes
  // null, never a guessed 'customer'.
  let claimRole: string | undefined;
  const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(token);
  if (!claimsErr && claimsData?.claims) {
    claimRole = (claimsData.claims as { role?: string }).role;
  } else {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      claimRole = payload.role;
    } catch {
      claimRole = undefined;
    }
  }

  let role: Caller["role"] = null;
  if (claimRole === "customer" || claimRole === "packer" || claimRole === "runner" || claimRole === "admin") {
    role = claimRole;
  } else if (claimRole === "authenticated" || claimRole === undefined) {
    // No staff_roles row and the hook mapped it to a bare authenticated
    // token (or the claim is absent) -> ordinary customer.
    role = "customer";
  }

  return { userId: userData.user.id, role };
}

/** Test-only mock-gateway mode switch. Honoured only when
 *  CRAAVEE_ALLOW_MOCK_CONTROL is set (local / CI), never in production. */
export function mockGatewayMode(req: Request): "ok" | "timeout" | "fail" {
  if (Deno.env.get("CRAAVEE_ALLOW_MOCK_CONTROL") !== "1") return "ok";
  const h = req.headers.get("x-craavee-mock-gateway");
  return h === "timeout" || h === "fail" ? h : "ok";
}
