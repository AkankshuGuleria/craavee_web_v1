import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session-refresh helper called from `proxy.ts` on every matched request
 * (`@supabase/ssr`'s documented Next.js pattern — see that package's own
 * Next.js guide). This is the piece Server Components can't do
 * themselves: a Server Component can read cookies but never write them,
 * so without this, a session nearing expiry would never actually get
 * refreshed until the browser's own client-side Supabase client happened
 * to do it.
 *
 * `getClaims()`, not `getSession()`: triggers/validates the refresh in a
 * way that doesn't trust an unverified client-supplied session object —
 * same reasoning as `server.ts`'s comment.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  await supabase.auth.getClaims();

  return response;
}
