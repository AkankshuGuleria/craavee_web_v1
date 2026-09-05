/**
 * Category navigation.
 *
 * A horizontal rail of text pills, not a grid of coloured tiles with
 * illustrations. Three reasons, in order of weight:
 *
 *   1. There are 8 real categories. A grid of 8 large tiles pushes every
 *      product below the fold, so the customer's first screen would be
 *      navigation furniture instead of things to buy.
 *   2. There is no category artwork in the data. A tile grid would need
 *      an image per category, and the only honest way to fill it is to
 *      invent one — which the brief forbids and which would look
 *      obviously placeholder anyway.
 *   3. A rail keeps switching category cheap. It sits above the results
 *      and stays put, so narrowing is one tap and reversing it is one
 *      tap, rather than a navigation round trip.
 *
 * "All" is a first-class option rather than a separate reset control,
 * because clearing a category IS choosing a category — modelling it as
 * one thing means the selected state is always visible and never
 * ambiguous.
 */
import { Pressable, ScrollView, Text, View } from "react-native";

import { haptic } from "../../lib/haptics";

export function CategoryRail({
  categories,
  selected,
  onSelect,
  testID,
}: {
  categories: string[];
  selected: string | null;
  onSelect: (category: string | null) => void;
  testID?: string;
}) {
  if (categories.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      // The rail is a set of related controls; announcing it as one group
      // stops a screen reader treating each pill as an unrelated button.
      accessibilityRole="tablist"
      accessibilityLabel="Product categories"
      testID={testID}
    >
      <Pill
        label="All"
        active={selected === null}
        onPress={() => onSelect(null)}
        testID="category-all"
      />
      {categories.map((c) => (
        <Pill
          key={c}
          label={c}
          active={selected === c}
          onPress={() => onSelect(c)}
          testID={`category-${c}`}
        />
      ))}
    </ScrollView>
  );
}

function Pill({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={() => {
        // A discrete selection - exactly what the haptics rules reserve
        // `selection` for, and not fired on every filter toggle.
        haptic("selection");
        onPress();
      }}
      testID={testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      // min-h-[40] plus the row's own padding clears 44pt of touchable
      // height without making the rail visually chunky.
      className={`min-h-[40px] justify-center rounded-full px-4 ${
        active ? "bg-brand" : "border border-inkdeep/10 bg-white"
      }`}
    >
      <Text
        // Selected state is carried by weight AND fill, not colour alone.
        className={`text-sm ${active ? "font-bold text-white" : "font-medium text-inkdeep/70"}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
