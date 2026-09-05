/**
 * The control strip above a set of results: how many there are, how to
 * narrow them, how to order them, and what is currently applied.
 *
 * The result count is not decoration. It is the feedback that makes
 * filtering feel like a conversation rather than a guess - a customer who
 * removes a brand and watches 4 become 11 understands what the control
 * did without opening anything.
 *
 * Active filters appear as removable chips beneath the buttons rather
 * than only as a badge. A badge tells you THAT you filtered; a chip tells
 * you WHAT you filtered and lets you undo exactly that one thing, which
 * is the difference between narrowing confidently and being stuck.
 */
import { Pressable, ScrollView, Text, View } from "react-native";

import { activeFilterCount, SORT_OPTIONS, type ProductQuery } from "../../lib/discovery/query";
import { rupees } from "../../lib/format";
import { haptic } from "../../lib/haptics";

export function ResultsToolbar({
  query,
  total,
  isSettling,
  onOpenFilters,
  onOpenSort,
  onChange,
}: {
  query: ProductQuery;
  total: number | null;
  /** Results on screen are not yet the answer to the current query. */
  isSettling: boolean;
  onOpenFilters: () => void;
  onOpenSort: () => void;
  onChange: (next: ProductQuery) => void;
}) {
  const filterCount = activeFilterCount(query);
  const sortLabel = SORT_OPTIONS.find((o) => o.key === query.sort)?.label ?? "Featured";

  const chips: { key: string; label: string; clear: () => void }[] = [];

  for (const brand of query.brands) {
    chips.push({
      key: `brand:${brand}`,
      label: brand,
      clear: () => onChange({ ...query, brands: query.brands.filter((b) => b !== brand) }),
    });
  }
  if (query.minPrice !== null || query.maxPrice !== null) {
    const lo = query.minPrice !== null ? rupees(query.minPrice * 100) : null;
    const hi = query.maxPrice !== null ? rupees(query.maxPrice * 100) : null;
    chips.push({
      key: "price",
      label: lo && hi ? `${lo}–${hi}` : lo ? `Over ${lo}` : `Under ${hi}`,
      clear: () => onChange({ ...query, minPrice: null, maxPrice: null }),
    });
  }
  if (query.inStockOnly) {
    chips.push({
      key: "stock",
      label: "In stock",
      clear: () => onChange({ ...query, inStockOnly: false }),
    });
  }

  return (
    <View>
      <View className="flex-row items-center gap-2 px-4 pb-2">
        <Control
          label={filterCount > 0 ? `Filter · ${filterCount}` : "Filter"}
          active={filterCount > 0}
          onPress={onOpenFilters}
          testID="open-filters"
          accessibilityLabel={
            filterCount > 0 ? `Filter, ${filterCount} applied` : "Filter results"
          }
        />
        <Control
          label={sortLabel}
          active={query.sort !== "featured"}
          onPress={onOpenSort}
          testID="open-sort"
          accessibilityLabel={`Sort, currently ${sortLabel}`}
        />

        <View className="flex-1" />

        {total !== null ? (
          <Text
            // Announced politely so a screen-reader user hears the count
            // change after applying a filter, rather than having to hunt
            // for it.
            accessibilityLiveRegion="polite"
            className="shrink-0 pr-1 text-xs text-inkdeep/50"
            testID="result-count"
          >
            {isSettling ? "…" : `${total} ${total === 1 ? "item" : "items"}`}
          </Text>
        ) : null}
      </View>

      {chips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}
        >
          {chips.map((chip) => (
            <Pressable
              key={chip.key}
              accessibilityRole="button"
              accessibilityLabel={`Remove filter ${chip.label}`}
              hitSlop={8}
              onPress={() => {
                haptic("selection");
                chip.clear();
              }}
              testID={`chip-${chip.key}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              className="min-h-[32px] flex-row items-center gap-1 rounded-full bg-brand/10 px-3"
            >
              <Text className="text-xs font-semibold text-brand-deep">{chip.label}</Text>
              <Text className="text-sm text-brand-deep/60">×</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Control({
  label,
  active,
  onPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      className={`min-h-[36px] shrink-0 justify-center rounded-full border px-4 ${
        active ? "border-brand bg-brand/10" : "border-inkdeep/15 bg-white"
      }`}
    >
      <Text
        className={`text-sm font-semibold ${active ? "text-brand-deep" : "text-inkdeep/70"}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
