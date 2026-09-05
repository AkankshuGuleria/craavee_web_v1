/**
 * Search — the same shopping query as Browse, entered by typing.
 *
 * Slice 2 built search as its own thing with its own results list. This
 * slice folds it onto the shared `ProductQuery`, which is what lets a
 * customer search "milk" and then narrow to Dairy, to Amul, to under
 * fifty rupees, sorted by price - without search and browse disagreeing
 * about what "filtered" means. Same query object, same feed hook, same
 * results grid, same toolbar.
 *
 * The query lives in route params (§13/§22), so going into a product and
 * coming back restores the term, the category, the filters and the sort.
 * The text field is seeded from those params and is the only piece of
 * local state - it has to be, because it updates on every keystroke while
 * the committed query updates only after the debounce.
 *
 * What makes it feel immediate is unchanged and measured: a 300ms
 * debounce, request cancellation, a shared cache, and previous results
 * kept on screen (dimmed) rather than blanked while the next term lands.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { CartBar } from "../../components/discovery/CartBar";
import { CategoryRail } from "../../components/discovery/CategoryRail";
import { FilterSheet, SortSheet } from "../../components/discovery/FilterSheet";
import { ProductResults } from "../../components/discovery/ProductResults";
import { ResultsToolbar } from "../../components/discovery/ResultsToolbar";
import { EmptyState, Screen, StaleBanner } from "../../components/ui";
import {
  clearFilters,
  fromParams,
  hasAnyNarrowing,
  toParams,
  type ProductQuery,
} from "../../lib/discovery/query";
import { MIN_QUERY_LENGTH } from "../../lib/search/query";
import { useDebounced } from "../../lib/useDebounced";
import { useFacets } from "../../hooks/useFacets";
import { flattenFeed, useProductFeed } from "../../hooks/useProductFeed";
import { theme } from "../../lib/theme";

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const inputRef = useRef<TextInput>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const committed = useMemo(() => fromParams(params as Record<string, unknown>), [params]);

  // Local text is the only non-route state, and only because it changes
  // per keystroke while the route changes per debounce.
  const [text, setText] = useState(committed.q);
  const debouncedText = useDebounced(text, 300);

  // Push the debounced term into the route so it participates in the same
  // query object as the filters, and survives navigation.
  useEffect(() => {
    if (debouncedText.trim() === committed.q.trim()) return;
    router.setParams(toParams({ ...committed, q: debouncedText }));
  }, [debouncedText, committed, router]);

  const query: ProductQuery = useMemo(
    () => ({ ...committed, q: debouncedText }),
    [committed, debouncedText],
  );

  const facets = useFacets(query.category);

  const term = query.q.trim();
  const tooShort = term.length > 0 && term.length < MIN_QUERY_LENGTH;
  // A bare search screen with no term and no filters has nothing to ask
  // the server for; it shows category browsing instead of empty results.
  const idle = term.length === 0 && !hasAnyNarrowing({ ...query, q: "" });

  const feed = useProductFeed(query, !idle && !tooShort);
  const { products, total } = flattenFeed(feed.data?.pages);

  const update = useCallback(
    (next: ProductQuery) => {
      setText(next.q);
      router.setParams(toParams(next));
    },
    [router],
  );

  const settling =
    text.trim() !== term || (feed.isFetching && feed.isPlaceholderData);

  return (
    <Screen padded={false} edges={["top"]}>
      <View className="flex-row items-center gap-2 px-4 pb-3">
        <View className="flex-1 flex-row items-center rounded-full bg-white px-4 py-1">
          <Text className="mr-2 shrink-0 text-base text-inkdeep/40">⌕</Text>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder="Search snacks, drinks, essentials"
            placeholderTextColor={theme.textFaint}
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            // NOT `clearButtonMode`: that is iOS-only, so it produced TWO
            // clear controls on iOS and one on Android. The custom control
            // below is used on both, and carries a real accessibilityLabel
            // which the native one does not let us set.
            accessibilityLabel="Search products"
            accessibilityHint="Results update as you type"
            testID="search-input"
            className="min-h-[44px] flex-1 text-base text-inkdeep"
          />
          {text.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={12}
              onPress={() => {
                setText("");
                inputRef.current?.focus();
              }}
              testID="search-clear"
              className="pl-2"
            >
              <Text className="text-lg text-inkdeep/40">×</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel search"
          onPress={() => router.back()}
          testID="search-cancel"
          className="min-h-[44px] justify-center px-1"
        >
          <Text className="text-sm font-semibold text-brand">Cancel</Text>
        </Pressable>
      </View>

      {/* Category browsing is available from the zero state AND alongside
          results, which is what connects search to classification (§22). */}
      <View className="pb-2">
        <CategoryRail
          categories={facets.categories}
          selected={query.category}
          onSelect={(c) => update({ ...query, category: c })}
          testID="search-category-rail"
        />
      </View>

      {idle ? (
        // §23: browse-by-category, not invented "trending searches".
        <EmptyState
          title="What are you after?"
          hint="Search by product, brand or category — or pick a category above."
        />
      ) : tooShort ? (
        <EmptyState title="Keep typing" hint={`At least ${MIN_QUERY_LENGTH} characters.`} />
      ) : (
        <>
          <ResultsToolbar
            query={query}
            total={feed.isPending ? null : total}
            isSettling={settling}
            onOpenFilters={() => setFiltersOpen(true)}
            onOpenSort={() => setSortOpen(true)}
            onChange={update}
          />

          {feed.isError && products.length > 0 ? (
            <View className="mb-2 px-4">
              <StaleBanner kind="stale" onRetry={() => feed.refetch()} />
            </View>
          ) : null}

          <ProductResults
            products={products}
            isPending={feed.isPending}
            isError={feed.isError}
            isSettling={settling}
            hasNarrowing
            onRetry={() => feed.refetch()}
            onClearFilters={() => update(clearFilters(query))}
            onEndReached={() => {
              if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
            }}
            isFetchingNextPage={feed.isFetchingNextPage}
            emptyTitle={term ? `No matches for "${term}"` : "No products match"}
            emptyHint="Try a shorter word, a brand name, or remove a filter."
            bottomPadding={104}
            testID="search-results"
          />
        </>
      )}

      <CartBar />
    </Screen>
  );
}
