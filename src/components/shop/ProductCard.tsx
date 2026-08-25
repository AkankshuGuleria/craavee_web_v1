"use client";

import { useState } from "react";
import { Plus, Minus, Lightning } from "@phosphor-icons/react";
import { TiltCard, Reveal, SpotlightCard } from "@/components/interactive";
import { useAuth, useCart, type CartItem } from "@/components/providers";
import { useToast } from "@/components/providers";
import type { Product } from "@/lib/products";
import { cn } from "@/lib/utils";

function stockBadge(p: Product) {
  if (p.stock === 0)
    return { text: "Out of stock", cls: "bg-neutral-200 text-neutral-500" };
  if (p.stock <= 6)
    return { text: `Only ${p.stock} left`, cls: "bg-orange-100 text-orange-600" };
  return null;
}

const off = (p: Product) =>
  p.mrp ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { add, items, updateQty } = useCart();
  const { user, requireAuth } = useAuth();
  const { toast } = useToast();
  const badge = stockBadge(product);
  const discount = off(product);
  const inCart = items.find((i) => i.id === product.id);

  const cartItem: Omit<CartItem, "quantity"> = {
    id: product.id,
    productId: product.id,
    name: product.name,
    price: product.price,
    image: product.image,
  };

  const handleAdd = () => {
    if (!product.stock) return;
    if (!user) {
      requireAuth(() => {
        add(cartItem);
        toast(`${product.name} added`, "success");
      }, "/shop");
      return;
    }
    requireAuth(() => {
      add(cartItem);
      toast(`${product.name} added`, "success");
    }, "/shop");
  };

  const canAddMore = product.stock > 0;

  return (
    <Reveal delay={(index % 5) * 0.05}>
      <SpotlightCard className="h-full rounded-[22px]">
        <TiltCard
          intensity={8}
          className={cn("h-full rounded-[22px]", !canAddMore && "opacity-60")}
        >
        <div className="clay-card flex h-full flex-col overflow-hidden !rounded-[22px]">
          <div className="relative aspect-square w-full overflow-hidden rounded-t-[19px] bg-neutral-50">
            <img
              src={product.image}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
            {discount >= 15 && canAddMore && (
              <span className="absolute left-2.5 top-2.5 rounded-lg bg-green-600 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-[0_6px_14px_-4px_rgba(22,163,74,0.6)]">
                {discount}% OFF
              </span>
            )}
            {badge && (
              <span className={cn(
                "absolute right-2.5 top-2.5 rounded-lg px-2 py-0.5 text-[10px] font-bold",
                badge.cls
              )}>
                {badge.text}
              </span>
            )}
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-green-700 backdrop-blur-sm">
              <Lightning size={10} weight="fill" /> {product.eta} min
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-1.5 p-3">
            <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-neutral-800">
              {product.name}
            </h3>
            <p className="text-xs text-neutral-400">{product.qty ?? "1 pc"}</p>

            <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
              <div className="leading-tight">
                <p className="text-sm font-extrabold text-neutral-900">₹{product.price}</p>
                {product.mrp && (
                  <p className="text-xs text-neutral-400 line-through">₹{product.mrp}</p>
                )}
              </div>

              {!canAddMore ? (
                <span className="rounded-xl border-2 border-neutral-100 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-neutral-300">
                  Gone
                </span>
              ) : inCart ? (
                <div className="flex items-center gap-1 rounded-xl bg-green-600 px-1 py-1 text-white shadow-[0_6px_14px_-6px_rgba(22,163,74,0.7)]">
                  <button
                    onClick={() => updateQty(product.id, inCart.quantity - 1)}
                    aria-label="Decrease quantity"
                    className="grid h-6 w-6 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-green-700 active:scale-90"
                  >
                    <Minus size={12} weight="bold" />
                  </button>
                  <span className="w-4 text-center text-xs font-extrabold">
                    {inCart.quantity}
                  </span>
                  <button
                    onClick={() => updateQty(product.id, inCart.quantity + 1)}
                    disabled={inCart.quantity >= product.stock}
                    aria-label="Increase quantity"
                    className="grid h-6 w-6 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-green-700 active:scale-90 disabled:opacity-40"
                  >
                    <Plus size={12} weight="bold" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleAdd}
                  aria-label={`Add ${product.name}`}
                  className="cursor-pointer rounded-xl border-2 border-green-600 bg-green-50 px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide text-green-700 transition-all hover:bg-green-600 hover:text-white active:scale-95"
                >
                  <span className="inline-flex items-center gap-1">
                    <Plus weight="bold" size={13} /> Add
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
        </TiltCard>
      </SpotlightCard>
    </Reveal>
  );
}