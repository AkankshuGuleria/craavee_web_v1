"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  House,
  ShoppingCartSimple,
  SquaresFour,
  User,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import AuroraBackground from "@/components/ui/aurora-background";
import LandingNavbar from "@/components/home/LandingNavbar";
import LandingHero from "@/components/home/LandingHero";
import StackedCards from "@/components/ui/glass-cards";
import ProductDiscovery from "@/components/home/ProductDiscovery";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { useCart } from "@/components/providers";
import { cn } from "@/lib/utils";

/* --------------------------------- page -------------------------------- */

export default function Home() {
  const { count, total } = useCart();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if ((e.key === "/" || (e.key === "k" && e.metaKey)) && !typing) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AuroraBackground>
      <LandingNavbar onOpenSearch={() => setSearchOpen(true)} />

      <main>
        <LandingHero onOpenSearch={() => setSearchOpen(true)} />

        {/* scroll-driven stacked glass-card journey */}
        <StackedCards />

        {/* category-driven product browsing */}
        <ProductDiscovery />
      </main>

      {/* desktop footer */}
      <footer className="hidden pb-10 md:block">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between border-t border-white/10 px-6 pt-7 text-xs font-semibold text-white/35 lg:px-8">
          <span>© 2026 Craavee · Groceries in minutes</span>
          <span className="flex gap-6">
            <Link href="/shop" className="transition-colors hover:text-sky-300">
              Shop
            </Link>
            <Link
              href="/shop/cart"
              className="transition-colors hover:text-sky-300"
            >
              Cart
            </Link>
            <Link
              href="/sign-in"
              className="transition-colors hover:text-sky-300"
            >
              Sign in
            </Link>
          </span>
        </div>
      </footer>

      {/* mobile bottom nav */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/12 bg-[#0d1014]/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl md:hidden"
        style={{ borderRadius: 0 }}
      >
        <div className="grid grid-cols-4">
          {[
            { label: "Home", href: "/", icon: House, active: true },
            { label: "Shop", href: "/shop", icon: SquaresFour, active: false },
            {
              label: "Cart",
              href: "/shop/cart",
              icon: ShoppingCartSimple,
              active: false,
            },
            {
              label: "Account",
              href: "/sign-in",
              icon: User,
              active: false,
            },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-extrabold transition-colors",
                item.active ? "text-orange-400" : "text-white/40"
              )}
            >
              <item.icon size={21} weight={item.active ? "fill" : "regular"} />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* floating cart bar */}
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="fixed inset-x-4 bottom-16 z-40 md:hidden"
          >
            <Link
              href="/shop/cart"
              className="btn-ember flex items-center justify-between rounded-full px-5 py-3.5 text-sm font-bold"
            >
              <span className="tabular-nums">
                {count} item{count > 1 ? "s" : ""} · ₹{total}
              </span>
              <span className="flex items-center gap-1">
                View cart <ArrowRight size={14} weight="bold" />
              </span>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </AuroraBackground>
  );
}
