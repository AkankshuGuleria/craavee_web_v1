"use client";

import Link from "next/link";
import { cn } from "../../lib/utils";
import React from "react";

type Variant = "ember" | "ghost";
type Size = "md" | "lg";

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}

const base =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-display font-extrabold tracking-tight transition-[transform,filter,box-shadow,background-color,border-color,color] duration-200 select-none";

const variants: Record<Variant, string> = {
  ember: "btn-ember",
  ghost:
    "border border-white/20 bg-white/10 text-white backdrop-blur-xl hover:border-white/35 hover:bg-white/15 active:scale-[0.97]",
};

const sizes: Record<Size, string> = {
  md: "px-6 py-3 text-sm",
  lg: "px-8 py-4 text-base",
};

export function PremiumButtonLink({
  href,
  variant = "ember",
  size = "lg",
  className,
  children,
  ...rest
}: CommonProps & { href: string } & Omit<
    React.ComponentProps<typeof Link>,
    "href" | "className" | "children"
  >) {
  return (
    <Link
      href={href}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {children}
    </Link>
  );
}

export function PremiumButton({
  variant = "ember",
  size = "lg",
  className,
  children,
  ...rest
}: CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}
