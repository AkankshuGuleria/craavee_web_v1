/**
 * Filter and sort, as bottom-anchored sheets.
 *
 * WHY React Native's `Modal` and not `@gorhom/bottom-sheet`, which is a
 * declared dependency: adopting it means wiring `GestureHandlerRootView`
 * and the gesture handler into the root layout, which is a native
 * integration change affecting every screen, and its web story is the
 * weakest of the three platforms this slice must ship on. `Modal` is
 * already proven here, behaves natively on iOS and Android, works on web,
 * and needs no new wiring. That is a deliberate call, not an oversight -
 * a gesture-driven sheet is a worthwhile future change on its own merits,
 * not a dependency this feature should take on.
 *
 * The sheet holds DRAFT state and only commits on Apply. Live-applying
 * every toggle would fire a request per tap and make it impossible to
 * build up a multi-part filter without watching the list thrash. Cancel
 * therefore genuinely discards, which is what a customer expects from a
 * sheet with an Apply button.
 */
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import {
  SORT_OPTIONS,
  activeFilterCount,
  clearFilters,
  type ProductQuery,
  type SortKey,
} from "../../lib/discovery/query";
import { haptic } from "../../lib/haptics";
import { rupees } from "../../lib/format";

// ---------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------

function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testID?: string;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // Android's hardware back closes it via onRequestClose; iOS and web
      // get the scrim below.
      accessibilityViewIsModal
      testID={testID}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable
          className="flex-1"
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          testID="sheet-scrim"
        />
        <View className="max-h-[80%] rounded-t-3xl bg-paper pb-8">
          <View className="flex-row items-center justify-between px-5 pb-3 pt-5">
            <Text
              accessibilityRole="header"
              className="text-lg font-bold text-inkdeep"
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              onPress={onClose}
              testID="sheet-close"
              className="min-h-[44px] min-w-[44px] items-end justify-center"
            >
              <Text className="text-xl text-inkdeep/40">×</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            {children}
          </ScrollView>

          {footer ? <View className="px-5 pt-3">{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------

/**
 * Price presets rather than a slider.
 *
 * A two-thumb slider is fiddly one-handed, hard to make accessible, and
 * needs gesture wiring. Buckets derived from the catalogue's actual
 * range are one tap, screen-reader friendly by construction, and honest -
 * they cannot suggest a range the catalogue does not contain.
 */
function priceBuckets(floor: number, ceiling: number): { label: string; min: number | null; max: number | null }[] {
  if (ceiling <= floor) return [];
  const span = ceiling - floor;
  const a = Math.round(floor + span / 3);
  const b = Math.round(floor + (span * 2) / 3);
  return [
    { label: `Under ${rupees(a * 100)}`, min: null, max: a },
    { label: `${rupees(a * 100)}–${rupees(b * 100)}`, min: a, max: b },
    { label: `Over ${rupees(b * 100)}`, min: b, max: null },
  ];
}

interface FilterSheetProps {
  visible: boolean;
  query: ProductQuery;
  brands: string[];
  priceFloor: number;
  priceCeiling: number;
  onClose: () => void;
  onApply: (next: ProductQuery) => void;
}

/**
 * The draft state deliberately lives in the BODY, which is mounted only
 * while the sheet is open. Mounting is what seeds the draft from the
 * committed query, and unmounting is what discards a cancelled edit.
 *
 * The obvious alternative - one component with `useEffect(() => setDraft(
 * query), [visible])` - is the "you might not need an effect" pattern and
 * the React Compiler rejects it outright. Letting the lifecycle do the
 * reset is both simpler and correct, rather than suppressing the rule.
 */
export function FilterSheet(props: FilterSheetProps) {
  if (!props.visible) return null;
  return <FilterSheetBody {...props} />;
}

function FilterSheetBody({
  visible,
  query,
  brands,
  priceFloor,
  priceCeiling,
  onClose,
  onApply,
}: FilterSheetProps) {
  const [draft, setDraft] = useState<ProductQuery>(query);

  const buckets = priceBuckets(priceFloor, priceCeiling);
  const count = activeFilterCount(draft);

  const toggleBrand = (b: string) =>
    setDraft((d) => ({
      ...d,
      brands: d.brands.includes(b) ? d.brands.filter((x) => x !== b) : [...d.brands, b],
    }));

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter" testID="filter-sheet"
      footer={
        <View className="flex-row items-center gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            onPress={() => {
              haptic("selection");
              // Keeps q / category / sort - clearing filters should widen
              // the results, not evict the customer from the aisle.
              setDraft((d) => clearFilters(d));
            }}
            testID="filter-clear"
            className="min-h-[52px] flex-1 items-center justify-center rounded-2xl border border-inkdeep/15"
          >
            <Text className="text-sm font-semibold text-inkdeep/70">Clear all</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={count > 0 ? `Apply ${count} filters` : "Apply"}
            onPress={() => {
              // A committed change the customer chose - the one place in
              // this feature that earns a success haptic. Individual
              // toggles get `selection`, not this.
              haptic("success");
              onApply(draft);
            }}
            testID="filter-apply"
            className="min-h-[52px] flex-[1.4] items-center justify-center rounded-2xl bg-brand"
          >
            <Text className="text-sm font-bold text-white">
              {count > 0 ? `Apply · ${count}` : "Apply"}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Group label="Availability">
        <Toggle
          label="In stock only"
          selected={draft.inStockOnly}
          onPress={() => setDraft((d) => ({ ...d, inStockOnly: !d.inStockOnly }))}
          testID="filter-instock"
        />
      </Group>

      {buckets.length > 0 ? (
        <Group label="Price">
          <View className="flex-row flex-wrap gap-2">
            {buckets.map((b) => {
              const selected = draft.minPrice === b.min && draft.maxPrice === b.max;
              return (
                <Toggle
                  key={b.label}
                  label={b.label}
                  selected={selected}
                  onPress={() =>
                    setDraft((d) =>
                      selected
                        ? { ...d, minPrice: null, maxPrice: null }
                        : { ...d, minPrice: b.min, maxPrice: b.max },
                    )
                  }
                  testID={`filter-price-${b.label}`}
                />
              );
            })}
          </View>
        </Group>
      ) : null}

      {brands.length > 0 ? (
        <Group label="Brand">
          <View className="flex-row flex-wrap gap-2">
            {brands.map((b) => (
              <Toggle
                key={b}
                label={b}
                selected={draft.brands.includes(b)}
                onPress={() => toggleBrand(b)}
                testID={`filter-brand-${b}`}
              />
            ))}
          </View>
        </Group>
      ) : null}

      {/*
        NO "Discount" filter. Every product in the catalogue currently has
        sale_price < mrp, so the control would match everything and filter
        nothing - a control that appears to work and does not is worse
        than an absent one. It becomes real if undiscounted products ever
        exist. See the checkpoint's data audit.
      */}
    </Sheet>
  );
}

