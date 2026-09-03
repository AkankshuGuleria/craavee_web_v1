"use client";

// Migrated from the retired src/app/(admin)/catalog/page.tsx — same
// content and visuals, moved to the shared OpsShell. Placeholder data;
// real product/inventory queries against Supabase are Phase 9B work.
import { useState } from "react";
import { MagnifyingGlass, PencilSimple } from "@phosphor-icons/react/ssr";
import { motion } from "motion/react";
import { OpsShell, cn } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";

const inventory = [
  { id: 1, name: "Tomato Hybrid", qty: "500 g", stock: 24, price: 29, category: "Fruits & Vegetables" },
  { id: 2, name: "Potato", qty: "1 kg", stock: 30, price: 35, category: "Fruits & Vegetables" },
  { id: 3, name: "Protein Bar – Chocolate Fudge", qty: "1 pc", stock: 0, price: 85, category: "Munchies & Snacks" },
  { id: 4, name: "Amul Taaza Milk", qty: "500 ml", stock: 20, price: 27, category: "Dairy & Eggs" },
  { id: 5, name: "Whole Wheat Atta", qty: "5 kg", stock: 12, price: 89, category: "Staples" },
];

export default function ConsoleCatalogPage() {
  const [search, setSearch] = useState("");
  const filtered = inventory.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="Catalog" title="Catalog" subtitle="Manage items and pricing">
      <div className="clay-input mb-6 flex max-w-md items-center gap-3 px-5 py-3">
        <MagnifyingGlass size={17} className="shrink-0 text-white/40" weight="bold" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items…"
          aria-label="Search catalog"
          className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/35 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, ease: [0.34, 1.56, 0.64, 1] }}
            className={cn("clay-card p-4", item.stock === 0 && "opacity-60")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-bold text-white">{item.name}</h3>
                <p className="text-xs text-white/45">{item.category} · {item.qty}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-lg px-2 py-1 text-[10px] font-extrabold",
                  item.stock > 6 ? "bg-emerald-500/15 text-emerald-300" : item.stock > 0 ? "bg-orange-400/15 text-orange-300" : "bg-white/10 text-white/45"
                )}
              >
                {item.stock > 0 ? `${item.stock} left` : "Out"}
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-dashed border-white/10 pt-3">
              <span className="font-display text-base font-extrabold tabular-nums text-white">₹{item.price}</span>
              <button className="flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold text-white/65 transition-[background-color,border-color,color,box-shadow,transform] hover:border-sky-300/50 hover:text-sky-200 active:scale-95">
                <PencilSimple size={13} weight="bold" /> Edit
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </OpsShell>
  );
}
