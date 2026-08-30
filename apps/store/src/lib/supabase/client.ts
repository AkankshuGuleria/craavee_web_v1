import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@craavee/types";

/**
 * Browser-side Supabase client — for Client Components only.
 *
 * Phase 3 §17: this app has no operational auth flow yet (no staff login
 * screen, no route guards) — this file exists so a later phase can build
 * one on the same Supabase auth architecture the rest of the project
 * uses, rather than inventing a second one. Only the `anon` key is ever
 * used here; RLS is the actual enforcement layer (SECURITY_MODEL.md §1).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
