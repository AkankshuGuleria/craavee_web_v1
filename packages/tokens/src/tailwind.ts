/**
 * Tailwind theme built FROM the tokens, for both the web apps and
 * NativeWind. Nothing here invents a value; it only reshapes
 * `./index.ts` into the object Tailwind expects.
 *
 * This is the seam that stops the old drift: `tailwind.config.js` used to
 * hard-code five hex values that a human had to keep in step with
 * `theme.ts`. Now it imports.
 */
import { color, space, radius, font, elevation, opacity, iconSize, touchTarget, breakpoint, contentWidth } from "./index.ts";

const px = (n: number) => `${n}px`;
const mapPx = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, px(v)]));

/** `surface` picks which semantic family the app is themed with. */
export function craaveeTheme(surface: "consumer" | "ops" = "consumer") {
  const c = color[surface];
  return {
    colors: {
      bg: c.bg,
      surface: c.surface,
      "surface-alt": c.surfaceAlt,
      border: c.border,
      "border-strong": c.borderStrong,
      text: c.text,
      "text-strong": c.textStrong,
      "text-muted": c.textMuted,
      "text-faint": c.textFaint,
      brand: c.brand,
      "brand-strong": c.brandStrong,
      "brand-soft": c.brandSoft,
      "on-brand": c.onBrand,
      accent: c.accent,
      "accent-soft": c.accentSoft,
      success: c.success,
      "success-soft": c.successSoft,
      warning: c.warning,
      "warning-soft": c.warningSoft,
      danger: c.danger,
      "danger-soft": c.dangerSoft,
      info: c.info,
      "info-soft": c.infoSoft,
      skeleton: c.skeleton,
      overlay: c.overlay,
    },
    spacing: mapPx(space as unknown as Record<string, number>),
    borderRadius: mapPx(radius as unknown as Record<string, number>),
    fontFamily: {
      display: [font.family.display],
      body: [font.family.body],
      mono: [font.family.mono],
    },
    fontSize: Object.fromEntries(
      Object.entries(font.size).map(([k, v]) => [
        k,
        [px(v), { lineHeight: px(font.lineHeight[k as keyof typeof font.lineHeight]) }],
      ]),
    ),
    fontWeight: font.weight,
    boxShadow: Object.fromEntries(Object.entries(elevation).map(([k, v]) => [k, v.web])),
    opacity: Object.fromEntries(Object.entries(opacity).map(([k, v]) => [k, String(v)])),
    screens: mapPx(breakpoint as unknown as Record<string, number>),
    maxWidth: mapPx(contentWidth as unknown as Record<string, number>),
    minHeight: mapPx(touchTarget as unknown as Record<string, number>),
    minWidth: mapPx(touchTarget as unknown as Record<string, number>),
    size: mapPx(iconSize as unknown as Record<string, number>),
  };
}
