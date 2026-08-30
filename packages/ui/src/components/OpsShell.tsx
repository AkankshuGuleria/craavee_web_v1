"use client";

// Generic operational-console shell — the layout chrome ported from the
// original prototype's AdminShell, parameterized by nav items instead of
// a hardcoded cross-app route list. Both apps/console and apps/store
// render the same shell with their own `navItems`/`brand`, rather than
// each maintaining a copy of this markup (real, measured reuse — see
// PHASE_2B_IMPLEMENTATION_REPORT.md §"packages/ui").
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface OpsNavItem {
  href: string;
  label: string;
  // An already-rendered icon ELEMENT (e.g. `<Stack size={18}
  // weight="bold" />`), not a component reference. Nav arrays are built
  // in plain Server Component page.tsx files and passed into this
  // ("use client") shell as a prop — the RSC server/client boundary can
  // serialize a rendered element (a plain descriptor object) but cannot
  // serialize a raw function/forwardRef component reference ("Functions
  // cannot be passed directly to Client Components"), which passing
  // `icon: Stack` (the component itself) hit in practice during Phase 2B
  // build verification. This is the durable fix, not a page-by-page
  // "use client" workaround — see PHASE_2B_IMPLEMENTATION_REPORT.md.
  icon: ReactNode;
}

export interface OpsShellProps {
  brand: string;
  navItems: OpsNavItem[];
  active: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function OpsShell({
  brand,
  navItems,
  active,
  title,
  subtitle,
  action,
  children,
}: OpsShellProps) {
  return (
    <div className="min-h-[100dvh] paper-bg">
      {/* mobile top bar */}
      <header className="glass-bar sticky top-0 z-40 lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 font-display text-sm font-black text-white">
              C
            </span>
            <span className="font-display text-base font-extrabold text-white">
              {brand}
            </span>
          </span>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-2 hide-scrollbar">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "whitespace-nowrap rounded-full border px-4 py-1.5 text-xs font-bold",
                active === item.label
                  ? "border-transparent bg-gradient-to-br from-orange-400 to-rose-500 text-white"
                  : "border-white/12 bg-white/[0.06] text-white/55"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/10 bg-[#0d1014] p-6 lg:flex">
        <Link href="/" className="mb-10 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 font-display text-base font-black text-white shadow-[0_8px_18px_-6px_rgba(255,138,61,0.7)]">
            C
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight text-white">
            {brand}
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-[background-color,border-color,color,box-shadow,transform]",
                active === item.label
                  ? "bg-gradient-to-br from-orange-400 to-rose-500 font-bold text-white shadow-[0_10px_24px_-8px_rgba(255,138,61,0.65)]"
                  : "font-semibold text-white/50 hover:bg-white/[0.07] hover:text-white"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="text-[11px] font-medium text-white/25">
          v2 · foundation shell (Phase 2B)
        </p>
      </aside>

      <div className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:pt-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-white">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-0.5 text-sm text-white/40">{subtitle}</p>
              )}
            </div>
            {action}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
