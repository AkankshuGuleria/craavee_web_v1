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
import { View, ScrollView, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { theme } from "../../lib/theme";

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
    <View style={[{ flex: 1, paddingHorizontal: padded ? 16 : 0 }, style]}>{children}</View>
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
