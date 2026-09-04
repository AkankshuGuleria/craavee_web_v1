/**
 * The state vocabulary every screen shares.
 *
 * The audit's two P0 UX findings were both state failures: the customer's
 * order-tracking screen had a dead-end error with no retry, and the app
 * had no concept of stale or offline data at all — while the entire
 * customer design is polling (D20). A poll that silently fails leaves the
 * screen showing yesterday's truth with no indication.
 *
 * So these are not decoration. `ErrorState` REQUIRES an `onRetry`: it is
 * not possible to render a dead end with this component.
 */
import type { ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { theme, radius, space } from "../../lib/theme";
import { Button } from "./Button";

/** Skeleton block. Shaped like the content it stands in for. */
export function Skeleton({ height = 16, width = "100%", radius: r = radius.sm }:
  { height?: number; width?: number | `${number}%`; radius?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, width, borderRadius: r, backgroundColor: theme.skeleton }}
    />
  );
}

/** A list of skeleton rows. Announced as "loading" for screen readers. */
export function SkeletonList({ rows = 5, height = 92 }: { rows?: number; height?: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading" style={{ gap: space.md }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={radius.lg} />
      ))}
    </View>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md }}>
      <ActivityIndicator color={theme.brand} />
      <Text style={{ color: theme.textMuted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, hint, action }:
  { title: string; hint?: string; action?: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space["2xl"] }}>
      <Text style={{ color: theme.textStrong, fontSize: 17, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {hint ? (
        <Text style={{ color: theme.textMuted, fontSize: 13, textAlign: "center" }}>{hint}</Text>
      ) : null}
      {action}
    </View>
  );
}

/**
 * `onRetry` is required, not optional. The audit found the customer's
 * primary tracking screen offering "We couldn't load this order" and a
 * link back to the catalog — no way to try again, on the screen someone
 * stares at while waiting for food. Making retry part of the type means
 * that shape cannot be built again by accident.
 */
export function ErrorState({ title = "Something went wrong", detail, onRetry, retryLabel = "Try again" }:
  { title?: string; detail?: string; onRetry: () => void; retryLabel?: string }) {
  return (
    <View
      accessibilityRole="alert"
      style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space["2xl"] }}
    >
      <Text style={{ color: theme.textStrong, fontSize: 17, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {detail ? (
        <Text style={{ color: theme.textMuted, fontSize: 13, textAlign: "center" }}>{detail}</Text>
      ) : null}
      <Button label={retryLabel} onPress={onRetry} variant="secondary" testID="error-retry" />
    </View>
  );
}

/**
 * The banner the audit said was missing. Shown when data on screen is
 * known to be behind — a failed poll, a lost connection — so the customer
 * is never quietly reading stale state.
 */
export function StaleBanner({ kind, onRetry }:
  { kind: "offline" | "stale" | "reconnecting"; onRetry?: () => void }) {
  const copy = {
    offline: { text: "You're offline. Showing the last update.", tone: theme.warning, soft: theme.warningSoft },
    stale: { text: "Couldn't refresh just now. This may be out of date.", tone: theme.warning, soft: theme.warningSoft },
    reconnecting: { text: "Reconnecting…", tone: theme.info, soft: theme.infoSoft },
  }[kind];
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        gap: space.sm, paddingHorizontal: space.base, paddingVertical: space.md,
        borderRadius: radius.md, backgroundColor: copy.soft,
      }}
    >
      <Text style={{ color: copy.tone, fontSize: 13, flexShrink: 1 }}>{copy.text}</Text>
      {onRetry ? <Button label="Retry" onPress={onRetry} variant="ghost" testID="stale-retry" /> : null}
    </View>
  );
}
