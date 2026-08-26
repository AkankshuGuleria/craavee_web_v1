"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Base 3D glass shell for Craavee surfaces.
 * preserve-3d ready so child layers can float above the surface with
 * translateZ. Hover lift/tilt is applied by consumers through CSS vars.
 */
export function GlassCard({
  children,
  className,
  ref,
  ...props
}: GlassCardProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "relative overflow-hidden rounded-[24px] border border-white/12 bg-gradient-to-br from-white/[0.14] via-white/[0.07] to-white/[0.03] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.75)]",
        className
      )}
      {...props}
    >
      {/* top sheen */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[24px] bg-gradient-to-br from-white/[0.12] via-white/[0.03] to-transparent"
      />
      {children}
    </div>
  );
}

export default GlassCard;
