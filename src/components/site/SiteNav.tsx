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
          "flex w-full max-w-7xl items-center gap-2 rounded-full border backdrop-blur-md transition-[background-color,border-color,box-shadow,padding] duration-300",
          scrolled
            ? "border-white/20 bg-[#101318]/85 px-3 py-2 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.8)]"
            : "border-white/12 bg-white/[0.07] px-4 py-2.5"
        )}
      >
        <Link href="/" className="flex shrink-0 items-center gap-2 pl-1">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-rose-500 font-display text-base font-black text-white shadow-[0_8px_20px_-6px_rgba(255,138,61,0.7)] transition-transform active:scale-95">
            C
          </span>
          <span className="hidden font-display text-lg font-extrabold tracking-tight text-white sm:block">
            Craavee
          </span>
        </Link>

        {/* location */}
        <button
          onClick={() => router.push("/shop")}
          aria-label="Change delivery location"
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-left transition-colors hover:bg-white/10"
        >
          <MapPin size={17} weight="fill" className="shrink-0 text-orange-400" />
          <span className="min-w-0">
            <span className="block text-[9px] font-bold uppercase leading-tight tracking-wide text-white/40">
              Delivering to
            </span>
            <span className="flex max-w-[120px] items-center gap-1 text-xs font-semibold leading-tight text-white/90">
              <span className="truncate">
                {address ? address.area || address.city || address.line : "Ludhiana"}
              </span>
              <CaretDown size={10} weight="bold" className="shrink-0 text-white/40" />
            </span>
          </span>
        </button>

        {/* search trigger */}
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            aria-label="Search products"
            className="mx-auto hidden min-w-[200px] cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-white/[0.08] px-4 py-2 text-left text-sm text-white/45 transition-[background-color,border-color,color,box-shadow,transform] hover:border-sky-300/40 hover:text-white/80 lg:flex"
          >
            <MagnifyingGlass size={15} weight="bold" />
            Search for atta, dal, oil…
            <kbd className="ml-auto rounded-md border border-white/15 bg-black/30 px-1.5 py-0.5 text-[10px] font-bold text-white/40">
              /
            </kbd>
          </button>
        )}

        <div className={cn("flex items-center gap-2", !onOpenSearch && "ml-auto")}>
          <button
            onClick={() => router.push("/shop/cart")}
            aria-label={`Cart with ${count} items`}
            className="relative grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-[0_10px_24px_-8px_rgba(255,138,61,0.75)] transition-transform active:scale-95"
          >
            <ShoppingCartSimple weight="bold" size={18} />
            {count > 0 && (
              <motion.span
                key={count}
                initial={{ scale: 0.4 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[#101318] bg-sky-400 px-1 text-[10px] font-black text-[#0a0c10]"
              >
                {count}
              </motion.span>
            )}
          </button>

          {user ? (
            <button
              onClick={() => router.push("/shop")}
              aria-label={`Signed in as ${user.name}`}
              className="hidden h-10 w-10 cursor-pointer place-items-center rounded-full border border-white/12 bg-white/[0.08] text-emerald-300 transition-[background-color,border-color,color,box-shadow,transform] hover:border-white/30 sm:grid"
            >
              <UserIcon size={17} weight="bold" />
            </button>
          ) : (
            <Link
              href="/sign-in"
              className="hidden h-10 cursor-pointer items-center rounded-full border border-white/12 bg-white/[0.08] px-4 text-sm font-bold text-white/80 transition-[background-color,border-color,color,box-shadow,transform] hover:border-white/30 hover:text-white sm:flex"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </motion.header>
  );
}