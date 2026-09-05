/**
 * Browse — category results with filters and sort.
 *
 * The whole shopping query lives in the ROUTE PARAMS, not in component
 * state. That single decision buys three things the brief asks for
 * separately:
 *
 *   §12  the state is URL-addressable on web - /browse?category=Dairy&
 *        brand=Amul&sort=price_asc is shareable and bookmarkable
 *   §13  on native the same params are route state, so navigating to a
 *        product and coming back restores the category, the filters and
 *        the sort with no save/restore code at all
 *   §26  "back from product detail" needs no special handling, because
 *        nothing was ever held outside the route
 *
 * `setParams` replaces the current entry rather than pushing, so
 * adjusting a filter does not bury the customer under a stack of
 * back-presses.
 */
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { CategoryRail } from "../../components/discovery/CategoryRail";
import { FilterSheet, SortSheet } from "../../components/discovery/FilterSheet";
import { ProductResults } from "../../components/discovery/ProductResults";
import { ResultsToolbar } from "../../components/discovery/ResultsToolbar";
import { Screen, StaleBanner } from "../../components/ui";
import { CartBar } from "../../components/discovery/CartBar";
import {
  clearFilters,
  fromParams,
  hasAnyNarrowing,
  toParams,
  type ProductQuery,
} from "../../lib/discovery/query";
import { useFacets } from "../../hooks/useFacets";
import { flattenFeed, useProductFeed } from "../../hooks/useProductFeed";

export default function BrowseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const query = useMemo(() => fromParams(params as Record<string, unknown>), [params]);

  const facets = useFacets(query.category);
  const feed = useProductFeed(query);
  const { products, total } = flattenFeed(feed.data?.pages);

  const update = useCallback(
    (next: ProductQuery) => {
      // Replace, not push: a filter change is an edit of the current view,
      // not a new destination.
      router.setParams(toParams(next));
    },
    [router],
  );

  const settling = feed.isFetching && feed.isPlaceholderData;

  const header = (
    <View className="pb-1">
      {feed.isError && products.length > 0 ? (
        <View className="mb-2 px-4">
          <StaleBanner kind="stale" onRetry={() => feed.refetch()} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen padded={false} edges={["top"]}>
      <Stack.Screen options={{ title: query.category ?? "Browse" }} />

      <View className="pb-2">
        <CategoryRail
          categories={facets.categories}
          selected={query.category}
          onSelect={(c) => update({ ...query, category: c })}
          testID="browse-category-rail"
        />
      </View>

      <ResultsToolbar
        query={query}
        total={feed.isPending ? null : total}
        isSettling={settling}
        onOpenFilters={() => setFiltersOpen(true)}
        onOpenSort={() => setSortOpen(true)}
        onChange={update}
      />

      <ProductResults
        products={products}
        isPending={feed.isPending}
        isError={feed.isError}
        isSettling={settling}
        hasNarrowing={hasAnyNarrowing(query)}
        onRetry={() => feed.refetch()}
        onClearFilters={() => update(clearFilters(query))}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        isFetchingNextPage={feed.isFetchingNextPage}
        ListHeaderComponent={header}
        bottomPadding={104}
        testID="browse-results"
      />

      <CartBar />

      <FilterSheet
        visible={filtersOpen}
        query={query}
        brands={facets.brands}
        priceFloor={facets.priceFloor}
        priceCeiling={facets.priceCeiling}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFiltersOpen(false);
          update(next);
        }}
      />

      <SortSheet
        visible={sortOpen}
        value={query.sort}
        onClose={() => setSortOpen(false)}
        onSelect={(sort) => {
          setSortOpen(false);
          update({ ...query, sort });
        }}
      />
    </Screen>
  );
}
