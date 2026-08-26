"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  ArrowRight,
  MapPin,
  CaretDown,
  ShoppingCartSimple,
  Lightning,
} from "@phosphor-icons/react";
import { SiteNav } from "@/components/site/SiteNav";
import { Reveal } from "@/components/interactive";
import { ProductCard } from "@/components/shop/ProductCard";
import { AddressSheet, formatShort } from "@/components/address/AddressSheet";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { useCart, useAuth, useAddress } from "@/components/providers";
import { categories, products } from "@/lib/products";
import { cn } from "@/lib/utils";

export default function ShopPage() {
  const router = useRouter();
  const { count, total } = useCart();
  const { user } = useAuth();
  const { address } = useAddress();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("All Items");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // accept a query handed over from the command-style search
  useEffect(() => {
    const q = sessionStorage.getItem("craavee_search");
    if (q) {
      setQuery(q);
      setActive("All Items");
      sessionStorage.removeItem("craavee_search");
    }
  }, []);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchesCat = active === "All Items" || p.category === active;
      const matchesQ =
        query.trim() === "" ||
        p.name.toLowerCase().includes(query.toLowerCase());
      return matchesCat && matchesQ;
    });
  }, [query, active]);

  const openCart = () => {
    if (user) router.push("/shop/cart");
    else router.push("/sign-in?redirect=/shop/cart");
  };

  return (
    <main className="relative min-h-[100dvh] pb-36 bg-[#0a0c10]">
      <SiteNav onOpenSearch={() => setSearchOpen(true)} />
      <div aria-hidden className="atmosphere pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[clamp(1.8rem,4vw,2.6rem)] font-extrabold tracking-tight text-white">
                What's your craving?
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/50">
                <Lightning size={14} weight="fill" className="text-orange-400" />
                Delivered fast, right where you are.
              </p>
            </div>

            {/* deliver-to pill */}
            <button
              onClick={() => setSheetOpen(true)}
              aria-label="Change delivery address"
              className="clay-card flex cursor-pointer items-center gap-3 px-4 py-2.5"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-400/15 text-orange-300">
                <MapPin weight="bold" size={18} />
              </span>
              <span className="min-w-0 text-left">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-white/40">
                  {address ? "Delivering to" : "No address yet"}
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold text-white/90">
                  <span className="max-w-[200px] truncate">
                    {address
                      ? `${address.label} · ${formatShort(address)}`
                      : "Set your address"}
                  </span>
                  <CaretDown size={12} weight="bold" className="shrink-0 text-white/40" />
                </span>
              </span>
            </button>
          </div>
        </Reveal>

        {/* search */}
        <Reveal delay={0.06}>
          <div className="clay-input mt-5 flex items-center gap-3 px-5 py-3.5">
            <MagnifyingGlass size={18} className="shrink-0 text-white/40" weight="bold" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="text"
              placeholder="Search for atta, dal, oil…"
              className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/35 focus:outline-none"
            />
          </div>
        </Reveal>

        {/* category pills */}
        <Reveal delay={0.1}>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActive(cat)}
                className={cn(
                  "whitespace-nowrap rounded-full border px-4 py-2 text-xs font-bold transition-[background-color,border-color,color,box-shadow,transform] active:scale-95",
                  active === cat
                    ? "border-transparent bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-[0_10px_24px_-8px_rgba(255,138,61,0.7)]"
                    : "border-white/12 bg-white/[0.06] text-white/55 hover:border-white/30 hover:text-white"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </Reveal>
      </section>

      <section className="mx-auto mt-6 max-w-7xl px-4 sm:px-6">
        {filtered.length === 0 ? (
          <div className="clay-card p-14 text-center">
            <p className="font-display text-lg font-bold text-white">
              Nothing matches
            </p>
            <p className="mt-2 text-sm text-white/45">Try another search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        )}
      </section>

      {count > 0 && (
        <div className="fixed inset-x-4 bottom-16 z-40 md:inset-x-auto md:left-1/2 md:bottom-6 md:-translate-x-1/2">
          <button
            onClick={openCart}
            className="btn-clay flex w-full cursor-pointer items-center justify-center gap-3 px-7 py-3.5 font-display text-sm font-bold md:w-auto"
          >
            <ShoppingCartSimple weight="bold" size={18} />
            View cart · {count} item{count > 1 ? "s" : ""} · ₹{total}
            <ArrowRight weight="bold" size={16} />
          </button>
        </div>
      )}

      <AddressSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </main>
  );
}