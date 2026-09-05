import { Link, router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useCartStore } from "../../lib/cart/store";
import { rupees } from "../../lib/format";
import { useCart, type CartLine } from "../../hooks/useCart";

/**
 * Cart screen — Phase 4 prompt §4/§21/§28.
 *
 * Every amount shown here is INDICATIVE (see `useCart`). The authoritative
 * total comes only from `create_order` on the checkout screen. Unavailable
 * / removed items are surfaced for the customer to correct — never
 * silently dropped.
 */
export default function CartScreen() {
  const cart = useCart();
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);

  if (cart.isEmpty) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-paper px-8">
        <Text className="text-lg font-semibold text-brand-deep">Your cart is empty</Text>
        <Text className="text-center text-sm text-inkdeep/60">Add something from the catalog to get started.</Text>
        <Link href="/" asChild>
          <Pressable className="mt-2 rounded-full bg-brand px-6 py-2" testID="browse-catalog">
            <Text className="font-semibold text-white">Browse the catalog</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  const hasProblems = cart.unavailableLines.length > 0 || cart.missingLines.length > 0;

  return (
    <View className="flex-1 bg-paper">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        {hasProblems ? (
          <View className="mb-4 rounded-xl border border-mango/40 bg-mango/10 p-3">
            <Text className="text-sm font-semibold text-mango">Some items need attention</Text>
            <Text className="mt-1 text-xs text-inkdeep/70">
              Remove or reduce the flagged items below before checking out.
            </Text>
          </View>
        ) : null}

        {cart.lines.map((line) => (
          <CartRow
            key={line.productId}
            line={line}
            onDec={() => setQty(line.productId, line.qty - 1)}
            onInc={() => setQty(line.productId, line.qty + 1)}
            onRemove={() => remove(line.productId)}
          />
        ))}

        <View className="mt-4 rounded-xl border border-inkdeep/10 bg-white p-4">
          <View className="flex-row justify-between">
            <Text className="text-sm text-inkdeep/60">Subtotal (indicative)</Text>
            <Text className="text-sm font-semibold text-inkdeep">{rupees(cart.indicativeSubtotal)}</Text>
          </View>
          <Text className="mt-2 text-xs text-inkdeep/50">
            Delivery fee, promo and wallet are calculated at checkout. Final total is confirmed by the store.
          </Text>
        </View>
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 border-t border-inkdeep/10 bg-white px-4 pb-8 pt-3">
        <Pressable
          accessibilityRole="button"
          disabled={!cart.canCheckout}
          onPress={() => router.push("/checkout")}
          className={`items-center rounded-2xl px-5 py-4 ${cart.canCheckout ? "bg-brand" : "bg-inkdeep/20"}`}
          testID="go-to-checkout"
        >
          <Text className="text-base font-semibold text-white">
            {cart.canCheckout ? "Proceed to checkout" : "Fix flagged items to continue"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function CartRow({
  line,
  onDec,
  onInc,
  onRemove,
}: {
  line: CartLine;
  onDec: () => void;
  onInc: () => void;
  onRemove: () => void;
}) {
  const missing = !line.product;
  const soldOut = !!line.product && !line.product.isAvailable;

  return (
    <View
      className={`mb-3 rounded-xl border bg-white p-3 ${
        missing || soldOut ? "border-mango/50" : "border-inkdeep/10"
      }`}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-base font-semibold text-inkdeep" numberOfLines={2}>
            {line.product?.name ?? "Item no longer available"}
          </Text>
          {line.product ? (
            <Text className="mt-0.5 text-xs text-inkdeep/60">
              {rupees(line.product.salePrice)}
              {line.product.unitLabel ? ` · ${line.product.unitLabel}` : ""}
            </Text>
          ) : null}
          {missing ? (
            <Text className="mt-1 text-xs font-semibold text-mango">This product was removed from the catalog.</Text>
          ) : soldOut ? (
            <Text className="mt-1 text-xs font-semibold text-mango">Currently sold out.</Text>
          ) : null}
        </View>
        <Text className="text-sm font-semibold text-brand-deep">{rupees(line.lineTotal)}</Text>
      </View>

      <View className="mt-3 flex-row items-center justify-between">
        <View className="flex-row items-center gap-4 rounded-full bg-paper px-2">
          <Pressable accessibilityLabel="Decrease" hitSlop={8} onPress={onDec} testID={`row-dec-${line.productId}`}>
            <Text className="px-2 text-lg font-bold text-brand">−</Text>
          </Pressable>
          <Text className="min-w-4 text-center text-sm font-semibold text-inkdeep">{line.qty}</Text>
          <Pressable accessibilityLabel="Increase" hitSlop={8} onPress={onInc} testID={`row-inc-${line.productId}`}>
            <Text className="px-2 text-lg font-bold text-brand">+</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" onPress={onRemove} testID={`row-remove-${line.productId}`}>
          <Text className="text-xs font-semibold text-mango">Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}
