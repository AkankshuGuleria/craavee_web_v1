"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  MapPin,
  CaretDown,
  ShoppingCartSimple,
  User as UserIcon,
} from "@phosphor-icons/react";
import { useMotionValueEvent, useScroll, motion } from "motion/react";
import { useAuth, useCart, useAddress } from "@/components/providers";
import { cn } from "@/lib/utils";

export function SiteNav({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { count } = useCart();
  const { address } = useAddress();
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 28));

  return (
    <motion.header
      initial={{ y: -70, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 top-3 z-[70] flex justify-center px-3 sm:px-6"
    >
      <nav
        className={cn(
          "flex w-full max-w-7xl items-center gap-2 rounded-full border border-white/60 bg-white/65 backdrop-blur-2xl transition-all duration-300",
          scrolled
            ? "px-3 py-2 shadow-[0_16px_40px_-16px_rgba(14,42,29,0.35)] saturate-[1.8]"
            : "border-white/50 px-4 py-2.5 shadow-[0_10px_30px_-18px_rgba(14,42,29,0.25)]"
        )}
        style={{ backgroundColor: scrolled ? "rgba(255,255,255,0.82)" : undefined }}
      >
        <Link href="/" className="flex shrink-0 items-center gap-2 pl-1">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-green-600 font-display text-base font-black text-white shadow-[0_8px_18px_-6px_rgba(23,138,80,0.55)] transition-transform active:scale-95">
            C
          </span>
          <span className="hidden font-display text-lg font-extrabold tracking-tight text-neutral-900 sm:block">
            Craavee
          </span>
        </Link>

        {/* location */}
        <button
          onClick={() => router.push("/shop")}
          aria-label="Change delivery location"
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-left transition-colors hover:bg-green-50"
        >
          <MapPin size={17} weight="fill" className="shrink-0 text-green-600" />
          <span className="min-w-0">
            <span className="block text-[9px] font-bold uppercase leading-tight tracking-wide text-neutral-400">
              Delivering to
            </span>
            <span className="flex max-w-[120px] items-center gap-1 text-xs font-semibold leading-tight text-neutral-800">
              <span className="truncate">
                {address ? address.area || address.city || address.line : "Ludhiana"}
              </span>
              <CaretDown size={10} weight="bold" className="shrink-0 text-neutral-400" />
            </span>
          </span>
        </button>

        {/* search trigger */}
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            aria-label="Search products"
            className="mx-auto hidden min-w-[200px] cursor-pointer items-center gap-2 rounded-full border border-neutral-200/80 bg-white/70 px-4 py-2 text-left text-sm text-neutral-400 transition-all hover:border-green-300 hover:bg-white lg:flex"
          >
            <MagnifyingGlass size={15} weight="bold" />
            Search for atta, dal, oil…
            <kbd className="ml-auto rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] font-bold text-neutral-400">
              /
            </kbd>
          </button>
        )}

        <div className={cn("flex items-center gap-2", !onOpenSearch && "ml-auto")}>
          <button
            onClick={() => router.push("/shop/cart")}
            aria-label={`Cart with ${count} items`}
            className="relative grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-green-600 text-white shadow-[0_8px_20px_-6px_rgba(23,138,80,0.55)] transition-all active:scale-95"
          >
            <ShoppingCartSimple size={18} weight="bold" />
            {count > 0 && (
              <motion.span
                key={count}
                initial={{ scale: 0.4 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-mango px-1 text-[10px] font-black text-white"
              >
                {count}
              </motion.span>
            )}
          </button>

          {user ? (
            <button
              onClick={() => router.push("/shop")}
              aria-label={`Signed in as ${user.name}`}
              className="hidden h-10 w-10 cursor-pointer place-items-center rounded-full border border-neutral-200/80 bg-white/80 text-green-700 transition-colors hover:bg-green-50 sm:grid"
            >
              <UserIcon size={17} weight="bold" />
            </button>
          ) : (
            <Link
              href="/sign-in"
              className="hidden h-10 cursor-pointer items-center rounded-full border border-neutral-200/80 bg-white/80 px-4 text-sm font-bold text-neutral-700 transition-colors hover:border-green-300 hover:text-green-700 sm:flex"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </motion.header>
  );
}