"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { Search, ShoppingCart, User } from "lucide-react";
import { useAuth, useCart } from "@/components/providers";
import { cn } from "@/lib/utils";

const LINKS = [
  { label: "Categories", href: "/#categories" },
  { label: "Fresh", href: "/#fresh" },
  { label: "Shop", href: "/shop" },
];

/** Floating glass pill navbar — landing-only; SiteNav stays untouched for /shop. */
export function LandingNavbar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { count } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 32));

  return (
    <motion.header
      initial={{ y: -70, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 top-3 z-[70] flex justify-center px-3 sm:px-6"
    >
      <nav
        aria-label="Primary"
        className={cn(
          "flex w-full max-w-5xl items-center gap-1.5 rounded-full border backdrop-blur-md transition-[background-color,border-color,box-shadow,padding] duration-300",
          scrolled
            ? "border-white/20 bg-[#101318]/85 px-2.5 py-2 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.8)]"
            : "border-white/12 bg-white/[0.07] px-3 py-2.5"
        )}
      >
        <Link href="/" className="flex shrink-0 items-center gap-2 pl-1 pr-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-rose-500 font-display text-base font-black text-white shadow-[0_8px_20px_-6px_rgba(255,138,61,0.7)] transition-transform active:scale-95">
            C
          </span>
          <span className="hidden font-display text-lg font-extrabold tracking-tight text-white sm:block">
            Craavee
          </span>
        </Link>

        <div className="mx-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="rounded-full px-3.5 py-1.5 text-[13px] font-bold text-white/65 transition-colors hover:bg-white/10 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className={cn("flex items-center gap-2", "ml-auto md:ml-0")}>
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              aria-label="Search products"
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-white/12 bg-white/[0.08] text-white/80 transition-colors hover:border-white/30 hover:text-white active:scale-95"
            >
              <Search size={17} strokeWidth={2.5} />
            </button>
          )}

          {user ? (
            <button
              onClick={() => router.push("/shop")}
              aria-label={`Signed in as ${user.name}`}
              className="hidden h-10 w-10 cursor-pointer place-items-center rounded-full border border-white/12 bg-white/[0.08] text-emerald-300 transition-[background-color,border-color,color,box-shadow,transform] hover:border-white/30 sm:grid"
            >
              <User size={17} strokeWidth={2.5} />
            </button>
          ) : (
            <Link
              href="/sign-in"
              className="hidden h-10 cursor-pointer items-center rounded-full border border-white/12 bg-white/[0.08] px-4 text-sm font-bold text-white/80 transition-[background-color,border-color,color,box-shadow,transform] hover:border-white/30 hover:text-white sm:flex"
            >
              Sign in
            </Link>
          )}

          <button
            onClick={() => router.push("/shop/cart")}
            aria-label={`Cart with ${count} items`}
            className="relative grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-[0_10px_24px_-8px_rgba(255,138,61,0.75)] transition-transform active:scale-95"
          >
            <ShoppingCart size={17} strokeWidth={2.5} />
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
        </div>
      </nav>
    </motion.header>
  );
}

export default LandingNavbar;
