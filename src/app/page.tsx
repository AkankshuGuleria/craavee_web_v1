"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ShoppingCartSimple,
  House,
  SquaresFour,
  User,
  Minus,
  Plus,
  Lightning,
  Wallet,
  MapPin,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Reveal, SpotlightCard } from "@/components/interactive";
import { Hero } from "@/components/home/Hero";
import { SiteNav } from "@/components/site/SiteNav";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { useCart, useAuth } from "@/components/providers";
import { products, type Product } from "@/lib/products";
import { cn } from "@/lib/utils";

/* --------------------------- compact product -------------------------- */

const discountPct = (p: Product) =>
  p.mrp ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;

function CompactCard({ product }: { product: Product }) {
  const { add, items, updateQty } = useCart();
  const { user, requireAuth } = useAuth();
  const off = discountPct(product);
  const inCart = items.find((i) => i.id === product.id);
  const soldOut = product.stock === 0;

  const addOnce = () => {
    const payload = {
      id: product.id,
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
    };
    if (!user) {
      requireAuth(() => add(payload, 1), "/shop");
      return;
    }
    if (inCart && inCart.quantity >= product.stock) return;
    add(payload, 1);
  };

  return (
    <SpotlightCard className="w-40 shrink-0 snap-start rounded-3xl sm:w-44">
      <div
        className={cn(
          "clay-card h-full overflow-hidden !rounded-3xl",
          soldOut && "opacity-55"
        )}
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-t-[21px]">
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.05]"
          />
          {off >= 15 && !soldOut && (
            <span className="absolute left-2 top-2 rounded-lg bg-green-600 px-1.5 py-0.5 text-[10px] font-black text-white shadow-md">
              {off}% OFF
            </span>
          )}
          {soldOut && (
            <span className="absolute left-2 top-2 rounded-lg bg-neutral-800 px-1.5 py-0.5 text-[10px] font-black text-white">
              SOLD OUT
            </span>
          )}
        </div>
        <div className="p-3">
          <p className="line-clamp-2 min-h-[2.4rem] text-[13px] font-bold leading-snug text-neutral-900">
            {product.name}
          </p>
          <p className="text-xs font-medium text-neutral-400">{product.qty ?? "1 pc"}</p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="leading-tight">
              <p className="font-display text-sm font-extrabold tabular-nums text-neutral-900">
                ₹{product.price}
              </p>
              {product.mrp && (
                <p className="text-xs text-neutral-400 line-through">₹{product.mrp}</p>
              )}
            </div>
            {soldOut ? null : inCart ? (
              <Stepper
                qty={inCart.quantity}
                max={product.stock}
                onChange={(q) => updateQty(product.id, q)}
              />
            ) : (
              <button
                onClick={addOnce}
                className="cursor-pointer rounded-xl border-2 border-green-600/80 bg-white px-4 py-1.5 text-xs font-black uppercase tracking-wide text-green-700 transition-all hover:bg-green-600 hover:text-white active:scale-95"
              >
                Add
              </button>
            )}
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}

export function Stepper({
  qty,
  max,
  onChange,
}: {
  qty: number;
  max: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-green-600 p-1 text-white shadow-[0_6px_14px_-6px_rgba(23,138,80,0.7)]">
      <button
        aria-label="Decrease quantity"
        onClick={() => onChange(qty - 1)}
        className="grid h-6 w-6 cursor-pointer place-items-center rounded-lg transition-all hover:bg-green-700 active:scale-90"
      >
        <Minus size={12} weight="bold" />
      </button>
      <motion.span
        key={qty}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 20 }}
        className="w-4 text-center text-xs font-black tabular-nums"
      >
        {qty}
      </motion.span>
      <button
        aria-label="Increase quantity"
        onClick={() => onChange(qty + 1)}
        disabled={qty >= max}
        className="grid h-6 w-6 cursor-pointer place-items-center rounded-lg transition-all hover:bg-green-700 active:scale-90 disabled:opacity-40"
      >
        <Plus size={12} weight="bold" />
      </button>
    </div>
  );
}

