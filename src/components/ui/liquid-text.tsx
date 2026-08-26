"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMotionReduced } from "@/hooks/use-motion-preference";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shared animation ticker                                             */
/*                                                                     */
/* One requestAnimationFrame loop drives EVERY visible LiquidText on   */
/* the page. The loop starts when the first instance activates and     */
/* stops itself when the last one deactivates — zero idle rAF work.    */
/* ------------------------------------------------------------------ */
type StepFn = (dt: number) => void;

const registry = new Set<StepFn>();
let rafId = 0;
let lastT = 0;

function tick(now: number) {
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  rafId = 0;
  registry.forEach((fn) => fn(dt));
  if (registry.size > 0) {
    rafId = requestAnimationFrame(tick);
  }
}

function registerTicker(fn: StepFn) {
  registry.add(fn);
  if (!rafId) {
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function unregisterTicker(fn: StepFn) {
  registry.delete(fn);
}

/* ------------------------------------------------------------------ */
/* Morph timing                                                        */
/* ------------------------------------------------------------------ */
const MORPH_TIME = 1.5;
const COOLDOWN_TIME = 0.5;

export interface LiquidTextProps {
  /** Phrases to cycle through. First phrase is the static/a11y fallback. */
  texts: string[];
  /**
   * External activity gate (e.g. "this card is the active scene").
   * Combined with IntersectionObserver visibility — the morph RAF only
   * runs while BOTH are true.
   */
  active?: boolean;
  className?: string;
  /** Accessible label for the whole rotating unit. */
  ariaLabel?: string;
}

/**
 * Liquid morphing typography. Two stacked spans cross-blur/opacity-morph
 * between phrases, shaped by an SVG threshold filter into a liquid
 * silhouette.
 *
 * Perf contract:
 *  - ONE shared rAF for all instances on the page
 *  - an instance only ticks while it is on-screen AND `active`
 *  - no React state participates in the animation (refs + direct style)
 */
export function LiquidText({
  texts,
  active = true,
  className,
  ariaLabel,
}: LiquidTextProps) {
  const reduce = useMotionReduced();
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* ---- visibility gate -------------------------------------------- */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* ---- morph engine ------------------------------------------------- */
  const textIndex = useRef(0);
  const morph = useRef(0);
  const cooldown = useRef(0);
  const t1 = useRef<HTMLSpanElement>(null);
  const t2 = useRef<HTMLSpanElement>(null);

  const apply = useCallback(
    (fraction: number, cooldownActive: boolean) => {
      const a = t1.current;
      const b = t2.current;
      if (!a || !b || texts.length === 0) return;

      if (cooldownActive) {
        b.style.filter = "none";
        b.style.opacity = "100%";
        a.style.filter = "none";
        a.style.opacity = "0%";
        return;
      }

      b.style.filter = `blur(${Math.min(8 / fraction - 8, 100)}px)`;
      b.style.opacity = `${Math.pow(fraction, 0.4) * 100}%`;

      const inv = 1 - fraction;
      a.style.filter = `blur(${Math.min(8 / inv - 8, 100)}px)`;
      a.style.opacity = `${Math.pow(inv, 0.4) * 100}%`;

      a.textContent = texts[textIndex.current % texts.length];
      b.textContent = texts[(textIndex.current + 1) % texts.length];
    },
    [texts]
  );

  const isActive = !reduce && active && visible;

  useEffect(() => {
    if (!isActive) return;
    const step = (dt: number) => {
      cooldown.current -= dt;
      if (cooldown.current <= 0) {
        morph.current -= cooldown.current;
        cooldown.current = 0;
        let fraction = morph.current / MORPH_TIME;
        if (fraction > 1) {
          cooldown.current = COOLDOWN_TIME;
          fraction = 1;
          textIndex.current++;
        }
        apply(fraction, false);
      } else {
        apply(0, true);
      }
    };
    registerTicker(step);
    return () => unregisterTicker(step);
  }, [apply, isActive]);

  /* Unique-per-instance SVG filter id (useId contains ":" which breaks url()). */
  const rawId = React.useId();
  const filterId = `liquid-threshold-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  if (reduce || texts.length === 0) {
    return (
      <div className={cn("relative w-full", className)} aria-label={ariaLabel}>
        {texts[0]}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn("relative w-full", className)}
      aria-label={ariaLabel ?? texts[0]}
      style={{ filter: `url(#${filterId}) blur(0.6px)` }}
    >
      {/* accessible static text */}
      <span className="sr-only">{texts[0]}</span>
      {/* morph layer */}
      <span aria-hidden="true" className="block">
        <span
          ref={t1}
          className="absolute inset-x-0 top-0 m-auto inline-block w-full"
        />
        <span
          ref={t2}
          className="absolute inset-x-0 top-0 m-auto inline-block w-full"
        />
      </span>
      {/* per-instance threshold filter */}
      <svg
        aria-hidden="true"
        focusable="false"
        className="hidden"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <filter id={filterId}>
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 255 -140"
            />
          </filter>
        </defs>
      </svg>
    </div>
  );
}

export default LiquidText;
