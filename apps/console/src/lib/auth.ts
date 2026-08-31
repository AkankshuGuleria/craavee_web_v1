import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Server-side admin gate for the Console (Phase 8).
 *
 * Mirrors the Store's `requireStaff` deliberately — same architecture,
 * same `getClaims()` discipline — rather than inventing a second auth
 * model. `src/lib/supabase/server.ts` already anticipated this file
 * ("when one exists, it must call supabase.auth.getClaims()").
 *
 * Added in Phase 8 because the Console could not read a single real
 * order without it: `orders_select` (migration 0003) grants nothing to an
 * unauthenticated caller, so the operations board had no authoritative
 * data to show or to update live. This is the missing gate, not a
 * redesign.
 *
 * It is still not the security boundary. RLS is (SECURITY_MODEL.md §1) —
 * an admin who reached a page they should not see would still read only
 * what their policies allow. This turns a silent empty result into an
 * honest redirect.
 */
export interface AdminContext {
  userId: string;
  role: "admin";
  /** Always null for an admin — all-store scope (0001's staff_role_store_required). */
  storeId: null;
}

export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  const claims = data?.claims as { sub?: string; role?: string } | undefined;

  if (error || !claims?.sub) {
    redirect("/sign-in");
  }

  // The role claim is server-injected by custom_access_token_hook (D8)
  // from staff_roles — a browser cannot set it.
  if (claims.role !== "admin") {
    redirect("/not-authorized");
  }

  return { userId: claims.sub, role: "admin", storeId: null };
}
