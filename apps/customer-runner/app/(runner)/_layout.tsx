import { Stack } from "expo-router";

/**
 * Layout for the runner-facing route group.
 *
 * Placeholder only — no job feed, claim flow, or delivery-status screens
 * exist yet. This file establishes the group's navigation container so
 * later phases add screens instead of restructuring routing.
 */
export default function RunnerLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
