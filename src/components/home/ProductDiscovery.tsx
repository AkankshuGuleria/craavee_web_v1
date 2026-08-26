"use client";

import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import { CraaveeLiquidHeading } from "@/components/ui/craavee-liquid-heading";
import { GlassProductCard } from "@/components/ui/glass-product-card";
import { products } from "@/lib/products";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Curated rows under the main filterable grid                         */
/* ------------------------------------------------------------------ */
const inStock = products.filter((p) => p.stock > 0);

const ROWS: Array<{
  title: string;
  eyebrow: string;
  items: typeof products;
}> = [
  {
    title: "Snacks you'll want",
    eyebrow: "Aisle 01",
    items: inStock
      .filter(
        (p) =>
          p.category === "Munchies & Snacks" ||
          p.category === "Ice Cream & Desserts"
      )
      .slice(0, 6),
  },
  {
    title: "Fresh for today",
    eyebrow: "Aisle 02",
    items: inStock
      .filter(
        (p) =>
          p.category === "Fruits & Vegetables" || p.category === "Dairy & Eggs"
      )
      .slice(0, 6),
  },
  {
    title: "Drinks & more",
    eyebrow: "Aisle 03",
    items: inStock
      .filter(
        (p) =>
          p.category === "Cold Drinks & Beverages" ||
          p.category === "Tea & Coffee"
      )
      .slice(0, 6),
  },
];

const FILTERS = [
  "All",
  ...Array.from(new Set(inStock.map((p) => p.category))),
];

/* ------------------------------------------------------------------ */
/* ProductDiscovery — the shopping chapter under the immersive story   */
/* ------------------------------------------------------------------ */
export function ProductDiscovery() {
  const [filter, setFilter] = useState("All");

  const filtered = useMemo(() => {
    if (filter === "All") return inStock;
    return inStock.filter((p) => p.category === filter);
  }, [filter]);

  return (
    <section
      id="shop"
      aria-label="Shop products"
      className="relative z-10 mx-auto w-full max-w-[1400px] scroll-mt-24 px-4 pt-16 sm:px-6 lg:px-8"
    >
      {/* heading */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="mb-4 inline-flex items-center rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.2em] text-sky-200">
            Shop the aisles
          </span>
          <CraaveeLiquidHeading
            as="h2"
            texts={[
              "Your cravings, sorted.",
              "Good stuff. Right here.",
              "Crave something?",
            ]}
            sizeClassName="text-[clamp(1.9rem,3.8vw,3rem)] h-[1.14em]"
            className="text-white"
          />
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/55">
            Real stock at real prices. Add to cart right here — checkout takes
            seconds.
          </p>
        </div>
      </div>

      {/* category pills */}
      <div className="mt-7 flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
        {FILTERS.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            aria-pressed={filter === cat}
            className={cn(
              "whitespace-nowrap rounded-full border px-4 py-2 text-xs font-bold transition-colors duration-200",
              filter === cat
                ? "btn-ember border-transparent"
                : "border-white/12 bg-white/[0.06] text-white/55 hover:border-white/30 hover:text-white"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* main grid */}
      <motion.div
        key={filter}
        aria-live="polite"
        className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        {filtered.map((p, i) => (
          <GlassProductCard key={p.id} product={p} index={i} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-3xl border border-white/10 bg-white/[0.04] p-14 text-center">
            <p className="font-display text-lg font-bold text-white">
              Nothing matches that aisle yet.
            </p>
            <p className="mt-2 text-sm text-white/45">
              Try another craving — we restock daily.
            </p>
          </div>
        )}
      </motion.div>

      {/* curated rows */}
      {ROWS.map((row) =>
        row.items.length === 0 ? null : (
          <div key={row.title} className="mt-16">
            <div className="mb-4 flex items-baseline justify-between px-1">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/35">
                  {row.eyebrow}
                </span>
                <h3 className="font-display text-xl font-extrabold tracking-tight text-white">
                  {row.title}
                </h3>
              </div>
              <span className="rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[11px] font-bold text-white/50">
                {row.items.length} items
              </span>
            </div>
            <div className="hide-scrollbar -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
              {row.items.map((p, i) => (
                <div
                  key={p.id}
                  className="w-[172px] shrink-0 snap-start sm:w-[190px]"
                >
                  <GlassProductCard product={p} index={i} />
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </section>
  );
}

export default ProductDiscovery;
