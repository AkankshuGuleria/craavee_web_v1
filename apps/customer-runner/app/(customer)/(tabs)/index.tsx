/**
 * Home — a structured storefront, not a product feed.
 *
 * Slice 2 made the products look right. This slice changes what the
 * screen is FOR. It was header → search → one long grid, which answers
 * "what is in stock?" and nothing else. A customer arriving with an
 * intent ("something to drink", "under fifty rupees") had to scroll and
 * hope.
 *
 * The structure now answers four questions in order:
 *
 *   Where am I?      the header
 *   What can I get?  the category rail - real `products.category` values
 *   How do I narrow? search, and Browse all with filters
 *   What's here?     per-category sections, each capped, each with a way
 *                    into the full filtered results
 *
 * Sections are capped at four products and offer "See all". A section
 * that renders its whole category is just the old flat grid with
 * headings; capping it is what turns the home screen into an index
 * rather than a dump.
 *
 * NOTHING IS FABRICATED. There is no "trending", "popular", "recommended"
 * or "recently viewed" section, because the backend records no
 * popularity, no view history and no purchase history. Sections are
 * category groupings of the real catalogue, ordered by the store's own
 * `sort_order`. The moment real signals exist, `Section` below is the
 * place they render.
 */
import { FlashList } from "@shopify/flash-list";
import { Link, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { CartBar } from "../../../components/discovery/CartBar";
import { CategoryRail } from "../../../components/discovery/CategoryRail";
import { EmptyState, ErrorState, Screen, SkeletonList } from "../../../components/ui";
import { ProductCard } from "../../../components/catalog/ProductCard";
import { useCartStore } from "../../../lib/cart/store";
import { cartCount } from "../../../lib/cart/logic.ts";
import { type CatalogProduct, useCatalog } from "../../../hooks/useCatalog";
import { useFacets } from "../../../hooks/useFacets";
import { useProfile } from "../../../hooks/useProfile";

/** How many products a home section shows before "See all". */
const SECTION_LIMIT = 4;

type Row =
  | { kind: "sectionHeader"; key: string; category: string; total: number }
  | { kind: "pair"; key: string; left: CatalogProduct; right?: CatalogProduct };

function buildRows(products: CatalogProduct[]): Row[] {
  const byCategory = new Map<string, CatalogProduct[]>();
  for (const p of products) {
    const list = byCategory.get(p.category);
    if (list) list.push(p);
    else byCategory.set(p.category, [p]);
  }

  const rows: Row[] = [];
  for (const [category, list] of byCategory) {
    rows.push({
      kind: "sectionHeader",
      key: `h:${category}`,
      category,
      total: list.length,
    });
    const shown = list.slice(0, SECTION_LIMIT);
    for (let i = 0; i < shown.length; i += 2) {
      rows.push({ kind: "pair", key: `p:${shown[i].id}`, left: shown[i], right: shown[i + 1] });
    }
  }
  return rows;
}

export default function CustomerHome() {
  const router = useRouter();
  const { data: profile } = useProfile();
  const catalog = useCatalog();
  const facets = useFacets();

  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const count = cartCount(items);

  const rows = useMemo(() => buildRows(catalog.data ?? []), [catalog.data]);

  const header = (
    <View>
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
            <Text className="flex-1 text-[15px] text-inkdeep/40" numberOfLines={1}>
              Search snacks, drinks, essentials
            </Text>
          </Pressable>
        </Link>
      </View>

      <View className="-mx-4 pb-3">
        <CategoryRail
          categories={facets.categories}
          selected={null}
          // Selecting from home is a NEW destination, so this pushes
          // rather than replacing - back should return to home.
          onSelect={(c) =>
            router.push(c ? `/browse?category=${encodeURIComponent(c)}` : "/browse")
          }
          testID="home-category-rail"
        />
      </View>
    </View>
  );

  return (
    // Phase 10D: `Screen` replaces `pt-14`. That magic number was eyeballed
    // against one simulator's status bar and is wrong on any device with a
    // different inset, and wrong again in landscape.
    <Screen padded={false} edges={["top"]}>
      {/* Orders and Sign out moved to the tab bar and the Account tab.
          A header that accumulates one text link per capability is how a
          screen ends up with five, none of them prominent. */}
      <View className="px-4 pb-3">
        <Text className="text-2xl font-bold text-brand-deep">Craavee</Text>
        {profile?.full_name ? (
          <Text className="text-sm text-inkdeep/55" numberOfLines={1}>
            Hi, {profile.full_name}
          </Text>
        ) : null}
      </View>

      {catalog.isPending ? (
        <View className="px-4">
          <SkeletonList rows={4} height={180} />
        </View>
      ) : catalog.isError && !catalog.data ? (
        <ErrorState
          title="Couldn't load the store"
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
          ListHeaderComponent={header}
          renderItem={({ item: row }) =>
            row.kind === "sectionHeader" ? (
              <View className="mb-3 mt-2 flex-row items-baseline justify-between">
                <Text
                  accessibilityRole="header"
                  className="flex-1 text-base font-bold text-inkdeep"
                  numberOfLines={1}
                >
                  {row.category}
                </Text>
                {/* Unconditional, not `total > SECTION_LIMIT`. With the
                    current catalogue the largest category holds exactly
                    four products, so a conditional link would NEVER
                    render and every section would be a dead end with no
                    way into its filtered view. The affordance is also the
                    only route to that category's filters and sort, which
                    is worth offering even when nothing is hidden. */}
                <Link href={`/browse?category=${encodeURIComponent(row.category)}`} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`See all ${row.total} in ${row.category}`}
                    hitSlop={10}
                    testID={`see-all-${row.category}`}
                    className="min-h-[32px] shrink-0 justify-center pl-3"
                  >
                    <Text className="text-sm font-semibold text-brand">See all</Text>
                  </Pressable>
                </Link>
              </View>
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
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: count > 0 ? 172 : 92 }}
          onRefresh={() => catalog.refetch()}
          refreshing={catalog.isFetching && !catalog.isPending}
          testID="catalog-list"
        />
      )}

      <CartBar aboveTabBar />
    </Screen>
  );
}
