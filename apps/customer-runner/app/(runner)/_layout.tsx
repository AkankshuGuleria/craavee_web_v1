import { Stack } from "expo-router";

/**
 * Layout for the runner-facing route group (Phase 7).
 *
 * Two screens: the queue (index) and the active job. The runner only
 * ever has one live job — the database guarantees it — so there is no
 * job list to navigate within, and the stack stays one level deep.
 *
 * Route protection itself lives in AuthBoundary/resolveRouteAccess, not
 * here. That is UX only: RLS and the Edge Functions are the security
 * boundary (§4).
 */
export default function RunnerLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
