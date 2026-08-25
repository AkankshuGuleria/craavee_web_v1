"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Minus,
  Plus,
  MapPin,
  X,
  ShoppingCartSimple,
  ArrowRight,
  Wallet,
  PencilSimple,
  Lightning,
} from "@phosphor-icons/react";
import { Reveal } from "@/components/interactive";
import { AddressSheet, formatShort } from "@/components/address/AddressSheet";
import { useCart, useAuth, useAddress } from "@/components/providers";

export default function CartPage() {
  const router = useRouter();
  const { items, total, updateQty, remove, clear } = useCart();
  const { user } = useAuth();
  const { address } = useAddress();
  const [sheetOpen, setSheetOpen] = useState(false);
  const credits = 640;

  useEffect(() => {
    if (!user) router.replace("/sign-in?redirect=/shop/cart");
  }, [user, router]);

  if (!user) return null;

  const openTrack = () => {
    clear();
    router.push("/shop/track");
  };

  return (
    <main className="min-h-[100dvh]  pb-40">
      <header className="glass-bar sticky top-0 z-50">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link
            href="/shop"
            aria-label="Back to menu"
            className="grid h-10 w-10 place-items-center rounded-xl border-2 border-white bg-white text-neutral-700 shadow-[3px_4px_12px_-4px_rgba(21,94,54,0.18)] transition-transform active:scale-95"
          >
            <ArrowLeft size={18} weight="bold" />
          </Link>
          <h1 className="font-display text-lg font-extrabold tracking-tight text-neutral-900">
            Your cart
          </h1>
          <div className="w-10" />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 pt-6 sm:px-8">
        {items.length === 0 ? (
          <Reveal>
            <div className="clay-card p-14 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-green-50 text-green-600 float-soft">
                <ShoppingCartSimple size={30} weight="bold" />
              </div>
              <p className="mt-5 font-display text-xl font-extrabold text-neutral-900">
                Your cart is empty
              </p>
              <p className="mt-1.5 text-sm text-neutral-500">
                Cravings don't wait — grab something.
              </p>
              <Link
                href="/shop"
                className="btn-clay mt-6 inline-flex items-center gap-2 px-7 py-3 font-display text-sm font-bold"
              >
                Browse items
                <ArrowRight weight="bold" size={16} />
              </Link>
            </div>
          </Reveal>
        ) : (
          <>
            {/* address */}
            <Reveal>
              <div className="clay-card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-green-100 text-green-700">
                    <MapPin weight="bold" size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                      {address ? "Delivering to" : "No address yet"}
                    </p>
                    {address ? (
                      <>
                        <p className="truncate text-sm font-bold text-neutral-900">
                          {address.label}
                        </p>
                        <p className="truncate text-xs text-neutral-500">
                          {formatShort(address)}
                          {address.pincode ? ` · ${address.pincode}` : ""}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs font-medium text-orange-600">
                        Add an address to place your order
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setSheetOpen(true)}
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-2 border-green-600/70 bg-green-50 px-3.5 py-2 text-xs font-bold text-green-700 transition-all hover:bg-green-600 hover:text-white active:scale-95"
                  >
                    <PencilSimple size={13} weight="bold" />
                    {address ? "Change" : "Add"}
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-1.5 border-t-2 border-dashed border-neutral-100 pt-3 text-xs font-semibold text-green-700">
                  <Lightning size={13} weight="fill" />
                  Track it live the moment it's placed
                </div>
              </div>
            </Reveal>

            {/* items */}
            <div className="mt-4 space-y-3">
              {items.map((item, i) => (
                <Reveal key={item.id} delay={i * 0.04}>
                  <div className="clay-card flex items-center gap-3.5 p-3.5">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-50">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-bold text-neutral-900">
                        {item.name}
                      </h3>
                      <p className="text-sm font-semibold text-green-700">₹{item.price}</p>
                    </div>
                    <div className="flex items-center gap-1 rounded-xl bg-green-600 px-1 py-1 text-white">
                      <button
                        onClick={() => updateQty(item.id, item.quantity - 1)}
                        aria-label="Decrease quantity"
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-green-700 active:scale-90"
                      >
                        <Minus size={13} weight="bold" />
                      </button>
                      <span className="w-5 text-center text-xs font-extrabold">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQty(item.id, item.quantity + 1)}
                        aria-label="Increase quantity"
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-green-700 active:scale-90"
                      >
                        <Plus size={13} weight="bold" />
                      </button>
                    </div>
                    <button
                      onClick={() => remove(item.id)}
                      aria-label="Remove item"
                      className="ml-0.5 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-neutral-300 transition-colors hover:text-red-500 active:scale-90"
                    >
                      <X size={15} weight="bold" />
                    </button>
                  </div>
                </Reveal>
              ))}
            </div>

            {/* wallet */}
            <Reveal>
              <div className="glass-card mt-4 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-green-100 text-green-700">
                    <Wallet weight="bold" size={20} />
                  </span>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                      Wallet
                    </p>
                    <p className="text-sm font-bold text-neutral-900">
                      Balance: ₹{credits}
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-2 border-t-2 border-dashed border-neutral-200/70 pt-4">
                  <div className="flex justify-between text-sm text-neutral-500">
                    <span>Subtotal</span>
                    <span className="font-semibold text-neutral-800">₹{total}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-neutral-900">Total</span>
                    <span className="font-display text-lg font-extrabold text-green-700">
                      ₹{total}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-neutral-400">
                    <span>Left after checkout</span>
                    <span>₹{credits - total}</span>
                  </div>
                </div>
              </div>
            </Reveal>
          </>
        )}
      </div>

      {items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 glass-bar !rounded-t-3xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <div className="mx-auto flex max-w-2xl items-end justify-between">
            <div>
              <span className="text-xs font-semibold text-neutral-400">Total</span>
              <p className="font-display text-2xl font-extrabold text-neutral-900">₹{total}</p>
            </div>
            <button
              onClick={() => (address ? openTrack() : setSheetOpen(true))}
              disabled={!address}
              className="btn-clay inline-flex cursor-pointer items-center gap-2 px-8 py-3.5 font-display text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {address ? "Place order" : "Add address first"}
              <ArrowRight weight="bold" size={17} />
            </button>
          </div>
        </div>
      )}

      <AddressSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </main>
  );
}