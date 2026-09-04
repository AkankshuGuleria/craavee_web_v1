/**
 * Money, rendered correctly on Android.
 *
 * This component exists because of a real, reproducible rendering bug,
 * not for tidiness. On a physical vivo V2250 (Android 15, font_scale 1.0)
 * a `<Text>` carrying `textDecorationLine: "line-through"` DROPS ITS
 * FINAL GLYPH: a ₹30.00 MRP renders "₹30.0", with the strike-through
 * line still drawn to the full measured width. On the screen where a
 * customer decides whether to buy, the struck price is money, and money
 * that renders wrong is not a cosmetic defect.
 *
 * Four fixes were tried on the device and did NOT work, recorded so
 * nobody repeats them:
 *
 *   1. `shrink-0` on the Text                     - no effect
 *   2. padding on the Text (class AND inline)     - gap widened, glyph
 *                                                   still missing
 *   3. an outer View owning the padding           - no effect
 *   4. `items-end` instead of `items-baseline`    - no effect
 *
 * What works is giving Android a throwaway final character: a trailing
 * thin space (U+2009) is what gets dropped, so the last real digit
 * survives. It is invisible, it is inside the Text where the decoration
 * is measured, and it costs nothing.
 *
 * The bug is size-dependent - the same decoration at 11px renders fine -
 * which is exactly why this must not be left to each call site to
 * rediscover at whatever size it happens to use.
 *
 * Not confirmed on stock Android. The app loads no custom font, so it
 * renders in vivo's OEM system font; the workaround is harmless
 * everywhere regardless.
 */
import { Text, View } from "react-native";

import { rupees } from "../../lib/format";

/** U+2009 THIN SPACE - the character Android is allowed to drop. */
const SACRIFICIAL = " ";

export function StruckPrice({
  amount,
  className = "text-sm text-inkdeep/40",
}: {
  amount: number;
  className?: string;
}) {
  return (
    <Text className={`shrink-0 line-through ${className}`}>
      {rupees(amount)}
      {SACRIFICIAL}
    </Text>
  );
}

/**
 * A sale price with its struck original beside it.
 *
 * `size` maps to the two places this appears: a grid tile, and the
 * product-detail hero.
 */
export function Price({
  salePrice,
  mrp,
  size = "sm",
  testID,
}: {
  salePrice: number;
  mrp: number;
  size?: "sm" | "lg";
  testID?: string;
}) {
  const discounted = salePrice < mrp;
  const big = size === "lg";

  return (
    <View className="flex-row items-baseline" testID={testID}>
      <Text
        className={`shrink-0 pr-2 font-bold text-brand-deep ${big ? "text-3xl" : "text-base"}`}
      >
        {rupees(salePrice)}
      </Text>
      {discounted ? (
        <StruckPrice amount={mrp} className={big ? "text-sm text-inkdeep/40" : "text-[11px] text-inkdeep/40"} />
      ) : null}
    </View>
  );
}
