/**
 * The product results grid. Rendered identically by category browsing and
 * by search, because they are the same thing with different filters set.
 *
 * Every state a result set can be in is handled here once, so a state
 * cannot exist on one screen and be missing on the other:
 *
 *   pending   skeletons shaped like the grid
 *   error     recoverable, never a dead end
 *   empty     distinguishes "nothing matches your filters" from
 *             "nothing here", because the recovery differs
 *   settling  previous results dimmed, not blanked
 *   paging    a footer spinner, not a full-screen one
 */
import { FlashList } from "@shopify/flash-list";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { CatalogProduct } from "../../hooks/useCatalog";
import { EmptyState, ErrorState, SkeletonList } from "../ui";
import { ProductCard } from "../catalog/ProductCard";
import { useCartStore } from "../../lib/cart/store";
import { theme } from "../../lib/theme";

export function ProductResults({
  products,
  isPending,
  isError,
  isSettling,
  hasNarrowing,
  onRetry,
  onClearFilters,
  onEndReached,
  isFetchingNextPage,
  emptyTitle,
  emptyHint,
  ListHeaderComponent,
  bottomPadding = 24,
  testID,
}: {
  products: CatalogProduct[];
  isPending: boolean;
  isError: boolean;
  isSettling: boolean;
  /** Whether a search/category/filter is applied — changes the empty copy. */
  hasNarrowing: boolean;
  onRetry: () => void;
  onClearFilters?: () => void;
  onEndReached?: () => void;
  isFetchingNextPage?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  ListHeaderComponent?: React.ReactElement | null;
  bottomPadding?: number;
  testID?: string;
}) {
  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);

  if (isPending) {
    return (
      <View className="flex-1">
        {ListHeaderComponent}
        <View className="px-4">
          <SkeletonList rows={4} height={180} />
        </View>
      </View>
    );
  }

  // Only a failure with NOTHING to show is a dead end. A failed refresh
  // with results in hand is handled by the caller's stale banner.
  if (isError && products.length === 0) {
    return (
      <View className="flex-1">
        {ListHeaderComponent}
        <ErrorState
          title="Couldn't load products"
          detail="Check your connection and try again."
          onRetry={onRetry}
        />
      </View>
    );
  }

  if (products.length === 0) {
    return (
      <View className="flex-1">
        {ListHeaderComponent}
        <EmptyState
          title={emptyTitle ?? (hasNarrowing ? "No products match" : "Nothing available right now")}
          hint={
            emptyHint ??
            (hasNarrowing
              ? "Try removing a filter, or widening the price range."
              : "The store may be restocking.")
          }
          action={
            // A no-results screen without a way out is the dead end §24
            // exists to prevent. Clearing filters keeps the search term
            // and category, so the customer widens rather than restarts.
            hasNarrowing && onClearFilters ? (
              <ClearAction onPress={onClearFilters} />
            ) : undefined
          }
        />
      </View>
    );
  }

  // Pairs rather than `numColumns`, so a full-width header can sit inside
  // the same recycling list as the grid.
  const rows: { key: string; left: CatalogProduct; right?: CatalogProduct }[] = [];
  for (let i = 0; i < products.length; i += 2) {
    rows.push({ key: products[i].id, left: products[i], right: products[i + 1] });
  }

  return (
    <View className="flex-1" style={{ opacity: isSettling ? 0.55 : 1 }}>
      <FlashList
        data={rows}
        keyExtractor={(r) => r.key}
        ListHeaderComponent={ListHeaderComponent}
        renderItem={({ item: row }) => (
          <View className="flex-row">
            <View className="flex-1 pr-2">
              <ProductCard
                product={row.left}
                qtyInCart={items[row.left.id] ?? 0}
                onAdd={add}
                onIncrement={increment}
                onDecrement={decrement}
              />
            </View>
            <View className="flex-1 pl-2">
              {row.right ? (
                <ProductCard
                  product={row.right}
                  qtyInCart={items[row.right.id] ?? 0}
                  onAdd={add}
                  onIncrement={increment}
                  onDecrement={decrement}
                />
              ) : null}
            </View>
          </View>
        )}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPadding }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListFooterComponent={
          isFetchingNextPage ? (
            <View className="items-center py-6">
              <ActivityIndicator color={theme.brand} />
            </View>
          ) : null
        }
        testID={testID}
      />
    </View>
  );
}

function ClearAction({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Clear filters"
      onPress={onPress}
      testID="empty-clear-filters"
      className="mt-3 min-h-[44px] justify-center rounded-full bg-brand px-6"
    >
      <Text className="text-sm font-bold text-white">Clear filters</Text>
    </Pressable>
  );
}
