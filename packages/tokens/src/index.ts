/**
 * @craavee/tokens — the single source of truth for Craavee's visual
 * language.
 *
 * WHY THIS PACKAGE EXISTS
 *
 * Before it, the brand palette was written down in three places that had
 * to be edited together and were only kept in step by hand: the CSS
 * variables in `packages/ui/src/styles/globals.css`, the JS object in
 * `apps/customer-runner/lib/theme.ts`, and again in that app's
 * `tailwind.config.js`. Both native files carried comments admitting the
 * duplication and promising to fix it "when it is worth introducing a
 * shared token package". This is that package.
 *
 * THE ONE RULE
 *
 * This file imports nothing. No React, no react-native, no `document`,
 * no Expo. It is plain data, so every surface can read it: Tailwind v4
 * CSS variables on the web, NativeWind's `tailwind.config.js` on native,
 * and a direct TypeScript import anywhere a raw value is needed (an
 * `ActivityIndicator` colour, a shadow on a native View).
 *
 * If a token cannot be expressed as data, it is not a token — it is a
 * component decision, and it belongs in `packages/ui` or in the app.
 */

// ---------------------------------------------------------------------
// COLOR
// ---------------------------------------------------------------------
// Two layers on purpose.
//
// `palette` is raw pigment and carries no meaning. `color` is the
// semantic layer, and it is the ONLY one a screen should reference — so
// that "what colour is a destructive action" has one answer, and moving
// it later is one edit rather than a search.
export const palette = {
  // Craavee green — the identity. Fresh, grocery, not corporate-teal.
  green900: "#0b2018",
  green800: "#0e2a1d",
  green700: "#116b3f",
  green600: "#178a50",
  green500: "#1fa862",
  green400: "#48c184",
  green200: "#a8e0c2",
  green100: "#e2f4ea",

  // Mango — the accent. Used sparingly: it is for attention, not decoration.
  mango600: "#e5702a",
  mango500: "#ff8a3d",
  mango300: "#ffc79b",
  mango100: "#fff1e4",

  // Paper/ink — the light surface family the customer app lives on.
  paper: "#f3f5ec",
  paperRaised: "#ffffff",
  cream: "#fff9ef",
  ink900: "#0d1712",
  ink700: "#122019",
  ink500: "#3e4f44",
  ink300: "#6b7d72",
  ink100: "#c9d2cb",

  // Slate — the dark operational family the Store and Console live on.
  // Operators stare at these screens for a whole shift; the ground is
  // near-black and low-contrast so the DATA is what glows, not the chrome.
  slate950: "#0a0c10",
  slate900: "#111419",
  slate800: "#181c23",
  slate700: "#232832",
  slate600: "#333a47",
  slate400: "#7c8798",
  slate200: "#b9c2cf",
  slate50: "#f4f6f9",

  // Status. Deliberately not the brand green: "success" and "Craavee"
  // must stay distinguishable, or a green button starts reading as a
  // confirmation message.
  success600: "#0f9d58",
  success100: "#e3f6ec",
  warning600: "#c77700",
  warning100: "#fdf0dc",
  danger600: "#d1443c",
  danger500: "#e5564d",
  danger100: "#fbe6e5",
  info600: "#2563a8",
  info100: "#e4eef9",

  white: "#ffffff",
  black: "#000000",
} as const;

/** Semantic colour, per surface family. A screen uses these names. */
export const color = {
  /** Consumer surfaces: the customer and runner apps. Light, warm. */
  consumer: {
    bg: palette.paper,
    surface: palette.paperRaised,
    surfaceAlt: palette.cream,
    border: "rgba(18, 32, 25, 0.10)",
    borderStrong: "rgba(18, 32, 25, 0.22)",
    text: palette.ink700,
    textStrong: palette.ink900,
    textMuted: palette.ink500,
    textFaint: palette.ink300,
    brand: palette.green600,
    brandStrong: palette.green800,
    brandSoft: palette.green100,
    onBrand: palette.white,
    accent: palette.mango500,
    accentSoft: palette.mango100,
    success: palette.success600,
    successSoft: palette.success100,
    warning: palette.warning600,
    warningSoft: palette.warning100,
    danger: palette.danger600,
    dangerSoft: palette.danger100,
    info: palette.info600,
    infoSoft: palette.info100,
    /** Skeletons and disabled fills. */
    skeleton: "rgba(18, 32, 25, 0.07)",
    overlay: "rgba(13, 23, 18, 0.45)",
  },

  /** Operational surfaces: Store and Console. Dark, calm, data-forward. */
  ops: {
    bg: palette.slate950,
    surface: palette.slate900,
    surfaceAlt: palette.slate800,
    border: "rgba(255, 255, 255, 0.08)",
    borderStrong: "rgba(255, 255, 255, 0.16)",
    text: palette.slate50,
    textStrong: palette.white,
    textMuted: palette.slate400,
    textFaint: palette.slate600,
    brand: palette.green500,
    brandStrong: palette.green400,
    brandSoft: "rgba(31, 168, 98, 0.14)",
    onBrand: palette.white,
    accent: palette.mango500,
    accentSoft: "rgba(255, 138, 61, 0.14)",
    success: "#34d399",
    successSoft: "rgba(52, 211, 153, 0.14)",
    warning: "#fbbf24",
    warningSoft: "rgba(251, 191, 36, 0.14)",
    danger: palette.danger500,
    dangerSoft: "rgba(229, 86, 77, 0.16)",
    info: "#60a5fa",
    infoSoft: "rgba(96, 165, 250, 0.14)",
    skeleton: "rgba(255, 255, 255, 0.06)",
    overlay: "rgba(5, 7, 10, 0.66)",
  },
} as const;

