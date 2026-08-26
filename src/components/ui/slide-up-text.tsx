"use client";

import React from "react";
import {
  motion,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useMotionReduced } from "@/hooks/use-motion-preference";
import { cn } from "@/lib/utils";

export interface SlideUpTextProps {
  /** Plain text to reveal (coerced via String()). */
  children: React.ReactNode;
  /**
   * 0→1 progress of the owning card scene. Driven by ScrollTrigger via a
   * MotionValue — no React state participates in scrolling.
   */
  progress: MotionValue<number>;
  /** Sub-range of the scene progress this text reveals across. */
  range?: [number, number];
  split?: "characters" | "words";
  /** Sequencing between tokens: 0 = together, ~0.05 = strong cascade. */
  stagger?: number;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
}

interface TokProps {
  mv: MotionValue<number>;
  range: [number, number];
  children: string;
}

/**
 * Hydration-safe reduced-motion read: stays false through SSR and the
 * first client render (raw useReducedMotion reads the OS setting during
 * that render, which would mismatch the server markup), then flips after
 * mount. Markup is identical on both sides during hydration.
 */
/**
 * One token (character or word). Its rise/fade is derived directly from the
 * card-progress MotionValue — scrubbing backwards replays it in reverse for
 * free, with zero React involvement.
 */
function Tok({ mv, range, children }: TokProps) {
  const y = useTransform(mv, [range[0], range[1]], ["0.85em", "0em"]);
  const opacity = useTransform(mv, [range[0], range[0] + (range[1] - range[0]) * 0.7], [0, 1]);
  return (
    <motion.span style={{ y, opacity }} className="inline-block">
      {children}
    </motion.span>
  );
}

/**
 * Scroll-linked text reveal for the immersive stacked cards.
 * Characters for headlines/eyebrows, words for supporting copy.
 * The full string stays accessible via aria-label; reduced motion
 * renders plain static text.
 */
export function SlideUpText({
  children,
  progress,
  range = [0, 1],
  split = "characters",
  stagger = 0.03,
  as = "span",
  className,
}: SlideUpTextProps) {
  const reduce = useMotionReduced();
  const Tag = as as React.ElementType;

  const text = typeof children === "string" ? children : String(children ?? "");

  if (reduce) {
    return <Tag className={className}>{text}</Tag>;
  }

  const [p0, p1] = range;
  const span = Math.max(0.04, p1 - p0);

  const words = text.split(/\s+/).filter(Boolean);
  const tokens =
    split === "characters"
      ? words.flatMap((w) => w.split(""))
      : words;
  const n = Math.max(1, tokens.length);

  /* Cascade amount derived from the requested stagger so longer strings
     cascade harder without ever exceeding the given range. */
  const seq = Math.min(0.9, Math.max(0, stagger * n * 1.6));
  const d = Math.min(Math.max(span * (1 - seq), span * 0.18), span * 0.8);

  /* Precompute each token's sub-range (pure math — hook-safe). */
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const s =
      n === 1 ? p0 : p0 + (span - d) * (i / (n - 1));
    ranges.push([s, s + d]);
  }

  let cursor = 0;

  return (
    <Tag className={cn(className)} aria-label={children}>
      <span aria-hidden="true">
        {split === "words"
          ? words.map((w, i) => (
              <React.Fragment key={`w${i}`}>
                <Tok mv={progress} range={ranges[cursor++]}>
                  {w}
                </Tok>
                {i < words.length - 1 ? " " : ""}
              </React.Fragment>
            ))
          : words.map((w, wi) => (
              <span key={`ww${wi}`} className="inline-block whitespace-nowrap">
                {w.split("").map((ch, ci) => (
                  <Tok key={`${wi}-${ci}`} mv={progress} range={ranges[cursor++]}>
                    {ch}
                  </Tok>
                ))}
                {wi < words.length - 1 ? " " : ""}
              </span>
            ))}
      </span>
    </Tag>
  );
}

export default SlideUpText;
