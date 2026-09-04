/**
 * Emits the tokens as CSS custom properties for the web apps.
 *
 * Written as a generator rather than a hand-maintained .css file so the
 * CSS cannot drift from `./index.ts` — which is precisely how
 * `packages/ui/src/styles/globals.css` ended up carrying two unrelated
 * token vocabularies at once.
 */
import { color, space, radius, font, elevation, motion, opacity, iconSize, touchTarget } from "./index.ts";

function block(prefix: string, o: Record<string, string | number>, unit = ""): string {
  return Object.entries(o)
    .map(([k, v]) => `  --${prefix}-${k}: ${typeof v === "number" && unit ? `${v}${unit}` : v};`)
    .join("\n");
}

/** `:root` variables for a surface family. */
export function cssVariables(surface: "consumer" | "ops"): string {
  const c = color[surface];
  return [
    block("color", c as unknown as Record<string, string>),
    block("space", space as unknown as Record<string, number>, "px"),
    block("radius", radius as unknown as Record<string, number>, "px"),
    block("font", font.family),
    block("text", font.size as unknown as Record<string, number>, "px"),
    block("leading", font.lineHeight as unknown as Record<string, number>, "px"),
    block("shadow", Object.fromEntries(Object.entries(elevation).map(([k, v]) => [k, v.web]))),
    block("duration", motion.duration as unknown as Record<string, number>, "ms"),
    block("ease", motion.easing),
    block("opacity", opacity as unknown as Record<string, number>),
    block("icon", iconSize as unknown as Record<string, number>, "px"),
    block("touch", touchTarget as unknown as Record<string, number>, "px"),
  ].join("\n");
}
