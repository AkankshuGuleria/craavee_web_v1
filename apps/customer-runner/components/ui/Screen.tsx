/**
 * The screen container. Every top-level route should use it.
 *
 * It exists because the Phase 10 audit found `react-native-safe-area-context`
 * installed with ZERO call sites: safe areas were hardcoded as `pt-14` on
 * the customer catalog and `pt-16` on both runner screens. Those magic
 * numbers are wrong on any device whose status bar differs from the one
 * they were eyeballed on, and wrong again in landscape.
 *
 * `edges` defaults to top+bottom because that is what a full-screen route
 * needs. A screen inside a navigator that already insets the top passes
 * `edges={["bottom"]}`.
 */
import type { ReactNode } from "react";
import { Platform, View, ScrollView, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { theme } from "../../lib/theme";

/**
 * Web only. The customer app is a phone layout rendered in a desktop
 * browser, so without a cap every screen stretches to the window: the
 * two-column product grid became two billboards, and a text field ran
 * the full width of the monitor. Found during Slice 2 web validation.
 *
 * 720 rather than a phone width - pinning a hard 400px column on a
 * desktop is its own kind of wrong - and centred, so it reads as a
 * deliberate column rather than content stuck to the left edge.
 *
 * Native is untouched: a phone viewport is already narrower than this,
 * so the constraint never binds there.
 */
const WEB_MAX_WIDTH = 720;

interface ScreenProps {
  children: ReactNode;
  /** Wraps content in a ScrollView. Off for screens owning their own list. */
  scroll?: boolean;
  edges?: readonly Edge[];
  /** Horizontal padding. `false` for edge-to-edge lists. */
  padded?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function Screen({
  children,
  scroll = false,
  edges = ["top", "bottom"],
  padded = true,
  style,
  testID,
}: ScreenProps) {
  const inner = (
    <View
      style={[
        { flex: 1, paddingHorizontal: padded ? 16 : 0 },
        Platform.OS === "web" ? { maxWidth: WEB_MAX_WIDTH, width: "100%", alignSelf: "center" } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  return (
    <SafeAreaView
      edges={edges}
      style={{ flex: 1, backgroundColor: theme.bg }}
      testID={testID}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}
