# Craavee Design System — "Fresh-Tech Spatial Commerce"

Craavee is a quick-commerce grocery delivery platform (Blinkit/Zepto/Instamart class):
craving → search → add → wallet checkout → live runner tracking, delivered fast.
Three surfaces: consumer app (primary), runner app, ops console. This document
describes the consumer visual world; runner/ops share its tokens at lower motion.

## 1. Design Read & Dials
- Mode: **Persuade** on home/marketing surfaces, **Operate** on shop/cart/track.
- VARIANCE 6 · MOTION 7 · DENSITY 5. Mobile-first; depth preserved on mobile,
  cursor-parallax and tilt collapse to static/scroll reveals.

## 2. Color — "Greenhouse at dusk"
Atmosphere first: color arrives as light sources and diffusion, not linear gradients.
| Token | Value | Role |
|---|---|---|
| `--paper` | `#F3F5EC` | Global canvas — warm sage paper, never plain white |
| `--ink` | `#122019` | Primary text / deep panels (green-black) |
| `--ink-soft` | `#3E4F44` | Secondary text |
| `--moss` | `#64748B→#5B6B60` | Tertiary text |
| `--green` | `#178A50` | THE brand accent: CTAs, live states, links |
| `--green-deep` | `#0E2A1D` | Atmospheric panels, footer, hero backdrop |
| `--lime` | `#A3E635` | Highlight glow inside green only (badges, ping dots) |
| `--mango` | `#FF8A3D` | Food accent: offers, priority, cart count — never CTA |
| `--cream` | `#FFF9EF` | Promo surfaces |
| `--line` | `rgba(18,32,25,0.08)` | Hairlines |
Rules: mango may decorate but never carries primary actions; lime exists only
inside green contexts; no purple/blue anywhere.

## 3. Depth System
background atmosphere → section surface → card → object → interaction.
- Atmosphere: 1–2 blurred radial light sources per viewport + film grain overlay
  (`body::after`, fixed, pointer-events-none, opacity ≤ .05).
- Cards float via layered shadows tinted to green-ink, never pure black:
  `0 24px 48px -20px rgba(14,42,29,.22), 4px 6px 16px -6px rgba(14,42,29,.10)`.
- Objects (product images, emoji chips, badges) get `translateZ` separation inside
  `.tilt-scene` perspective containers and mouse parallax in the hero.

## 4. Surfaces
- **Clay** (tactile): category tiles, steppers, CTAs, floating controls.
  Radius 20–28px, white→sage gradient fill, inner top highlight + soft outer shadow.
- **Glass** (floating environment): nav capsule, search overlay, cart bar,
  filter chips. `backdrop-blur(20px) saturate(1.6)`, 1px light border, internal highlight.
- **Editorial flat**: section intros, storytelling breaks — big type, hairlines, air.
Balance ≈ 40% editorial / 40% clay / 20% glass. Never glass-on-glass stacking.

## 5. Typography
Outfit display (600–800, tracking -0.02em…-0.04em) + Geist body.
Hero clamp(2.75rem→5rem). Prices are display-weight tabular numerals.
Section rhythm: eyebrow-less; headline ≤8 words, optional 20-word sub.

## 6. Motion
Entrances: ease-out `[0.16,1,0.3,1]` 500–700ms, staggered by index×60–80ms.
Interactions: spring stiffness 260 damping 26. Hover lift ≤ 4px, tilt ≤ 8°.
Scroll: whileInView once, hierarchy = visual first, text follows, micro last.
Ambient: float-soft 4s loop on max 2 elements/viewport; marquee max 1/page.
All ambient collapses under `prefers-reduced-motion`.

## 7. Card System (not one card)
- `ProductCard` default: clay tile, square image, % OFF tag, ETA chip, stepper.
- Spotlight variant: cursor-tracked radial highlight border for featured rows.
- Editorial break: full-width type + parallax image between product collections.
- Compact quick-buy inside horizontal rows; promo cards in cream with mango tags.

## 8. Signature Interactions
Hero: headline stable, atmosphere drifts slow, product chips parallax faster;
search pill scales 1.02 on focus with glow ring. Nav capsule shrinks + blurs up
on scroll. Add-to-cart: button morphs to stepper; floating cart bar pulses once.
Search overlay: glass panel drops from nav with popular/recents (localStorage).

## 9. States
Branded loader (clay tile + bouncing seeds). Skeleton-light shimmer for grids.
Empty cart: floating bag illustration, craving-tone copy. Success: green bloom
check. All copy speaks craving-solved-in-minutes, never retail-process language.