// ---------------------------------------------------------------------
// SPACING — a 4pt grid. Every gap in the product is one of these.
// ---------------------------------------------------------------------
export const space = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
  "4xl": 56,
} as const;

// ---------------------------------------------------------------------
// RADIUS
// ---------------------------------------------------------------------
// The audit found twelve radius values in use across three vocabularies
// (`rounded-xl`, `rounded-cravee`, `rounded-[24px]`). Six, named once.
export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
} as const;

// ---------------------------------------------------------------------
// TYPOGRAPHY
// ---------------------------------------------------------------------
// A named scale rather than ad-hoc sizes. `numeric` exists because money
// is the thing this product is judged on: it is tabular so digits do not
// jitter as an order total updates.
export const font = {
  family: {
    display: '"Outfit", "Cabinet Grotesk", system-ui, sans-serif',
    body: '"Geist", "Satoshi", system-ui, sans-serif',
    mono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
  },
  size: {
    display: 34,
    heading: 26,
    title: 20,
    subtitle: 17,
    body: 15,
    label: 13,
    caption: 11,
  },
  lineHeight: {
    display: 40,
    heading: 32,
    title: 26,
    subtitle: 23,
    body: 21,
    label: 18,
    caption: 15,
  },
  weight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    black: "800",
  },
  /** Money and counts. Tabular figures, never proportional. */
  numeric: {
    fontVariantNumeric: "tabular-nums",
    letterSpacing: 0,
  },
} as const;

// ---------------------------------------------------------------------
// ELEVATION
// ---------------------------------------------------------------------
// Four steps. A fifth would only be used because it exists.
export const elevation = {
  none: { web: "none", nativeOpacity: 0, nativeRadius: 0, nativeOffsetY: 0 },
  sm: { web: "0 1px 2px rgba(13,23,18,0.06)", nativeOpacity: 0.06, nativeRadius: 2, nativeOffsetY: 1 },
  md: { web: "0 4px 12px rgba(13,23,18,0.08)", nativeOpacity: 0.08, nativeRadius: 12, nativeOffsetY: 4 },
  lg: { web: "0 12px 28px rgba(13,23,18,0.12)", nativeOpacity: 0.12, nativeRadius: 24, nativeOffsetY: 12 },
} as const;

// ---------------------------------------------------------------------
// MOTION
// ---------------------------------------------------------------------
// Short, and fewer options than feel natural to define. Motion here is
// for continuity and feedback, not personality: a delivery app is used
// standing up, one-handed, in a hurry.
//
// `instant` is not zero by accident — it is the duration everything
// collapses to under reduced motion, so a transition still *completes*
// deterministically rather than being skipped mid-flight.
export const motion = {
  duration: {
    instant: 1,
    fast: 120,
    normal: 200,
    slow: 320,
  },
  easing: {
    /** Entering the screen: decelerate into place. */
    enter: "cubic-bezier(0.16, 1, 0.3, 1)",
    /** Leaving: accelerate away, shorter than entering. */
    exit: "cubic-bezier(0.4, 0, 1, 1)",
    /** Moving between two on-screen states. */
    move: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  spring: {
    /** Pressable feedback. Tight, barely perceptible, never bouncy. */
    press: { damping: 26, stiffness: 420, mass: 0.6 },
    /** Sheets and modals. */
    sheet: { damping: 30, stiffness: 260, mass: 0.9 },
  },
  /** How far a pressable scales on press. Subtle on purpose. */
  pressScale: 0.97,
} as const;

// ---------------------------------------------------------------------
// OPACITY · ICONS · TOUCH TARGETS
// ---------------------------------------------------------------------
export const opacity = {
  disabled: 0.4,
  muted: 0.6,
  pressed: 0.85,
  scrim: 0.45,
} as const;

export const iconSize = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

/**
 * 44 is not a style choice. It is the minimum comfortable touch target on
 * both platforms (Apple HIG 44pt, Material 48dp), and the Phase 10 audit
 * flagged several text-only controls well below it. `min` is the floor
 * for anything tappable; `comfortable` is the default for primary actions.
 */
export const touchTarget = {
  min: 44,
  comfortable: 48,
  large: 56,
} as const;

// ---------------------------------------------------------------------
// BREAKPOINTS — web only; native uses flex, not breakpoints.
// ---------------------------------------------------------------------
export const breakpoint = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

/** Ops tables need room; consumer reading columns must not sprawl. */
export const contentWidth = {
  reading: 680,
  app: 960,
  ops: 1400,
} as const;

export type Surface = keyof typeof color;
export type SemanticColor = keyof typeof color.consumer;
