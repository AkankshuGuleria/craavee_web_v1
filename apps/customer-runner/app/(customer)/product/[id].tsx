/**
 * Product detail.
 *
 * The product is the hero: a large square image, then name, then price,
 * then availability, then the action. Everything below that line is
 * secondary and is rendered as a quiet definition list rather than more
 * cards.
 *
 * Only real fields are shown. The catalog view exposes name, brand,
 * image_url, mrp, sale_price, unit_label, category and a computed
 * is_available - and that is the entire list. There is no description
 * column, so there is no description section; no ratings, no reviews, no
 * "customers also bought". Inventing any of those would mean inventing
 * data.
 *
 * Because `useProduct` seeds from the catalog cache, arriving here from a
 * tap paints complete on the first frame and costs no request on the
 * common path. The skeleton below is for the deep-link case - opening
 * this URL cold, with no catalog in cache.
 */
import { Link, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ErrorState, Screen, Skeleton, StaleBanner } from "../../../components/ui";
import { Price } from "../../../components/ui/Price";
import { ProductImage } from "../../../components/ui/ProductImage";
import { QtyStepper } from "../../../components/ui/QtyStepper";
import { cartCount } from "../../../lib/cart/logic.ts";
import { useCartStore } from "../../../lib/cart/store";
import { haptic } from "../../../lib/haptics";
import { rupees } from "../../../lib/format";
import { useCart } from "../../../hooks/useCart";
import { useProduct } from "../../../hooks/useProduct";

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = useProduct(id);

  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const cart = useCart();
  const count = cartCount(items);

  const qty = id ? (items[id] ?? 0) : 0;

  if (product.isPending) {
    return (
      <Screen edges={["top"]}>
        <View className="gap-4">
          <Skeleton height={320} radius={20} />
          <Skeleton height={28} />
          <Skeleton height={20} width="60%" />
        </View>
      </Screen>
    );
  }

  // Only a total failure with nothing cached is a dead end. A failed
  // refresh with data in hand is a STALE state, handled below - the same
  // rule the order tracking screen follows.
  if (!product.data) {
    return (
      <Screen edges={["top"]}>
        <ErrorState
          title="Couldn't load this product"
          detail="It may no longer be available."
          onRetry={() => product.refetch()}
        />
      </Screen>
    );
  }

  const p = product.data;
  const discounted = p.salePrice < p.mrp;
  const saving = p.mrp - p.salePrice;

  return (
    <Screen padded={false} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: count > 0 ? 112 : 32 }}>
        {product.isError ? (
          <View className="mb-3">
            <StaleBanner kind="stale" onRetry={() => product.refetch()} />
          </View>
        ) : null}

        <View style={{ opacity: p.isAvailable ? 1 : 0.5 }}>
          <ProductImage uri={p.imageUrl} name={p.name} rounded={20} scale="lg" />
        </View>

        <Text className="mt-5 text-2xl font-bold leading-8 text-inkdeep" accessibilityRole="header">
          {p.name}
        </Text>

        {p.brand ? <Text className="mt-1 text-sm text-inkdeep/60">{p.brand}</Text> : null}

        <View className="mt-3 flex-row items-baseline">
          <Price salePrice={p.salePrice} mrp={p.mrp} size="lg" testID="pdp-price" />
          {discounted ? (
            <Text className="shrink-0 pl-1 pr-1 text-sm font-semibold text-mango">
              Save {rupees(saving)}
            </Text>
          ) : null}
        </View>

        {/* Availability in words as well as colour. */}
        <Text
          className={`mt-2 text-sm font-semibold ${p.isAvailable ? "text-brand" : "text-mango"}`}
        >
          {p.isAvailable ? "In stock" : "Sold out"}
        </Text>

        <View className="mt-6">
          {!p.isAvailable ? (
            <View className="rounded-xl bg-mango/10 px-4 py-3">
              <Text className="text-sm text-inkdeep/70">
                This item is out of stock right now. The store restocks through the day.
              </Text>
            </View>
          ) : qty > 0 ? (
            <View className="flex-row items-center gap-4">
              <QtyStepper
                qty={qty}
                productName={p.name}
                size="md"
                onIncrement={() => increment(p.id)}
                onDecrement={() => decrement(p.id)}
                testIDPrefix="pdp"
              />
              <Text className="text-sm text-inkdeep/60">in your cart</Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${p.name} to cart`}
              onPress={() => {
                haptic("success");
                add(p.id);
              }}
              testID="pdp-add"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              className="min-h-[52px] items-center justify-center rounded-2xl bg-brand"
            >
              <Text className="text-base font-bold text-white">Add to cart</Text>
            </Pressable>
          )}
        </View>

        {/* Secondary detail: quiet rows, not another stack of cards. */}
        <View className="mt-8 gap-3">
          {p.unitLabel ? <DetailRow label="Unit" value={p.unitLabel} /> : null}
          <DetailRow label="Category" value={p.category} />
        </View>

        <Text className="mt-8 text-xs leading-5 text-inkdeep/45">
          Prices and availability are confirmed by the store when it accepts your order.
        </Text>
      </ScrollView>

      {count > 0 ? (
        <View className="absolute inset-x-0 bottom-0 px-4 pb-8">
          <Link href="/cart" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View cart, ${count} ${count === 1 ? "item" : "items"}, ${rupees(cart.indicativeSubtotal)}`}
              className="min-h-[56px] flex-row items-center justify-between rounded-2xl bg-brand px-5"
              testID="pdp-cart-bar"
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
      ) : null}
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between border-b border-inkdeep/5 pb-3">
      <Text className="flex-1 text-sm text-inkdeep/50">{label}</Text>
      <Text className="shrink-0 pl-3 pr-1 text-sm font-medium text-inkdeep">{value}</Text>
    </View>
  );
}
