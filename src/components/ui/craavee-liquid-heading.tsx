"use client";

import React from "react";
import { LiquidText } from "./liquid-text";
import { cn } from "@/lib/utils";

export interface CraaveeLiquidHeadingProps {
  /** Phrases to morph between (3–5 works best). */
  texts: string[];
  /** External activity gate — e.g. "this card is the active scene". */
  active?: boolean;
  /** Heading level for semantics. Defaults to a neutral div. */
  as?: "h1" | "h2" | "h3" | "span" | "div";
  /** Font-size + height classes; must include an explicit height since the
   *  morph spans are absolutely positioned. Use em-based heights so they
   *  track responsive font sizes. */
  sizeClassName?: string;
  /** Color/gradient treatment. */
  className?: string;
}

/**
 * Craavee's liquid-typography signature heading.
 * Display face, tight tracking, per-scene accent via className.
 */
export function CraaveeLiquidHeading({
  texts,
  active = true,
  as = "div",
  sizeClassName = "text-[clamp(1.9rem,4vw,3rem)] h-[1.12em]",
  className,
}: CraaveeLiquidHeadingProps) {
  const Tag = as as React.ElementType;
  return (
    <Tag
      className={cn(
        "font-display font-extrabold leading-none tracking-[-0.03em]",
        sizeClassName,
        className
      )}
    >
      <LiquidText
        texts={texts}
        active={active}
        ariaLabel={texts[0]}
        className="h-full"
      />
    </Tag>
  );
}

export default CraaveeLiquidHeading;
