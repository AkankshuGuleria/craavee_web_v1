import type { NextRequest } from "next/server";

import { updateSession } from "./src/lib/supabase/updateSession";

/**
 * Next.js 16 renamed `middleware.ts` → `proxy.ts` (the `middleware`
 * file convention is deprecated; confirmed against the current Next.js
 * docs before writing this, per this repo's `apps/customer-runner/
 * AGENTS.md` standing instruction to check exact current API rather
 * than assume). Only job right now: keep the Supabase session cookie
 * fresh (see updateSession.ts) — no route protection yet, since this
 * app has no staff login flow to protect anything with (Phase 3 §17:
 * "do NOT build their operational functionality yet").
 */
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Exclude static assets and image optimization — running the
    // session-refresh client on every JS/CSS/image request would be
    // pure overhead with no auth-relevant effect.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
