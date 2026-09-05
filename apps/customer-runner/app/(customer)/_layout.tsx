import { Stack } from "expo-router";

import { theme, font } from "../../lib/theme";

/**
 * Layout for the customer-facing route group.
 *
 * Phase 4 added the ordering flow: catalog (index) -> cart -> checkout ->
 * order/[id], plus address/new. Kept as a plain Stack — the flow is
 * deliberately short (Phase 4 §28: "avoid unnecessary screens").
 *
 * Phase 10E gives every route an explicit title. Without one, Expo Router
 * falls back to the ROUTE FILENAME, so the back button on the cart read
 * "index" — the kind of detail that quietly signals unfinished software
 * at exactly the moment a customer is deciding whether to trust it with a
 * payment.
 *
 * Header styling comes from the tokens rather than platform defaults, so
 * the chrome belongs to the same design language as the content beneath
 * it.
 */
const header = {
  headerStyle: { backgroundColor: theme.bg },
  headerTintColor: theme.brand,
  headerTitleStyle: {
    color: theme.textStrong,
    fontSize: font.size.subtitle,
    fontWeight: font.weight.semibold,
  },
  headerShadowVisible: false,
  // "Craavee" rather than the route name, and short enough that iOS does
  // not truncate it to "Back".
  headerBackTitle: "Craavee",
} as const;

export default function CustomerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, ...header }}>
      {/* The tab bar is the root. Everything below presents OVER it,
          which is the native convention on both platforms and keeps the
          back stack honest. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="cart"
        options={{ title: "Your cart", headerShown: true, presentation: "card" }}
      />
      <Stack.Screen name="checkout" options={{ title: "Checkout", headerShown: true }} />
      <Stack.Screen
        name="address/new"
        options={{ title: "Add an address", headerShown: true, presentation: "modal" }}
      />
      <Stack.Screen name="order/[id]" options={{ title: "Your order", headerShown: true }} />
      {/* Slice 2. Search owns the header itself (the field IS the header),
          so it renders headerless; product detail keeps the standard bar. */}
      <Stack.Screen name="search" options={{ title: "Search", headerShown: false }} />
      {/* Slice 3. Browse owns its title dynamically (the selected
          category), so it sets it from the screen rather than here. */}
      <Stack.Screen name="browse" options={{ title: "Browse", headerShown: true }} />
      <Stack.Screen
        name="product/[id]"
        options={{ title: "Product", headerShown: true }}
      />
    </Stack>
  );
}
