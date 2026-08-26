"use client";

import Link from "next/link";
import { Package, Lightning, ClipboardText } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/catalog", label: "Catalog", icon: Package },
  { href: "/live-ops", label: "Live Ops", icon: Lightning },
  { href: "/packing", label: "Packing", icon: ClipboardText },
];

export function AdminShell({
  active,
  title,
  subtitle,
  action,
  children,
}: {
  active: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
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
              Craavee Ops
            </span>
          </span>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-2 hide-scrollbar">
          {NAV.map((item) => (
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
            Craavee Ops
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-2">
          {NAV.map((item) => (
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
              <item.icon size={18} weight="bold" />
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="text-[11px] font-medium text-white/25">v2 · ops console</p>
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