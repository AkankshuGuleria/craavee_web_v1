"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  ArrowRight,
  ClockCounterClockwise,
  Flame,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { products } from "@/lib/products";

const POPULAR = ["Milk", "Atta", "Banana", "Cold drinks", "Eggs", "Ice cream"];
const RECENTS_KEY = "craavee_recents";

export function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (raw) setRecents(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    if (query.trim().length < 1) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.category.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 5)
      .filter((p) => p.stock > 0);
  }, [query]);

  const remember = (q: string) => {
    const next = [q, ...recents.filter((r) => r !== q)].slice(0, 4);
    setRecents(next);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const goSearch = (q: string) => {
    if (!q.trim()) return;
    remember(q.trim());
    sessionStorage.setItem("craavee_search", q.trim());
    router.push("/shop");
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[95] bg-green-deep/45 backdrop-blur-sm"
          style={{ backgroundColor: "rgba(14,42,29,0.45)" }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: -28, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="mx-auto mt-20 w-[min(94vw,640px)] overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-[0_40px_90px_-24px_rgba(14,42,29,0.5)] backdrop-blur-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Search products"
          >
            {/* input row */}
            <div className="flex items-center gap-3 border-b border-neutral-200/70 px-5 py-4">
              <MagnifyingGlass size={20} weight="bold" className="shrink-0 text-green-600" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && goSearch(query)}
                placeholder="Search atta, dal, milk, snacks…"
                aria-label="Search query"
                className="w-full bg-transparent text-base font-medium text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
              />
              <button
                onClick={onClose}
                aria-label="Close search"
                className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X size={16} weight="bold" />
              </button>
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-4">
              {/* live results */}
              {results.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 pb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">
                    Products
                  </p>
                  {results.map((p, i) => (
                    <motion.button
                      key={p.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => goSearch(p.name)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-green-50"
                    >
                      <img
                        src={p.image}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-xl object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-neutral-900">
                          {p.name}
                        </span>
                        <span className="text-xs text-neutral-400">{p.category}</span>
                      </span>
                      <span className="font-display text-sm font-extrabold text-green-700">
                        ₹{p.price}
                      </span>
                    </motion.button>
                  ))}
                </div>
              )}

              {/* popular */}
              <p className="flex items-center gap-1.5 px-2 pb-2 pt-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">
                <Flame size={11} weight="fill" className="text-mango" /> Popular right now
              </p>
              <div className="flex flex-wrap gap-2 px-1 pb-3">
                {POPULAR.map((term) => (
                  <button
                    key={term}
                    onClick={() => goSearch(term)}
                    className="cursor-pointer rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-600 transition-all hover:border-green-400 hover:text-green-700 active:scale-95"
                  >
                    {term}
                  </button>
                ))}
              </div>

              {/* recents */}
              {recents.length > 0 && !query && (
                <>
                  <p className="flex items-center gap-1.5 px-2 pb-2 pt-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">
                    <ClockCounterClockwise size={11} weight="bold" /> Recent searches
                  </p>
                  <div className="flex flex-wrap gap-2 px-1">
                    {recents.map((term) => (
                      <button
                        key={term}
                        onClick={() => goSearch(term)}
                        className="cursor-pointer rounded-full bg-neutral-100 px-3.5 py-1.5 text-xs font-semibold text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => goSearch(query)}
              disabled={!query.trim()}
              className="btn-clay m-4 mt-0 flex w-[calc(100%-2rem)] cursor-pointer items-center justify-center gap-2 py-3 font-display text-sm font-bold disabled:opacity-40"
            >
              Search for “{query.trim() || "…"}”
              <ArrowRight weight="bold" size={15} />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}