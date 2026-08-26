"use client";

import React, { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { GlassCard } from "./glass-card";
import { useAuth, useCart } from "@/components/providers";
import { useMotionReduced } from "@/hooks/use-motion-preference";
import type { Product } from "@/lib/products";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Per-category accent language (static map — no dynamic class purge)  */
/* ------------------------------------------------------------------ */
interface Accent {
  glow: string;
  text: string;
}

const ACCENTS: Record<string, Accent> = {
  "Munchies & Snacks": { glow: "rgba(255,138,61,0.22)", text: "#ffb15c" },
  "Cold Drinks & Beverages": { glow: "rgba(56,189,248,0.20)", text: "#7dd3fc" },
  "Fruits & Vegetables": { glow: "rgba(52,211,153,0.20)", text: "#6ee7b7" },
  "Dairy & Eggs": { glow: "rgba(167,139,250,0.20)", text: "#c4b5fd" },
  "Instant Meals": { glow: "rgba(240,171,252,0.18)", text: "#f0abfc" },
  "Tea & Coffee": { glow: "rgba(251,191,36,0.18)", text: "#fcd34d" },
  "Ice Cream & Desserts": { glow: "rgba(244,114,182,0.18)", text: "#f9a8d4" },
  "Personal Care": { glow: "rgba(45,212,191,0.18)", text: "#5eead4" },
  Staples: { glow: "rgba(234,179,8,0.16)", text: "#fde047" },
  "Stationery & Power": { glow: "rgba(148,163,184,0.18)", text: "#cbd5e1" },
};

const DEFAULT_ACCENT: Accent = { glow: "rgba(255,138,61,0.2)", text: "#ffb15c" };

const accentFor = (category?: string): Accent =>
  (category && ACCENTS[category]) || DEFAULT_ACCENT;

/* ------------------------------------------------------------------ */
/* Stock states                                                        */
/* ------------------------------------------------------------------ */
function stockState(stock: number): {
  label: string;
  cls: string;
  dot: string;
} {
  if (stock <= 0)
    return { label: "Out of stock", cls: "text-white/35", dot: "bg-white/30" };
  if (stock <= 5)
    return {
      label: `Only ${stock} left`,
      cls: "text-orange-300",
      dot: "bg-orange-400",
    };
  if (stock <= 12)
    return { label: `${stock} left`, cls: "text-sky-300", dot: "bg-sky-400" };
  return { label: `${stock} in stock`, cls: "text-white/45", dot: "bg-emerald-400/80" };
}

/* ------------------------------------------------------------------ */
/* GlassProductCard                                                    */
/*                                                                     */
/* Layers (bottom → top):                                              */
/*   glass shell → category glow → product environment → image (Z) →   */
/*   badges (Z) → glare → info row → add/stepper                       */
/* Under the shell: the lifted stock indicator.                        */
/*                                                                     */
/* Tilt: pointer position writes CSS vars directly on the element      */
/* (--rx/--ry/--mx/--my). No React state, no rAF — the browser         */
/* interpolates via a short transform transition. Mouse-only; reduced  */
/* motion users get a static card.                                     */
/* ------------------------------------------------------------------ */
export interface GlassProductCardProps {
  product: Product;
  /** Stagger offset for viewport entrance (seconds). */
  index?: number;
  className?: string;
}

export function GlassProductCard({
  product,
  index = 0,
  className,
}: GlassProductCardProps) {
  const { add, items, updateQty } = useCart();
  const { user, requireAuth } = useAuth();
  const accent = accentFor(product.category);
  const inCart = items.find((i) => i.id === product.id);
  const soldOut = product.stock === 0;
  const off =
    product.mrp && product.mrp > product.price
      ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
      : 0;

  const stock = stockState(product.stock);

  /* ---- tilt plumbing (no React state on pointer move) -------------- */
  const shellRef = useRef<HTMLDivElement>(null);
  const motionReduced = useMotionReduced();
  const fxAllowed = useRef(false);

  useEffect(() => {
    fxAllowed.current =
      !motionReduced &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }, [motionReduced]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = shellRef.current;
    if (!el || !fxAllowed.current || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--rx", `${(-ny * 6).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(nx * 8).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${((nx + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${((ny + 0.5) * 100).toFixed(1)}%`);
  };

  const handlePointerLeave = () => {
    const el = shellRef.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  };

  /* ---- cart --------------------------------------------------------- */
  const addToCart = () => {
    if (!user) {
      requireAuth(
        () => add({ id: product.id, productId: product.id, name: product.name, price: product.price, image: product.image }, 1),
        "/shop"
      );
      return;
    }
    if (inCart && inCart.quantity >= product.stock) return;
    add({ id: product.id, productId: product.id, name: product.name, price: product.price, image: product.image }, 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{
        duration: 0.45,
        delay: Math.min(index * 0.05, 0.3),
        ease: [0.16, 1, 0.3, 1],
      }}
      className={cn("group relative flex h-full flex-col", className)}
    >
      {/* ---- tilting glass shell ------------------------------------- */}
      <GlassCard
        ref={shellRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className={cn(
          "glass-product-shell flex flex-1 cursor-default flex-col transition-[transform,box-shadow] duration-300 ease-out [--lift:0px] group-hover:[--lift:-6px] group-hover:shadow-[0_36px_70px_-26px_rgba(0,0,0,0.85)]",
          soldOut && "opacity-55"
        )}
        style={{
          transform:
            "translateY(var(--lift, 0px)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))",
        }}
      >
        {/* ---- product environment + image (elevated layer) --------- */}
        <div className="relative m-2.5 mb-0 aspect-square overflow-hidden rounded-[18px] bg-white/[0.05] [transform-style:preserve-3d]">
          {/* static category glow */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `radial-gradient(80% 80% at 50% 30%, ${accent.glow}, transparent 72%)`,
            }}
          />
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:[transform:translateZ(26px)_scale(1.07)] [transform:translateZ(14px)]"
          />

          {/* contact shadow beneath the elevated product */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 bottom-1 h-4 opacity-60 transition-opacity duration-300 group-hover:opacity-25"
            style={{
              background:
                "radial-gradient(closest-side, rgba(0,0,0,0.55), transparent)",
            }}
          />

          {/* badges (float above image) */}
          <div className="absolute left-2 top-2 flex flex-col gap-1 [transform:translateZ(36px)]">
            {off >= 15 && !soldOut && (
              <span className="rounded-lg bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white shadow-lg">
                {off}% OFF
              </span>
            )}
            {product.popular && off < 15 && !soldOut && (
              <span
                className="rounded-lg px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
                style={{ background: "rgba(255,255,255,0.14)", color: accent.text }}
              >
                Popular
              </span>
            )}
            {soldOut && (
              <span className="rounded-lg bg-neutral-900/90 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/80">
                Sold out
              </span>
            )}
          </div>

          {/* eta chip */}
          <span className="absolute bottom-2 left-2 rounded-md border border-white/12 bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 [transform:translateZ(30px)]">
            {product.eta} min
          </span>

          {/* cursor-tracked glare */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 [transform:translateZ(18px)]"
            style={{
              background:
                "radial-gradient(circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.16), transparent 52%)",
            }}
          />
        </div>

        {/* ---- info --------------------------------------------------- */}
        <div className="flex flex-1 flex-col p-3">
          <h3 className="line-clamp-2 min-h-[2.4rem] font-display text-sm font-bold leading-snug text-white/90">
            {product.name}
          </h3>
          <p className="mt-0.5 text-xs text-white/40">
            {product.qty ?? "1 pc"}
          </p>

          <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
            <div className="leading-tight">
              <p className="font-display text-base font-extrabold tabular-nums text-emerald-300">
                ₹{product.price}
              </p>
              {product.mrp && (
                <p className="text-xs text-white/35 line-through">₹{product.mrp}</p>
              )}
            </div>

            {!soldOut ? null : (
              <span className="rounded-xl border border-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/30">
                Gone
              </span>
            )}

            {soldOut ? null : inCart ? (
              <div className="flex items-center gap-1 rounded-xl bg-emerald-600 p-1 text-white shadow-[0_8px_18px_-8px_rgba(16,185,129,0.8)]">
                <button
                  type="button"
                  aria-label={`Decrease ${product.name} quantity`}
                  onClick={() => updateQty(product.id, inCart.quantity - 1)}
                  className="grid h-6 w-6 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-emerald-700 active:scale-90"
                >
                  <Minus size={12} strokeWidth={3} />
                </button>
                <span className="w-4 text-center text-xs font-black tabular-nums">
                  {inCart.quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${product.name} quantity`}
                  disabled={inCart.quantity >= product.stock}
                  onClick={() => updateQty(product.id, inCart.quantity + 1)}
                  className="grid h-6 w-6 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-emerald-700 active:scale-90 disabled:opacity-40"
                >
                  <Plus size={12} strokeWidth={3} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={addToCart}
                aria-label={`Add ${product.name} to cart`}
                className="btn-ember grid h-9 w-9 cursor-pointer place-items-center rounded-full transition-transform duration-200 hover:scale-105 active:scale-90"
              >
                <Plus size={16} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      </GlassCard>

      {/* ---- lifted stock indicator ---------------------------------- */}
      <div
        aria-live="polite"
        className="mt-1.5 flex flex-col items-center gap-0.5 pb-1"
      >
        {/* connector hairline — brightens as the card lifts */}
        <span
          aria-hidden
          className="h-2.5 w-px bg-gradient-to-b from-white/25 to-transparent opacity-40 transition-opacity duration-300 group-hover:opacity-100"
        />
        <span
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-semibold transition-all duration-300 group-hover:-translate-y-px group-hover:brightness-125",
            soldOut ? "text-white/30" : stock.cls,
            !soldOut && "opacity-70 group-hover:opacity-100"
          )}
        >
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", stock.dot)} />
          <span className={cn(soldOut && "line-through")}>{stock.label}</span>
        </span>
      </div>
    </motion.div>
  );
}

export default GlassProductCard;
