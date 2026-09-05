/**
 * Search.
 *
 * The whole screen is built around one goal: the customer should feel
 * that results are already there, not that they submitted a request and
 * waited. Three things do that work, none of them animation:
 *
 *   * `keepPreviousData` - the previous term's results stay on screen
 *     while the next term is in flight, dimmed rather than blanked.
 *   * a 5-minute cache - retyping a recent term costs no request at all.
 *   * 300ms debounce - a typed word is one request, not five.
 *
 * The states below are exhaustive on purpose. Every one of them has a way
 * out; none is a dead end.
 */
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { EmptyState, ErrorState, Screen, SkeletonList, StaleBanner } from "../../components/ui";
import { ProductCard } from "../../components/catalog/ProductCard";
import { cartCount } from "../../lib/cart/logic.ts";
import { useCartStore } from "../../lib/cart/store";
import { useDebounced } from "../../lib/useDebounced";
import { MIN_QUERY_LENGTH, useProductSearch } from "../../hooks/useProductSearch";
import { theme } from "../../lib/theme";

export default function SearchScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const debounced = useDebounced(text, 300);
  const inputRef = useRef<TextInput>(null);

  const results = useProductSearch(debounced);

  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const count = cartCount(items);

  const trimmed = debounced.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;
  const idle = trimmed.length === 0;

  // The user has typed ahead of the debounce, or a new term is loading
  // over an old one. Both mean "what you are looking at is not the answer
  // to what you have typed" - shown as a dim, not a spinner.
  const settling = text.trim() !== trimmed || (results.isFetching && results.isPlaceholderData);

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
            // clear controls on iOS (the native grey circle plus ours) and
            // one on Android. The custom control below is used on both, so
            // the affordance is single and identical - and it carries a real
            // accessibilityLabel, which the native one does not let us set.
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

      {idle ? (
        <EmptyState
          title="What are you after?"
          hint="Search by product, brand or category — milk, Amul, snacks."
        />
      ) : tooShort ? (
        <EmptyState title="Keep typing" hint={`At least ${MIN_QUERY_LENGTH} characters.`} />
      ) : results.isPending ? (
        <View className="px-4">
          <SkeletonList rows={4} />
        </View>
      ) : results.isError && !results.data ? (
        <ErrorState
          title="Couldn't run that search"
          detail="Check your connection and try again."
          onRetry={() => results.refetch()}
        />
      ) : results.data && results.data.length === 0 ? (
        <EmptyState
          title={`No matches for "${trimmed}"`}
          hint="Try a shorter word, or a brand name."
        />
      ) : (
        <View className="flex-1" style={{ opacity: settling ? 0.55 : 1 }}>
          {/* Results present but the last refresh failed: the list is real
              but no longer known to be current. Never presented as fresh. */}
          {results.isError ? (
            <View className="mb-2 px-4">
              <StaleBanner kind="stale" onRetry={() => results.refetch()} />
            </View>
          ) : null}

          <FlashList
            data={results.data}
            numColumns={2}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <View className={index % 2 === 0 ? "pr-2" : "pl-2"}>
                <ProductCard
                  product={item}
                  qtyInCart={items[item.id] ?? 0}
                  onAdd={add}
                  onIncrement={increment}
                  onDecrement={decrement}
                />
              </View>
            )}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: count > 0 ? 96 : 24 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            testID="search-results"
          />
        </View>
      )}
    </Screen>
  );
}
