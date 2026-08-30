"use client";

import { cn } from "../../lib/utils";
import React, { ReactNode } from "react";

interface AuroraBackgroundProps extends React.HTMLProps<HTMLDivElement> {
  children: ReactNode;
  showRadialGradient?: boolean;
}

/**
 * Aurora atmosphere for the dark immersive Craavee environment.
 * Adapted from the reference implementation: permanently dark variant
 * (no invert trick), tuned gradient stops via --aurora-1..5, and the
 * legacy `aurora` keyframe preserved for magicui/aurora-text.
 */
export const AuroraBackground = ({
  className,
  children,
  showRadialGradient = true,
  ...props
}: AuroraBackgroundProps) => {
  return (
    <div
      className={cn(
        "relative flex min-h-[100dvh] flex-col overflow-x-clip bg-[#0a0c10] text-slate-100",
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={cn(
            `
            [--white-gradient:repeating-linear-gradient(100deg,var(--white)_0%,var(--white)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--white)_16%)]
            [--dark-gradient:repeating-linear-gradient(100deg,var(--black)_0%,var(--black)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--black)_16%)]
            [--aurora:repeating-linear-gradient(100deg,var(--aurora-1)_10%,var(--aurora-2)_16%,var(--aurora-3)_22%,var(--aurora-4)_28%,var(--aurora-5)_34%,var(--aurora-1)_40%)]
            [background-image:var(--dark-gradient),var(--aurora)]
            [background-size:300%,_200%]
            [background-position:50%_50%,50%_50%]
            animate-aurora-drift
            pointer-events-none
            absolute -inset-[10px] opacity-50
            `,
            showRadialGradient &&
              `[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,var(--transparent)_70%)]`
          )}
        />
      </div>

      {children}
    </div>
  );
};

export default AuroraBackground;
