import { FlashList } from "@shopify/flash-list";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { CatalogEmptyState, CatalogErrorState, CatalogSkeleton } from "../../components/catalog/CatalogStates";
import { ProductCard } from "../../components/catalog/ProductCard";
import { useAuth } from "../../lib/auth/AuthProvider";
import { useCartStore } from "../../lib/cart/store";
import { cartCount } from "../../lib/cart/logic.ts";
import { rupees } from "../../lib/format";
import { useCart } from "../../hooks/useCart";
import { useCatalog } from "../../hooks/useCatalog";
import { useProfile } from "../../hooks/useProfile";

export default function CustomerHome() {
  const { signOut } = useAuth();
  const { data: profile } = useProfile();
  const catalog = useCatalog();

  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const cart = useCart();
  const count = cartCount(items);

  return (
    <View className="flex-1 bg-paper pt-14">
      <View className="flex-row items-center justify-between px-4 pb-3">
        <View>
          <Text className="text-xl font-bold text-brand-deep">Craavee</Text>
          {profile?.full_name ? (
            <Text className="text-sm text-inkdeep/60">Hi, {profile.full_name}</Text>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" onPress={() => signOut()} testID="logout-button">
          <Text className="text-sm font-semibold text-brand">Log out</Text>
        </Pressable>
      </View>

      {catalog.isPending ? (
        <CatalogSkeleton />
      ) : catalog.isError ? (
        <CatalogErrorState onRetry={() => catalog.refetch()} />
      ) : catalog.data.length === 0 ? (
        <CatalogEmptyState />
      ) : (
        <FlashList
          data={catalog.data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              qtyInCart={items[item.id] ?? 0}
              onAdd={add}
              onIncrement={increment}
              onDecrement={decrement}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: count > 0 ? 96 : 16 }}
          onRefresh={() => catalog.refetch()}
          refreshing={catalog.isFetching && !catalog.isPending}
          testID="catalog-list"
        />
      )}

      {count > 0 ? (
        <View className="absolute inset-x-0 bottom-0 px-4 pb-6">
          <Link href="/cart" asChild>
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center justify-between rounded-2xl bg-brand px-5 py-4"
              testID="cart-fab"
            >
              <Text className="text-base font-semibold text-white">
                {count} {count === 1 ? "item" : "items"}
              </Text>
              <Text className="text-base font-semibold text-white">
                {rupees(cart.indicativeSubtotal)} · View cart
              </Text>
            </Pressable>
          </Link>
        </View>
      ) : null}
    </View>
  );
}
