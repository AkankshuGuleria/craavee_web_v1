/**
 * Pure routing-decision function — Phase 3 §7/§8.
 *
 * Deliberately has zero dependency on Supabase, Expo Router, or React, so
 * every branch is unit-testable without a network call or a rendered
 * component. `AuthBoundary`/the route-group layouts call this and act on
 * its result; they hold no routing logic of their own beyond "do what this
 * function says."
 *
 * `role` here MUST already have come from a verified source — this
 * project's `AuthProvider` populates it only from `supabase.auth.
 * getClaims()` (which verifies the JWT — see lib/auth/AuthProvider.tsx),
 * never from a client-supplied field, a URL param, or local state. This
 * function itself does no verification; it only encodes what to do once
 * a trustworthy `role` is known.
 */

export type Role = "customer" | "packer" | "runner" | "admin";

export type RouteDestination = "/(auth)/phone" | "/(customer)" | "/(runner)" | "/unsupported-role";

export type RouteAccessDecision = { action: "allow" } | { action: "redirect"; to: RouteDestination };

export type RouteSegment = "auth" | "customer" | "runner" | "unsupported";

interface ResolveRouteAccessInput {
  /** Whether the initial session/claims fetch has finished. */
  isLoading: boolean;
  /** Null when there is no authenticated session. */
  role: Role | null;
  /** Which route group is currently being entered. */
  segment: RouteSegment;
}

/**
 * The one place that decides which route group a given role belongs in.
 * `packer`/`admin` are real roles (RBAC_MATRIX.md §1) with no route group
 * in this app — Store/Console are their surfaces — so they land on the
 * dedicated `/unsupported-role` screen, which is itself an *allowed*
 * destination for them (not a further redirect target — see below).
 */
function destinationFor(role: Role): RouteDestination {
  if (role === "customer") return "/(customer)";
  if (role === "runner") return "/(runner)";
  return "/unsupported-role";
}

function segmentMatches(segment: RouteSegment, destination: RouteDestination): boolean {
  if (destination === "/(customer)") return segment === "customer";
  if (destination === "/(runner)") return segment === "runner";
  return segment === "unsupported";
}

/**
 * `isLoading` is intentionally not a fourth `action` — callers show a
 * loading screen for that case themselves (it isn't a routing decision,
 * it's "don't decide yet"). Modeled as `null` here so callers can't
 * accidentally treat "still loading" as "no session."
 */
export function resolveRouteAccess({
  isLoading,
  role,
  segment,
}: ResolveRouteAccessInput): RouteAccessDecision | null {
  if (isLoading) return null;

  if (!role) {
    return segment === "auth" ? { action: "allow" } : { action: "redirect", to: "/(auth)/phone" };
  }

  const destination = destinationFor(role);
  if (segmentMatches(segment, destination)) {
    return { action: "allow" };
  }
  return { action: "redirect", to: destination };
}
