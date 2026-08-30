import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@craavee/types";

/**
 * Server-side Supabase client — for Server Components, Server Actions,
 * and Route Handlers. `cookies()` is async (Next.js 16 App Router), so
 * this factory is async too.
 *
 * Phase 3 §17: plumbing only, no operational auth flow built on top of it
 * yet. When one exists, it must call `supabase.auth.getClaims()` to read
 * the session — never `getSession()` for anything authorization-related
 * (`getSession()`'s user object is unverified when read from a storage
 * medium a client could tamper with; `getClaims()` verifies the JWT
 * first, falling back to a `getUser()` round-trip against the Auth
 * server for this project's local/HS256 setup — see apps/customer-
 * runner/lib/auth/AuthProvider.tsx's comment for the confirmed-from-
 * source detail on why).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which can't write cookies —
            // safe to ignore as long as proxy.ts (below) is also
            // refreshing the session on every request, per @supabase/ssr's
            // documented Next.js pattern.
          }
        },
      },
    }
  );
}
