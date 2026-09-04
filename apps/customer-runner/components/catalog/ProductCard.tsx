import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

import type { CatalogProduct } from "../../hooks/useCatalog";

/**
 * A single catalog row. `expo-image` per Phase 3 §15 (approved image
 * architecture for the Expo customer experience) — gives disk+memory
 * caching for free, which matters here since the same product image
 * reappears across catalog refetches.
 *
 * Phase 4: an optional "Add" affordance. `qtyInCart` and the +/- controls
 * are driven entirely by the client cart store (Phase 4 §3) — this
 * component holds no state of its own.
 */
export function ProductCard({
  product,
  qtyInCart = 0,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  product: CatalogProduct;
  qtyInCart?: number;
  onAdd?: (productId: string) => void;
  onIncrement?: (productId: string) => void;
  onDecrement?: (productId: string) => void;
}) {
  const discounted = product.salePrice < product.mrp;

  return (
    <View
      className={`mb-3 flex-row gap-3 rounded-xl border border-inkdeep/10 bg-white p-3 ${
        product.isAvailable ? "" : "opacity-50"
      }`}
    >
      <View className="h-20 w-20 overflow-hidden rounded-lg bg-paper">
        {product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={150}
          />
        ) : null}
      </View>

      <View className="flex-1 justify-center gap-1">
        <Text className="text-base font-semibold text-inkdeep" numberOfLines={2}>
          {product.name}
        </Text>
        {product.brand ? (
          <Text className="text-xs text-inkdeep/60">{product.brand}</Text>
        ) : null}
        {product.unitLabel ? (
          <Text className="text-xs text-inkdeep/60">{product.unitLabel}</Text>
        ) : null}

        <View className="flex-row items-center gap-2">
          <Text className="text-base font-bold text-brand-deep">
            ₹{(product.salePrice / 100).toFixed(2)}
          </Text>
          {discounted ? (
            // `pr-1` is load-bearing, not spacing. On Android this Text
            // rendered one glyph short - "₹50.0" for a ₹50.00 MRP - while
            // the strike-through line still drew to the full measured
            // width, which is what gave the clipping away. The view was a
            // few px narrower than the glyphs it had measured; the padding
            // is what gives the last character room. Found on a physical
            // V2250 (Android 15) at font_scale 1.0 - a layout defect, not a
            // text-scaling artefact - and never reproduced on iOS.
            <Text className="pr-1 text-xs text-inkdeep/40 line-through">
              ₹{(product.mrp / 100).toFixed(2)}
            </Text>
          ) : null}
        </View>

        {!product.isAvailable ? (
          <Text className="text-xs font-semibold text-mango">Sold out</Text>
        ) : onAdd ? (
          qtyInCart > 0 ? (
            <View className="mt-1 flex-row items-center gap-3 self-start rounded-full bg-brand/10 px-1">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${product.name}`}
                hitSlop={8}
                onPress={() => onDecrement?.(product.id)}
                testID={`cart-dec-${product.id}`}
              >
                <Text className="px-2 text-lg font-bold text-brand">−</Text>
              </Pressable>
              <Text className="min-w-4 text-center text-sm font-semibold text-brand-deep">{qtyInCart}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Increase ${product.name}`}
                hitSlop={8}
                onPress={() => onIncrement?.(product.id)}
                testID={`cart-inc-${product.id}`}
              >
                <Text className="px-2 text-lg font-bold text-brand">+</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${product.name} to cart`}
              onPress={() => onAdd(product.id)}
              className="mt-1 self-start rounded-full bg-brand px-4 py-1.5"
              testID={`add-${product.id}`}
            >
              <Text className="text-sm font-semibold text-white">Add</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}
