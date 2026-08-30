import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Server-side staff gate for the Store app (Phase 6 §5).
 *
 * This runs on the server and reads the session from a verified JWT, so
 * it cannot be bypassed by editing anything in the browser. It is still
 * not the security boundary: RLS is (SECURITY_MODEL.md §1). Every query
 * this app makes runs as the signed-in user through the anon key, so a
 * packer who somehow reached a page they should not see would still read
 * nothing — the policies in migration 0003 scope orders and order_items
 * to `auth_store_id()`. This function exists to turn that silent empty
 * result into an honest redirect.
 *
 * `getClaims()`, never `getSession()`: getSession's user object is
 * unverified when read from a storage medium a client could tamper with.
 */
export interface StaffContext {
  userId: string;
  role: "packer" | "admin";
  /** null for an admin — all-store scope (0001's staff_role_store_required). */
  storeId: string | null;
}

export async function requireStaff(): Promise<StaffContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  const claims = data?.claims as
    | { sub?: string; role?: string; store_id?: string }
    | undefined;

  if (error || !claims?.sub) {
    redirect("/sign-in");
  }

  // The role claim is server-injected by custom_access_token_hook (D8)
  // from staff_roles — a browser cannot set it.
  const role = claims.role;
  if (role !== "packer" && role !== "admin") {
    redirect("/not-authorized");
  }

  return {
    userId: claims.sub,
    role,
    storeId: claims.store_id ?? null,
  };
}
