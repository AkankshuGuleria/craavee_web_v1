/**
 * The customer's root navigation: three tabs.
 *
 * WHY THREE, NOT FIVE.
 *
 * A tab earns its place by being a destination the customer returns to
 * repeatedly across sessions. Craavee has exactly three of those:
 *
 *   Home     everything about finding something to buy
 *   Orders   everything about what you already bought
 *   Account  everything about you - wallet, addresses, sign-out
 *
 * **Cart is deliberately NOT a tab.** It is a momentary state, not a
 * destination: you are in a cart for ninety seconds, once per visit. It
 * already has a persistent bar that appears only when there is something
 * in it, which is strictly better than a permanently visible tab that is
 * empty most of the time. Adding a Cart tab would duplicate that
 * affordance and put a dimmed, meaningless icon in front of the customer
 * on every screen.
 *
 * **Search is deliberately NOT a tab** either. It is an action performed
 * from Home, not a place; it already has a prominent entry and its own
 * screen with its own back-stack entry.
 *
 * This is the point where copying would have been easy and wrong. The
 * reference products carry four or five tabs because they have four or
 * five recurring destinations. Craavee has three, and pretending
 * otherwise would mean inventing destinations to fill a bar.
 *
 * Everything else - product, browse, search, cart, checkout, order detail
 * - lives in the parent Stack and presents OVER the tabs, which is the
 * native convention on both platforms and keeps the back stack honest.
 */
import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme, font } from "../../../lib/theme";

/**
 * Text glyphs rather than an icon font.
 *
 * The app ships no icon set today, and adding one for three tabs is a
 * dependency bought for very little. These are chosen to read at a glance
 * and to carry no meaning on their own - every tab also has its label
 * visible, and a real `accessibilityLabel`, so the glyph is decoration
 * and never the only signal.
 */
function TabGlyph({ glyph, color, focused }: { glyph: string; color: ColorValue; focused: boolean }) {
  return (
    <Text
      // Decorative: the label beside it is the accessible name.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ fontSize: 20, lineHeight: 24, color, opacity: focused ? 1 : 0.75 }}
    >
      {glyph}
    </Text>
  );
}

export default function CustomerTabsLayout() {
  // A fixed bar height put the labels under Android's gesture pill on the
  // V2250. The inset is read rather than guessed, for the same reason
  // `Screen` exists: a magic number is wrong on the next device.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          // Comfortably above the 44pt minimum once the platform's own
          // bottom inset is added.
          height: 58 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize: font.size.caption,
          fontWeight: font.weight.semibold,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarAccessibilityLabel: "Home, browse and search products",
          tabBarIcon: ({ color, focused }) => <TabGlyph glyph="⌂" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarAccessibilityLabel: "Orders, your order history and tracking",
          tabBarIcon: ({ color, focused }) => <TabGlyph glyph="▤" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarAccessibilityLabel: "Account, wallet, addresses and sign out",
          tabBarIcon: ({ color, focused }) => <TabGlyph glyph="◍" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
