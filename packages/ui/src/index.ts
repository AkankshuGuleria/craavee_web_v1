// @craavee/ui — shared design system, ported from the original
// craavee_web_v1 prototype (docs/audit/PHASE_0_REPOSITORY_AUDIT.md
// found this to be genuine, reusable front-end craft; DEPLOYMENT_
// TOPOLOGY.md §2 and the Phase 2B move plan carried it forward as-is,
// no visual rework). Every export below is domain-free — nothing here
// imports old fake auth/cart state or the retired product/venue types.
// Consuming apps (apps/store, apps/console) import from this package
// rather than re-implementing these primitives.

export { cn } from "./lib/utils";
export { useMotionReduced, setMotionOverride } from "./hooks/use-motion-preference";
export type { MotionPreference } from "./hooks/use-motion-preference";

export {
  CursorGlow,
  Magnetic,
  TiltCard,
  Reveal,
  StickyStack,
  SpotlightCard,
  useMouseParallax,
  ScrollProgress,
  useFloat,
} from "./components/interactive";
export { Footer } from "./components/Footer";
export { OpsShell } from "./components/OpsShell";
export type { OpsShellProps, OpsNavItem } from "./components/OpsShell";

export { Button, buttonVariants } from "./components/ui/button";
export { Card, CardHeader, CardContent, CardFooter } from "./components/ui/card";
export { Input } from "./components/ui/input";
export { StatusChip } from "./components/ui/status-chip";
export { GlassCard } from "./components/ui/glass-card";
export type { GlassCardProps } from "./components/ui/glass-card";
export { AuroraBackground } from "./components/ui/aurora-background";
export { CraaveeLoader } from "./components/ui/craavee-loader";
export type { CraaveeLoaderProps } from "./components/ui/craavee-loader";
export { CraaveeLiquidHeading } from "./components/ui/craavee-liquid-heading";
export type { CraaveeLiquidHeadingProps } from "./components/ui/craavee-liquid-heading";
export { LiquidText } from "./components/ui/liquid-text";
export type { LiquidTextProps } from "./components/ui/liquid-text";
export { PremiumButton, PremiumButtonLink } from "./components/ui/premium-button";
export { SlideUpText } from "./components/ui/slide-up-text";
export type { SlideUpTextProps } from "./components/ui/slide-up-text";
export { HandwritingSvg } from "./components/ui/handwriting-svg";

export { AuroraText } from "./components/magicui/aurora-text";
export { BentoGrid, BentoCard } from "./components/magicui/bento-grid";
export { Marquee } from "./components/magicui/marquee";
export { ShimmerButton } from "./components/magicui/shimmer-button";
export type { ShimmerButtonProps } from "./components/magicui/shimmer-button";
export { WarpBackground } from "./components/magicui/warp-background";
