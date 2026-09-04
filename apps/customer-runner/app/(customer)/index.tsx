/**
 * Home / catalog.
 *
 * Slice 2 changed the composition, not the data. It was a single column
 * of full-width white cards, which read as a listing rather than a
 * storefront - you could see three products and a lot of border.
 *
 * Now: a two-column grid of image-led tiles on the paper ground, under a
 * header and a search entry. Roughly six products are visible at once
 * instead of three, and the thing the eye lands on is a product rather
 * than a rectangle.
 *
 * The search entry is a button that opens a dedicated screen, not an
 * inline field. An inline field on Home would either steal focus and
 * raise the keyboard over the catalog on arrival, or sit inert and
 * decorative. A dedicated screen also gives search its own back stack
 * entry, so dismissing it returns the customer exactly where they were.
 *
 * NO fabricated merchandising. There are no "trending", "popular" or
 * "recommended" sections because the backend has no such data and the
 * brief forbids inventing it. Products are grouped by the `category`
 * column that genuinely exists, and the heading only renders when there
 * is more than one category - one heading above the only group is noise.
 */
import { FlashList } from "@shopify/flash-list";
import { Link } from "expo-router";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { EmptyState, ErrorState, Screen, SkeletonList } from "../../components/ui";
import { ProductCard } from "../../components/catalog/ProductCard";
import { useAuth } from "../../lib/auth/AuthProvider";
import { useCartStore } from "../../lib/cart/store";
import { cartCount } from "../../lib/cart/logic.ts";
import { rupees } from "../../lib/format";
import { useCart } from "../../hooks/useCart";
import { type CatalogProduct, useCatalog } from "../../hooks/useCatalog";
import { useProfile } from "../../hooks/useProfile";

/** A grid row is either a category heading or a pair of products. */
type Row =
  | { kind: "header"; key: string; title: string }
  | { kind: "pair"; key: string; left: CatalogProduct; right?: CatalogProduct };

/**
 * Built manually rather than with `numColumns`, because a flat two-column
 * list cannot interleave full-width section headings. This keeps one
 * FlashList (and its recycling) instead of nesting a list per section.
 */
function buildRows(products: CatalogProduct[]): Row[] {
  const byCategory = new Map<string, CatalogProduct[]>();
  for (const p of products) {
    const list = byCategory.get(p.category);
    if (list) list.push(p);
    else byCategory.set(p.category, [p]);
  }

  const multi = byCategory.size > 1;
  const rows: Row[] = [];

  for (const [category, list] of byCategory) {
    if (multi) rows.push({ kind: "header", key: `h:${category}`, title: category });
    for (let i = 0; i < list.length; i += 2) {
      rows.push({ kind: "pair", key: `p:${list[i].id}`, left: list[i], right: list[i + 1] });
    }
  }

  return rows;
}

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

  const rows = useMemo(() => buildRows(catalog.data ?? []), [catalog.data]);

  return (
    // Phase 10D: `Screen` replaces `pt-14`. That magic number was eyeballed
    // against one simulator's status bar and is wrong on any device with a
    // different inset, and wrong again in landscape.
    <Screen padded={false} edges={["top"]}>
      <View className="flex-row items-center justify-between px-4 pb-3">
        <View className="flex-1">
          <Text className="text-2xl font-bold text-brand-deep">Craavee</Text>
          {profile?.full_name ? (
            <Text className="text-sm text-inkdeep/55" numberOfLines={1}>
              Hi, {profile.full_name}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log out"
          onPress={() => signOut()}
          testID="logout-button"
          hitSlop={8}
          className="min-h-[44px] shrink-0 items-center justify-center px-3"
        >
          <Text className="text-sm font-semibold text-brand">Log out</Text>
        </Pressable>
      </View>

      <View className="px-4 pb-4">
        <Link href="/search" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search products"
            accessibilityHint="Opens search"
            testID="search-entry"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            className="min-h-[48px] flex-row items-center rounded-full bg-white px-4"
          >
            <Text className="mr-2 shrink-0 text-base text-inkdeep/40">⌕</Text>
            {/* `flex-1` + numberOfLines: at 360dp the longer copy was hard
                clipped mid-word ("drinks,") rather than ellipsised, which
                reads as a rendering fault rather than as truncation. */}
            <Text className="flex-1 text-[15px] text-inkdeep/40" numberOfLines={1}>
              Search snacks, drinks, essentials
            </Text>
          </Pressable>
        </Link>
      </View>

      {catalog.isPending ? (
        <View className="px-4">
          <SkeletonList rows={4} height={180} />
        </View>
      ) : catalog.isError && !catalog.data ? (
        <ErrorState
          title="Couldn't load the menu"
          detail="Check your connection and try again."
          onRetry={() => catalog.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing available right now"
          hint="The store may be restocking. Pull to refresh."
        />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) =>
            row.kind === "header" ? (
              <Text
                accessibilityRole="header"
                className="mb-3 mt-1 text-xs font-bold uppercase tracking-wider text-inkdeep/45"
              >
                {row.title}
              </Text>
            ) : (
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
            )
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: count > 0 ? 104 : 24 }}
          onRefresh={() => catalog.refetch()}
          refreshing={catalog.isFetching && !catalog.isPending}
          testID="catalog-list"
        />
      )}

      {count > 0 ? (
        // `pb-6` was a guess at the home indicator. SafeAreaView's bottom
        // edge is excluded above (edges={["top"]}) precisely so this bar can
        // own its own inset and sit flush with the indicator.
        <View className="absolute inset-x-0 bottom-0 px-4 pb-8">
          <Link href="/cart" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View cart, ${count} ${count === 1 ? "item" : "items"}, ${rupees(cart.indicativeSubtotal)}`}
              className="min-h-[56px] flex-row items-center justify-between rounded-2xl bg-brand px-5"
              testID="cart-fab"
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
