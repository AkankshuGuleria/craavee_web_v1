/**
 * Shared design tokens for the customer-runner Expo app.
 *
 * These values are hand-mirrored from `packages/ui/DESIGN.md` (the source of
 * truth for the Craavee design system). They are duplicated here — not
 * imported from `@craavee/ui` — because that package's components are
 * DOM/web-only (built for Next.js), and NativeWind's `tailwind.config.js`
 * cannot import TypeScript at config-load time in a way that stays stable
 * across Expo's Metro/Babel pipeline. `tailwind.config.js` in this app
 * hard-codes the same palette; keep both in sync by hand until a shared
 * cross-platform token package is worth introducing.
 *
 * Phase 2B scope: tokens only. No screens are themed beyond the placeholder
 * route shells.
 */

export const colors = {
  brand: "#178A50",
  brandDeep: "#0E2A1D",
  paper: "#F3F5EC",
  inkDeep: "#122019",
  mango: "#FF8A3D",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 16,
  lg: 24,
  full: 999,
} as const;
