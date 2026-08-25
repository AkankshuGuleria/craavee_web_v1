"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  MapPin,
  CaretDown,
  Lightning,
  ArrowRight,
} from "@phosphor-icons/react";
import { motion, useTransform, useReducedMotion } from "motion/react";
import { useMouseParallax } from "@/components/interactive";
import { useAddress } from "@/components/providers";

const FLOATERS = [
  { emoji: "🥦", label: "Broccoli", price: "₹49", x: "6%", y: "18%", s: 26, d: 0 },
  { emoji: "🍓", label: "Strawberries", price: "₹89", x: "82%", y: "12%", s: 34, d: 0.15 },
  { emoji: "🥛", label: "Milk", price: "₹27", x: "88%", y: "62%", s: -30, d: 0 },
  { emoji: "🥑", label: "Avocado", price: "₹120", x: "4%", y: "66%", s: 40, d: 0.2 },
  { emoji: "🍫", label: "Chocolate", price: "₹75", x: "70%", y: "78%", s: 22, d: 0 },
];

const TICKER = [
  "Fruits & Vegetables",
  "Dairy & Eggs",
  "Snacks",
  "Beverages",
  "Instant Meals",
  "Staples",
  "Personal Care",
  "Frozen",
];

export function Hero({ onOpenSearch }: { onOpenSearch: () => void }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { mx, my } = useMouseParallax(!reduce);
  const [hoverSearch, setHoverSearch] = useState(false);
  const { address } = useAddress();

  // depth layers: background atmosphere drifts slow, chips move faster
  const bgX = useTransform(mx, (v) => v * -14);
  const bgY = useTransform(my, (v) => v * -10);
  const fgX = useTransform(mx, (v) => v * 26);
  const fgY = useTransform(my, (v) => v * 18);
  const typeX = useTransform(mx, (v) => v * -8);
  const typeY = useTransform(my, (v) => v * -5);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden rounded-b-[2.5rem] sm:rounded-b-[3.5rem]"
      style={{ backgroundColor: "var(--green-deep)" }}
    >
      {/* atmosphere — moves slowest */}
      <motion.div
        aria-hidden
        className="atmosphere-deep absolute inset-[-10%] drift-slow"
        style={reduce ? undefined : { x: bgX, y: bgY }}
      />

      {/* content grid */}
      <div className="relative z-10 mx-auto flex min-h-[88dvh] max-w-[1400px] flex-col justify-center px-5 pb-24 pt-32 sm:px-8 lg:pt-36">
        <motion.div style={reduce ? undefined : { x: typeX, y: typeY }} className="max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-bold text-lime-200 backdrop-blur-md"
          >
            <Lightning size={13} weight="fill" className="text-lime-300" />
            Delivery in 10 mins
            <span className="text-white/40">·</span>
            <span className="flex items-center gap-1 font-semibold text-white/80">
              <MapPin size={11} weight="fill" />
              {address ? address.area || address.city || "Ludhiana" : "Ludhiana"}
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-[clamp(2.7rem,7vw,5rem)] font-extrabold leading-[0.98] tracking-[-0.03em] text-white"
          >
            Cravings solved
            <br />
            <span className="text-transparent" style={{ WebkitTextStroke: "1.5px rgba(255,255,255,0.85)" }}>
              before
            </span>{" "}
            they hit.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="mt-5 max-w-md text-base leading-relaxed text-emerald-50/70"
          >
            Fresh groceries and everyday essentials, picked and packed the
            moment you tap — tracked live to your door.
          </motion.p>

          {/* giant search pill */}
          <motion.button
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={onOpenSearch}
            onMouseEnter={() => setHoverSearch(true)}
            onMouseLeave={() => setHoverSearch(false)}
            className="group mt-9 flex w-full max-w-xl cursor-pointer items-center gap-3 rounded-full border border-white/20 bg-white/10 px-6 py-4 text-left backdrop-blur-xl transition-all duration-300"
            style={
              hoverSearch && !reduce
                ? { transform: "scale(1.02)", boxShadow: "0 0 0 5px rgba(163,230,53,0.18), 0 20px 44px -16px rgba(0,0,0,0.45)" }
                : { boxShadow: "0 16px 40px -18px rgba(0,0,0,0.4)" }
            }
            aria-label="Open search"
          >
            <MagnifyingGlass size={21} weight="bold" className="shrink-0 text-lime-300" />
            <span className="flex-1 truncate text-sm font-medium text-white/60">
              Search for atta, dal, oil…
            </span>
            <kbd className="hidden shrink-0 items-center gap-1 rounded-md border border-white/15 bg-black/20 px-2 py-1 text-[10px] font-bold text-white/50 sm:flex">
              ⌘K
            </kbd>
          </motion.button>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="mt-6 flex flex-wrap items-center gap-3"
          >
            <button
              onClick={() => router.push("/shop")}
              className="btn-clay inline-flex cursor-pointer items-center gap-2 px-7 py-3.5 font-display text-sm font-bold"
            >
              Start shopping
              <ArrowRight weight="bold" size={16} />
            </button>
            <button
              onClick={() => router.push("/shop/track")}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 font-display text-sm font-bold text-white/90 transition-colors hover:bg-white/10"
            >
              Track an order
            </button>
          </motion.div>
        </motion.div>
      </div>

      {/* floating grocery objects — fastest layer */}
      {!reduce &&
        FLOATERS.map((f, i) => (
          <FloaterChip key={f.label} f={f} fgX={fgX} fgY={fgY} index={i} />
        ))}

      {/* category ticker — bottom edge */}
      <div className="absolute inset-x-0 bottom-0 z-10 overflow-hidden border-t border-white/10 py-3.5">
        <div
          className="flex w-max gap-10 whitespace-nowrap animate-marquee"
          style={{ ["--duration" as string]: "32s", animationDirection: "reverse" }}
        >
          {[...TICKER, ...TICKER].map((t, i) => (
            <span
              key={i}
              className="flex items-center gap-10 text-xs font-bold uppercase tracking-[0.18em] text-white/35"
            >
              {t}
              <span className="h-1 w-1 rounded-full bg-lime-400/60" />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FloaterChip({
  f,
  fgX,
  fgY,
  index,
}: {
  f: (typeof FLOATERS)[number];
  fgX: ReturnType<typeof useTransform<number, number>>;
  fgY: ReturnType<typeof useTransform<number, number>>;
  index: number;
}) {
  const x = useTransform(fgX, (v) => v * (f.s / 20));
  const y = useTransform(fgY, (v) => v * (f.s / 20));
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute z-[5] hidden md:block"
      style={{ left: f.x, top: f.y }}
      initial={{ opacity: 0, scale: 0.6, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        duration: 0.7,
        delay: 0.4 + f.d + index * 0.06,
        ease: [0.34, 1.56, 0.64, 1],
      }}
    >
      <motion.div style={{ x, y }} className="float-soft" >
        <div className="glass-card !rounded-3xl !border-white/15 !bg-white/10 px-4 py-3 backdrop-blur-xl">
          <div className="text-3xl">{f.emoji}</div>
          <p className="mt-1 text-[11px] font-bold leading-tight text-white/85">
            {f.label}
          </p>
          <p className="text-[10px] font-semibold text-lime-300">{f.price}</p>
        </div>
      </motion.div>
    </motion.div>
  );
}