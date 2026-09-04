/**
 * Native access to the design tokens.
 *
 * This file used to be a hand-mirrored copy of the palette, with a
 * comment promising to replace it "until a shared cross-platform token
 * package is worth introducing". @craavee/tokens is that package, so this
 * is now a thin re-export plus the few native-only helpers that cannot be
 * expressed as plain data.
 *
 * Prefer Tailwind classes in components. Reach for these values only
 * where a raw one is genuinely required — an `ActivityIndicator` colour,
 * a shadow on a `View`, an interpolation input.
 */
import {
  color, space, radius, font, elevation, motion, opacity, iconSize, touchTarget,
} from "@craavee/tokens";

/** The customer and runner apps are consumer surfaces. */
export const theme = color.consumer;

export { space, radius, font, motion, opacity, iconSize, touchTarget };

/** Legacy aliases, kept so existing screens keep compiling. */
export const colors = {
  brand: theme.brand,
  brandDeep: theme.brandStrong,
  paper: theme.bg,
  inkDeep: theme.text,
  mango: theme.accent,
} as const;

/** React Native shadows are four props, not one string. */
export function shadow(level: keyof typeof elevation) {
  const e = elevation[level];
  return {
    shadowColor: "#0d1712",
    shadowOpacity: e.nativeOpacity,
    shadowRadius: e.nativeRadius,
    shadowOffset: { width: 0, height: e.nativeOffsetY },
    elevation: level === "none" ? 0 : e.nativeRadius / 2,
  };
}