// ---------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------

export function SortSheet({
  visible,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: SortKey;
  onClose: () => void;
  onSelect: (key: SortKey) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Sort by" testID="sort-sheet">
      <View className="gap-1 pb-2">
        {SORT_OPTIONS.map((o) => {
          const selected = o.key === value;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={o.label}
              onPress={() => {
                haptic("selection");
                onSelect(o.key);
              }}
              testID={`sort-${o.key}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              className="min-h-[52px] flex-row items-center justify-between rounded-xl px-1"
            >
              <Text
                className={`text-base ${selected ? "font-bold text-brand-deep" : "text-inkdeep/80"}`}
              >
                {o.label}
              </Text>
              {/* A tick, not just colour - selection must survive a
                  colour-blind reading. */}
              {selected ? <Text className="text-base font-bold text-brand">✓</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="pb-5">
      <Text className="pb-2 text-xs font-bold uppercase tracking-wider text-inkdeep/45">
        {label}
      </Text>
      {children}
    </View>
  );
}

function Toggle({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      testID={testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      className={`min-h-[44px] justify-center rounded-full border px-4 ${
        selected ? "border-brand bg-brand/10" : "border-inkdeep/15 bg-white"
      }`}
    >
      <Text
        className={`text-sm ${selected ? "font-bold text-brand-deep" : "font-medium text-inkdeep/70"}`}
      >
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}
