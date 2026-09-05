import { Redirect } from "expo-router";

/**
 * Entry funnel. `AuthBoundary` (mounted in the root layout, above the
 * `<Stack>` that renders this screen) already redirects an authenticated
 * session away from here into `/(customer)` or `/(runner)` — this screen
 * is only ever reached unauthenticated, so its only job is to send the
 * user to the phone-entry screen (Phase 3 §6's flow starts there).
 */
export default function Index() {
  return <Redirect href="/(auth)/welcome" />;
}
