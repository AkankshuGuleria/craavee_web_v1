/**
 * The persistent cart bar.
 *
 * Extracted because it was duplicated on home and product detail and was
 * about to be duplicated onto browse and search - four copies of a
 * control that must stay identical, including its safe-area inset and
 * its accessibility label.
 *
 * It renders nothing when the cart is empty, which is what makes it feel
 * contextual rather than permanently glued to the screen (§16): it
 * appears the moment there is something to check out, and leaves when
 * there is not.
 */
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { cartCount } from "../../lib/cart/logic.ts";
import { useCartStore } from "../../lib/cart/store";
import { rupees } from "../../lib/format";
import { useCart } from "../../hooks/useCart";

export function CartBar({ testID = "cart-fab" }: { testID?: string }) {
  const items = useCartStore((s) => s.items);
  const cart = useCart();
  const count = cartCount(items);

  if (count === 0) return null;

  return (
    // The screen excludes the bottom safe-area edge precisely so this bar
    // can own its own inset and sit flush with the home indicator.
    <View className="absolute inset-x-0 bottom-0 px-4 pb-8">
      <Link href="/cart" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View cart, ${count} ${count === 1 ? "item" : "items"}, ${rupees(
            cart.indicativeSubtotal,
          )}`}
          className="min-h-[56px] flex-row items-center justify-between rounded-2xl bg-brand px-5"
          testID={testID}
        >
          <Text className="shrink-0 pr-2 text-base font-semibold text-white">
            {count} {count === 1 ? "item" : "items"}
          </Text>
          <Text className="shrink-0 pr-1 text-base font-semibold text-white">
            {rupees(cart.indicativeSubtotal)} · View cart
          </Text>
        </Pressable>
      </Link>
    </View>
  );
}