function Row({ title, items }: { title: string; items: Product[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-xl font-extrabold tracking-tight text-neutral-900">
          {title}
        </h2>
        <Link
          href="/shop"
          className="text-xs font-extrabold uppercase tracking-wide text-green-700 transition-colors hover:text-green-800"
        >
          See all →
        </Link>
      </div>
      <div className="hide-scrollbar flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:px-6 lg:px-8">
        {items.map((p) => (
          <CompactCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------- category experience ------------------------ */

const CATS = [
  { label: "Fruits & Veg", emoji: "🥦", span: "md:col-span-2 md:row-span-2", img: true },
  { label: "Dairy & Eggs", emoji: "🥛", tint: "#FFF9EF" },
  { label: "Snacks", emoji: "🍿", tint: "#FDF0E7" },
  { label: "Beverages", emoji: "🥤", span: "md:col-span-2", tint: "#EBF3FA" },
  { label: "Staples", emoji: "🌾", tint: "#F7F3E4" },
  { label: "Instant Food", emoji: "🍜", tint: "#FBEAEA" },
  { label: "Personal Care", emoji: "🧼", tint: "#F0ECF9" },
  { label: "Frozen & Desserts", emoji: "🍦", tint: "#E9F6F2" },
];

function CategoryExperience() {
  const router = useRouter();
  return (
    <section className="mx-auto max-w-[1400px] px-4 pt-12 sm:px-6 lg:px-8">
      <Reveal>
        <h2 className="pb-4 font-display text-2xl font-extrabold tracking-tight text-neutral-900">
          Pick a shelf
        </h2>
      </Reveal>
      <Reveal delay={0.06}>
        <div className="grid auto-rows-[150px] grid-cols-2 gap-3.5 md:auto-rows-[165px] md:grid-cols-4">
          {CATS.map((c, i) => (
            <motion.button
              key={c.label}
              onClick={() => router.push("/shop")}
              initial={{ opacity: 0, y: 26, scale: 0.96 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{
                duration: 0.5,
                delay: i * 0.05,
                ease: [0.34, 1.56, 0.64, 1],
              }}
              className={cn(
                "group relative cursor-pointer overflow-hidden rounded-3xl border-2 border-white p-4 text-left shadow-[5px_8px_22px_-10px_rgba(14,42,29,0.18)] transition-transform duration-300 hover:-translate-y-1",
                c.span ?? ""
              )}
              style={{ backgroundColor: c.tint ?? "#ffffff" }}
            >
              {c.img ? (
                <>
                  <img
                    src="https://loremflickr.com/900/900/vegetables,fresh"
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0e2a1d]/85 via-[#0e2a1d]/25 to-transparent" />
                  <span className="absolute right-3 top-3 float-soft text-4xl drop-shadow-lg">
                    {c.emoji}
                  </span>
                  <span className="absolute bottom-4 left-4">
                    <span className="block font-display text-xl font-extrabold text-white">
                      {c.label}
                    </span>
                    <span className="text-xs font-semibold text-emerald-100/80">
                      Up to 40% off · daily picks
                    </span>
                  </span>
                </>
              ) : (
                <span className="flex h-full flex-col justify-between">
                  <span className="text-3xl transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110 sm:text-4xl">
                    {c.emoji}
                  </span>
                  <span className="font-display text-sm font-extrabold leading-tight text-neutral-800">
                    {c.label}
                  </span>
                </span>
              )}
            </motion.button>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------------------- editorial break ------------------------- */

function EditorialBreak() {
  const reduce = useReducedMotion();
  return (
    <section className="mx-auto mt-16 max-w-[1400px] overflow-hidden px-4 sm:px-6 lg:px-8">
      <div
        className="relative overflow-hidden rounded-[2.5rem] px-7 py-12 sm:px-12 lg:px-16"
        style={{ backgroundColor: "var(--green-deep)" }}
      >
        <div aria-hidden className="atmosphere-deep absolute inset-0 drift-slow" />
        <div className="relative grid items-center gap-10 lg:grid-cols-2">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-lime-200 backdrop-blur-md">
              <Lightning size={12} weight="fill" /> Picked at your tap
            </p>
            <h2 className="font-display text-[clamp(1.9rem,4.5vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.03em] text-white">
              Your basket is packed
              <br />
              <span className="italic">before</span> you close the app.
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-emerald-50/70">
              Dark-store staff start packing the second you pay. No queue, no
              batch delays — just a runner at your door.
            </p>
          </motion.div>

          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.92, rotate: 4 }}
            whileInView={{ opacity: 1, scale: 1, rotate: -2 }}
            viewport={{ once: true, amount: 0.35 }}
            transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
            className="relative mx-auto hidden w-full max-w-sm tilt-scene sm:block"
          >
            <div className="overflow-hidden rounded-[2rem] border-4 border-white/90 shadow-[0_40px_80px_-24px_rgba(0,0,0,0.55)]">
              <img
                src="https://loremflickr.com/800/640/groceries,basket"
                alt="Fresh grocery basket"
                loading="lazy"
                className="aspect-[5/4] w-full object-cover"
              />
            </div>
            <div className="glass-card absolute -bottom-5 -left-6 !rounded-2xl !border-white/15 !bg-white/10 px-4 py-3 backdrop-blur-xl float-soft">
              <p className="text-[10px] font-bold uppercase tracking-wide text-lime-300">
                Packed in
              </p>
              <p className="font-display text-lg font-extrabold tabular-nums text-white">
                90 seconds
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- bento why ---------------------------- */

const BENTO = [
  {
    icon: <Lightning size={26} weight="fill" />,
    title: "Delivery in 10 mins",
    body: "Crave it, tap it, it's already on its way.",
    span: "md:col-span-2 md:row-span-2",
    cls: "bg-gradient-to-br from-[#1ea35d] to-[#0e2a1d] text-white",
    iconCls: "bg-white/20 text-lime-300",
    bodyCls: "text-emerald-50/75",
  },
  {
    icon: <MapPin size={24} weight="fill" />,
    title: "To your door",
    body: "GPS or saved address — one tap.",
    cls: "glass-card",
    iconCls: "bg-green-100 text-green-700",
    bodyCls: "text-neutral-500",
  },
  {
    icon: <Wallet size={24} weight="fill" />,
    title: "Wallet checkout",
    body: "One tap. No card forms, ever.",
    cls: "clay-card",
    iconCls: "bg-orange-100 text-orange-600",
    bodyCls: "text-neutral-500",
  },
  {
    icon: <ShoppingCartSimple size={24} weight="fill" />,
    title: "Live tracking, every step",
    body: "Placed → packed → picked up → at your door. Watch it happen.",
    span: "md:col-span-2",
    cls: "glass-card",
    iconCls: "bg-sky-100 text-sky-700",
    bodyCls: "text-neutral-500",
  },
];

function BentoWhy() {
  return (
    <section className="mx-auto max-w-[1400px] px-4 pt-16 sm:px-6 lg:px-8">
      <Reveal>
        <h2 className="pb-5 font-display text-2xl font-extrabold tracking-tight text-neutral-900">
          Built for speed
        </h2>
      </Reveal>
      <Reveal delay={0.06}>
        <div className="grid auto-rows-[150px] grid-cols-2 gap-3.5 md:grid-cols-4">
          {BENTO.map((cell, i) => (
            <motion.div
              key={cell.title}
              initial={{ opacity: 0, y: 28, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{
                duration: 0.55,
                delay: i * 0.07,
                ease: [0.34, 1.56, 0.64, 1],
              }}
              className={cn(
                "relative flex flex-col justify-between overflow-hidden rounded-3xl p-5 shadow-[6px_10px_28px_-14px_rgba(14,42,29,0.25)] transition-transform duration-300 hover:-translate-y-1",
                cell.span ?? "",
                cell.cls
              )}
            >
              <span
                className={cn(
                  "grid h-11 w-11 place-items-center rounded-2xl",
                  cell.iconCls
                )}
              >
                {cell.icon}
              </span>
              <div>
                <h3 className="font-display text-base font-extrabold leading-snug">
                  {cell.title}
                </h3>
                <p className={cn("mt-1 text-xs leading-relaxed", cell.bodyCls)}>
                  {cell.body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* --------------------------------- page ------------------------------- */

export default function Home() {
  const router = useRouter();
  const { count, total } = useCart();
  const { user } = useAuth();
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

  const bestSellers = useMemo(
    () => products.filter((p) => p.popular && p.stock > 0).slice(0, 10),
    []
  );
  const under99 = useMemo(
    () => products.filter((p) => p.price <= 99 && p.stock > 0).slice(0, 12),
    []
  );

  return (
    <div className="min-h-[100dvh]" style={{ backgroundColor: "var(--paper)" }}>
      <SiteNav onOpenSearch={() => setSearchOpen(true)} />

      <main>
        <Hero onOpenSearch={() => setSearchOpen(true)} />

        <CategoryExperience />

        <Row title="Best Sellers" items={bestSellers} />

        <EditorialBreak />

        <Row title="Under ₹99" items={under99} />

        <BentoWhy />

        {/* closing CTA */}
        <section className="mx-auto max-w-[1400px] px-4 pb-16 pt-16 sm:px-6 lg:px-8">
          <Reveal>
            <div
              className="relative overflow-hidden rounded-[2.5rem] px-8 py-14 text-center shadow-[0_32px_64px_-24px_rgba(14,42,29,0.55)]"
              style={{ backgroundColor: "var(--green-deep)" }}
            >
              <div aria-hidden className="atmosphere-deep absolute inset-0 drift-slow" />
              <h2 className="relative mx-auto max-w-xl font-display text-[clamp(1.8rem,4.5vw,3rem)] font-extrabold leading-[1.04] tracking-[-0.03em] text-white">
                Craving something?
                <br />
                It's already being packed.
              </h2>
              <div className="relative mt-8 flex flex-wrap justify-center gap-3">
                <Link
                  href={user ? "/shop" : "/sign-in"}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 font-display text-sm font-extrabold text-green-900 shadow-[0_16px_36px_-12px_rgba(0,0,0,0.5)] transition-transform active:scale-95"
                >
                  {user ? "Start ordering" : "Sign in to order"}
                  <ArrowRight weight="bold" size={17} />
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* desktop footer */}
      <footer className="hidden pb-10 md:block">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between border-t border-[rgba(18,32,25,0.08)] px-6 pt-7 text-xs font-semibold text-neutral-400 lg:px-8">
          <span>© 2026 Craavee · Groceries in minutes</span>
          <span className="flex gap-6">
            <Link href="/shop" className="transition-colors hover:text-green-700">Shop</Link>
            <Link href="/shop/cart" className="transition-colors hover:text-green-700">Cart</Link>
            <Link href="/sign-in" className="transition-colors hover:text-green-700">Sign in</Link>
          </span>
        </div>
      </footer>

      {/* mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 glass-bar pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ borderRadius: 0 }}
      >
        <div className="grid grid-cols-4">
          {[
            { label: "Home", href: "/", icon: House, active: true },
            { label: "Shop", href: "/shop", icon: SquaresFour },
            { label: "Cart", href: "/shop/cart", icon: ShoppingCartSimple },
            { label: "Account", href: "/sign-in", icon: User },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-extrabold",
                item.active ? "text-green-700" : "text-neutral-400"
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
              className="btn-clay flex items-center justify-between px-5 py-3.5 text-sm font-bold"
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
    </div>
  );
}