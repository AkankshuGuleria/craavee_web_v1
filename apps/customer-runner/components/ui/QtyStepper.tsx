/**
 * The one quantity control. Catalog tile, product detail, cart - all
 * three render this, because three visually different steppers for one
 * concept is exactly the "MVP" tell this slice is meant to remove.
 *
 * Two sizes, one behaviour. `sm` fits a grid tile; `md` is for the
 * product detail and the cart row where there is room to be generous.
 *
 * Accessibility notes that are easy to get wrong here:
 *   * Each control is a real button with its own label naming the
 *     product, because "minus" alone is meaningless in a screen-reader's
 *     linear read of a grid.
 *   * The count is announced via `accessibilityValue` on the group, so
 *     the number is not read as a stray free-floating "1".
 *   * Both controls keep a >=44pt target through `hitSlop` even at `sm`,
 *     where the drawn circle is smaller than the touchable area.
 *
 * Haptics follow the house rule: `selection` on an ordinary step (a
 * discrete selection), `warning` when a decrement is about to remove the
 * line entirely - a small physical "are you sure" for a destructive edge.
 */
import { Pressable, Text, View } from "react-native";

import { haptic } from "../../lib/haptics";
import { theme, font } from "../../lib/theme";

export function QtyStepper({
  qty,
  productName,
  onIncrement,
  onDecrement,
  size = "sm",
  testIDPrefix,
}: {
  qty: number;
  productName: string;
  onIncrement: () => void;
  onDecrement: () => void;
  size?: "sm" | "md";
  testIDPrefix?: string;
}) {
  const big = size === "md";
  const box = big ? 36 : 28;
  const glyph = big ? 22 : 18;

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={`Quantity of ${productName}`}
      accessibilityValue={{ now: qty, text: `${qty}` }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        borderRadius: 999,
        backgroundColor: theme.brandSoft,
        paddingHorizontal: 4,
        paddingVertical: 3,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          qty === 1 ? `Remove ${productName} from cart` : `Decrease ${productName}`
        }
        hitSlop={12}
        onPress={() => {
          haptic(qty === 1 ? "warning" : "selection");
          onDecrement();
        }}
        testID={testIDPrefix ? `${testIDPrefix}-dec` : undefined}
        style={({ pressed }) => ({
          width: box,
          height: box,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Text style={{ fontSize: glyph, lineHeight: glyph + 4, color: theme.brand, fontWeight: font.weight.bold }}>
          −
        </Text>
      </Pressable>

      <Text
        // `tabular-nums` keeps the pill from twitching as the number
        // changes width between 1 and 2 digits.
        style={{
          minWidth: big ? 28 : 22,
          textAlign: "center",
          fontSize: big ? font.size.subtitle : font.size.label,
          fontWeight: font.weight.bold,
          color: theme.textStrong,
          fontVariant: ["tabular-nums"],
        }}
      >
        {qty}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${productName}`}
        hitSlop={12}
        onPress={() => {
          haptic("selection");
          onIncrement();
        }}
        testID={testIDPrefix ? `${testIDPrefix}-inc` : undefined}
        style={({ pressed }) => ({
          width: box,
          height: box,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Text style={{ fontSize: glyph, lineHeight: glyph + 4, color: theme.brand, fontWeight: font.weight.bold }}>
          +
        </Text>
      </Pressable>
    </View>
  );
}
