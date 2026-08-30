import { Redirect, useSegments } from "expo-router";
import type { ReactNode } from "react";

import { useAuth } from "../lib/auth/AuthProvider";
import { resolveRouteAccess, type RouteSegment } from "../lib/auth/resolveRouteAccess";
import { LoadingScreen } from "./LoadingScreen";

/**
 * Real route protection (Phase 3 §7) — supersedes the Phase 2B structural
 * placeholder of the same name, which rendered children unconditionally.
 *
 * Mounted once, at the root layout, above the `<Stack>` that contains
 * every route group. It reads the current top-level route group from
 * `useSegments()` and asks the pure `resolveRouteAccess` function
 * (lib/auth/resolveRouteAccess.ts — unit-tested independently) what to do;
 * it holds no routing logic itself. Role comes only from `useAuth()`,
 * which in turn comes only from a verified `getClaims()` read
 * (AuthProvider.tsx) — never a client-supplied value.
 */
export function AuthBoundary({ children }: { children: ReactNode }) {
  const { role, isLoading } = useAuth();
  const segments = useSegments();

  const segment = toRouteSegment(segments[0]);
  const decision = resolveRouteAccess({ isLoading, role, segment });

  if (isLoading || decision === null) {
    return <LoadingScreen label="Loading your session…" />;
  }

  if (decision.action === "redirect") {
    return <Redirect href={decision.to} />;
  }

  return children;
}

function toRouteSegment(first: string | undefined): RouteSegment {
  if (first === "(customer)") return "customer";
  if (first === "(runner)") return "runner";
  if (first === "unsupported-role") return "unsupported";
  // Includes "(auth)", the bare `/` index route, and `+not-found` — all
  // treated as the unauthenticated-safe default (§7's own root `index.tsx`
  // immediately redirects into the right group once a session exists, so
  // this only matters pre-auth or on a genuinely unknown path).
  return "auth";
}
