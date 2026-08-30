import { Stack } from "expo-router";

/**
 * Layout for the customer-facing route group.
 *
 * Phase 4 adds the ordering flow: catalog (index) -> cart -> checkout ->
 * order/[id] confirmation, plus address/new. Kept as a plain Stack — the
 * flow is deliberately short (Phase 4 §28: "avoid unnecessary screens").
 */
export default function CustomerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="cart" options={{ presentation: "card" }} />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="address/new" options={{ presentation: "modal" }} />
      <Stack.Screen name="order/[id]" />
    </Stack>
  );
}
