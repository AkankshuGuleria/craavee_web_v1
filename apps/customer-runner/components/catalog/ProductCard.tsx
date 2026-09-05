/**
 * A product, as a grid tile.
 *
 * This replaced a full-width white card with a bordered box, a text
 * block and a green button - repeated down the screen. Android device QA
 * made the problem obvious: the catalog read as a database listing, not
 * a storefront, because every row was the same rectangle and the product
 * itself was the smallest thing on it.
 *
 * What changed, and why:
 *
 *   * The image is the anchor and sits at the top at a fixed 1:1 ratio,
 *     so the eye lands on the product rather than on a border.
 *   * There is no card. The tile sits directly on the paper ground; the
 *     image's own rounded block provides the structure a border was
 *     doing badly. Fewer surfaces, more hierarchy.
 *   * Typography is ranked rather than uniform: name, then price, then
 *     metadata at caption weight. Brand and unit share one line - they
 *     were previously two full-height rows competing with the name.
 *   * Two per row instead of one, so the viewport shows real breadth of
 *     stock instead of three items and a lot of white.
 *
 * Money never clips, and that is not this file's job any more: prices go
 * through the shared `Price` component, which carries the Android
 * strike-through fix. See components/ui/Price.tsx for why that fix is
 * what it is.
 */
import { Link } from "expo-router";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import type { CatalogProduct } from "../../hooks/useCatalog";
import { haptic } from "../../lib/haptics";
import { Price } from "../ui/Price";
import { ProductImage } from "../ui/ProductImage";
import { QtyStepper } from "../ui/QtyStepper";

function ProductCardImpl({
  product,
  qtyInCart,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  product: CatalogProduct;
  qtyInCart: number;
  onAdd?: (productId: string) => void;
  onIncrement?: (productId: string) => void;
  onDecrement?: (productId: string) => void;
}) {
  const discounted = product.salePrice < product.mrp;
  const soldOut = !product.isAvailable;

  // Brand and unit are the same rank of information and were each taking
  // a full line. One line, one separator, one colour.
  const meta = [product.brand, product.unitLabel].filter(Boolean).join(" · ");

  return (
    <View className="mb-4 flex-1" testID={`product-${product.id}`}>
      <Link href={`/product/${product.id}`} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${product.name}${product.brand ? `, ${product.brand}` : ""}, ₹${(
            product.salePrice / 100
          ).toFixed(2)}${soldOut ? ", sold out" : ""}`}
          accessibilityHint="Opens product details"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ opacity: soldOut ? 0.45 : 1 }}>
            <ProductImage uri={product.imageUrl} name={product.name} rounded={16} />
          </View>

          <Text
            className="mt-2 text-[15px] font-semibold leading-5 text-inkdeep"
            numberOfLines={2}
          >
            {product.name}
          </Text>

          {meta ? (
            <Text className="mt-0.5 text-[11px] leading-4 text-inkdeep/50" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}

          <View className="mt-1">
            <Price salePrice={product.salePrice} mrp={product.mrp} />
          </View>

        </Pressable>
      </Link>

      <View className="mt-2">
        {soldOut ? (
          // Not colour alone: the word is present, and the tile above is
          // dimmed. A red dot would fail for a colour-blind customer.
          <Text className="text-xs font-semibold text-mango">Sold out</Text>
        ) : qtyInCart > 0 ? (
          <QtyStepper
            qty={qtyInCart}
            productName={product.name}
            onIncrement={() => onIncrement?.(product.id)}
            onDecrement={() => onDecrement?.(product.id)}
            testIDPrefix={`cart-${product.id}`}
          />
        ) : onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${product.name} to cart`}
            hitSlop={8}
            onPress={() => {
              // A committed state change the customer may not be looking
              // at - exactly what the haptics rules reserve `success` for.
              haptic("success");
              onAdd(product.id);
            }}
            testID={`add-${product.id}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            className="self-start rounded-full border border-brand/30 bg-brand/10 px-5 py-1.5"
          >
            <Text className="text-sm font-bold text-brand">Add</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Memoised: the catalog re-renders on every cart mutation, and without
 * this each keystroke of a quantity change re-rendered every tile in the
 * grid rather than the one that changed.
 */
export const ProductCard = memo(ProductCardImpl);
