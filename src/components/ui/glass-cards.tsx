"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  motionValue,
  type MotionValue,
} from "motion/react";
import { ArrowRight, Zap } from "lucide-react";
import {
  productsFor,
  stackCards,
  type StackCardData,
} from "@/lib/craavee-data";
import { useMotionReduced } from "@/hooks/use-motion-preference";
import { products, type Product } from "@/lib/products";
import { HandwritingSvg } from "./handwriting-svg";
import { SlideUpText } from "./slide-up-text";
import { CraaveeLiquidHeading } from "./craavee-liquid-heading";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/* ------------------------------------------------------------------ */
/* Reduced-motion (effect-only read keeps SSR markup deterministic)    */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* StackedCards                                                        */
/*                                                                     */
/* ONE ScrollTrigger + ONE master timeline owns:                       */
/*   - card stacking (y / scale / dim)                                 */
/*   - scene-item entrances (products, tiles, deals, CTAs)             */
/*   - per-card scene-progress MotionValues consumed by SlideUpText    */
/*   - per-scene ambient glow crossfade                                */
/*   - effect shedding for buried cards                                */
/* Timeline units == viewports of scroll: card i enters during         */
/* [i, i+1) and is covered during [i+1, i+2).                          */
/* ------------------------------------------------------------------ */
export function StackedCards() {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useMotionReduced();
  /* Stable per-card scene progress values (Motion — never React state). */
  const progressRef = useRef<MotionValue<number>[]>(
    stackCards.map(() => motionValue(0))
  );
  /* Which scene owns the liquid typography right now. Integer state that
     changes once per viewport of scroll — never per frame. */
  const [activeScene, setActiveScene] = useState(0);
  const activeSceneRef = useRef(0);

  useEffect(() => {
    if (reduce) return;
    const root = rootRef.current;
    if (!root) return;

    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>("[data-stack-card]");
      const shades = gsap.utils.toArray<HTMLElement>("[data-stack-shade]");
      const glows = gsap.utils.toArray<HTMLElement>("[data-stack-glow]");
      const total = cards.length;

      const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

      /* The single per-frame callback: progress MVs (only for cards near
         the viewport — far cards get a single edge write, ever), glow
         crossfade, active-scene resolution, buried-card shedding.
         Epsilon-guarded style ops. */
      let covered = 0;
      function onFrame(self: ScrollTrigger) {
        const clock = self.progress * (total + 1);

        for (let i = 0; i < total; i++) {
          const mv = progressRef.current[i];
          const p = clamp01(clock - i);
          if (p <= 0 || p >= 1.2) {
            /* far from viewport: pin to nearest edge once, then skip */
            const edge = p <= 0 ? 0 : 1;
            if (mv.get() !== edge) mv.set(edge);
            continue;
          }
          if (Math.abs(mv.get() - p) > 0.004) mv.set(p);
        }

        /* resolve the active scene for liquid typography gating */
        const idx = Math.min(total - 1, Math.max(0, Math.floor(clock)));
        if (idx !== activeSceneRef.current) {
          activeSceneRef.current = idx;
          setActiveScene(idx);
        }

        for (let i = 0; i < total; i++) {
          const g = glows[i];
          if (!g) continue;
          const op =
            clamp01(1 - Math.abs(clock - (i + 1)) * 1.05) * 0.65;
          if (Math.abs(parseFloat(g.style.opacity || "0") - op) > 0.015) {
            g.style.opacity = op.toFixed(3);
          }
        }

        const want = Math.max(
          0,
          Math.min(total - 2, Math.floor(clock) - 2)
        );
        while (covered < want) {
          cards[covered].classList.add("stack-covered");
          covered++;
        }
        while (covered > want) {
          covered--;
          cards[covered].classList.remove("stack-covered");
        }
      }

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: root,
          start: "top bottom",
          end: "bottom bottom",
          scrub: 0.6,
          onUpdate: onFrame,
        },
      });

      const targetScale = (i: number) =>
        i === total - 1 ? 1 : Math.max(1 - (total - 1 - i) * 0.05, 0.6);

      /* --- layer 1: card stacking ------------------------------------ */
      for (let i = 0; i < total; i++) {
        tl.fromTo(
          cards[i],
          { y: 70, opacity: 0.3, rotate: i % 2 === 0 ? -2.5 : 2.5 },
          { y: 0, opacity: 1, rotate: 0, duration: 1 },
          i
        ).addLabel(`scene-${i}`, i);
      }
      for (let i = 0; i < total - 1; i++) {
        tl.to(cards[i], { scale: targetScale(i), duration: 1 }, i + 1).to(
          shades[i],
          { opacity: 0.55, duration: 1 },
          i + 1
        );
      }
      tl.to({}, { duration: 1 }, total);

      /* --- layer 2: cinematic scene-item entrances ------------------- */
      const DIRS: Record<
        string,
        { x: number; y: number; r: number; s: number }
      > = {
        left: { x: -44, y: -26, r: -4, s: 1 },
        right: { x: 56, y: -10, r: 4, s: 1 },
        up: { x: 0, y: 46, r: 0, s: 1 },
        soft: { x: 0, y: 24, r: 0, s: 0.96 },
        diag: { x: -30, y: 32, r: -3, s: 0.95 },
        tr: { x: 44, y: -28, r: 5, s: 1 },
        scale: { x: 0, y: 0, r: 0, s: 0.86 },
      };
      const CYCLE = ["up", "right", "scale", "left", "tr", "diag"];

      for (let i = 0; i < total; i++) {
        const items = Array.from(
          cards[i].querySelectorAll<HTMLElement>("[data-scene-item]")
        );
        let auto = 0;
        items.forEach((el) => {
          const kind = el.dataset.enter ?? CYCLE[auto % CYCLE.length];
          const d = DIRS[kind] ?? DIRS.up;
          const slot = el.dataset.slot !== undefined
            ? Number(el.dataset.slot)
            : auto;
          tl.fromTo(
            el,
            { opacity: 0, x: d.x, y: d.y, rotate: d.r, scale: d.s },
            {
              opacity: 1,
              x: 0,
              y: 0,
              rotate: 0,
              scale: 1,
              duration: 0.38,
              ease: "power2.out",
            },
            i + 0.42 + Math.min(slot, 6) * 0.075
          );
          auto++;
        });
      }
    }, root);

    return () => ctx.revert();
  }, [reduce]);

  return (
    <section
      aria-label="The Craavee journey"
      ref={rootRef}
      className="relative z-10 w-full pb-[8svh] pt-[6svh]"
    >
      <h2 className="sr-only">Explore Craavee</h2>
      {stackCards.map((card, index) => (
        <StackCard
          key={card.id}
          card={card}
          index={index}
          progress={progressRef.current[index]}
          sceneActive={index === activeScene}
        />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Presentational stack card                                           */
/* ------------------------------------------------------------------ */
function StackCard({
  card,
  index,
  progress,
  sceneActive,
}: {
  card: StackCardData;
  index: number;
  progress: MotionValue<number>;
  sceneActive: boolean;
}) {
  /* stable anchors for navbar deep-links */
  const anchorId =
    index === 1 ? "categories" : index === 2 ? "fresh" : undefined;

  return (
    <div
      id={anchorId}
      className="sticky top-0 flex h-[100svh] items-center justify-center px-3"
    >
      {/* per-scene ambient glow — crossfades as scenes change */}
      <div
        aria-hidden
        data-stack-glow
        className="pointer-events-none absolute inset-[-15%] opacity-0"
        style={{
          background: `radial-gradient(55% 50% at 50% 46%, ${card.glow}, transparent 70%)`,
        }}
      />

      <div
        data-stack-card
        style={{ top: `calc(-2vh + ${index * 22}px)` }}
        className="relative h-auto max-h-[88svh] w-[min(94vw,1080px)] will-change-transform lg:h-[min(76svh,600px)]"
      >
        {/* electric border — transform-only rotation, paused when covered */}
        <div
          aria-hidden
          className="absolute -inset-[2px] overflow-hidden rounded-[34px]"
        >
          <div className="absolute inset-0">
            <div
              className="edge-spin absolute left-1/2 top-1/2 aspect-square w-[170%] -translate-x-1/2 -translate-y-1/2"
              style={{
                background: `conic-gradient(from 0deg, transparent 0deg, ${card.accent} 55deg, transparent 150deg, ${card.accent} 230deg, transparent 340deg)`,
                opacity: 0.5,
                animation: "spin-around 20s linear infinite",
              }}
            />
          </div>
        </div>

        {/* glass body — the single blur layer of the card */}
        <div
          className="glass-card-body relative flex h-full w-full flex-col overflow-hidden rounded-[32px] border border-white/15 bg-white/[0.09] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)] backdrop-blur-md"
          style={{ minHeight: "min(520px, 86svh)" }}
        >
          {/* ambient accent glow (static, pre-softened gradient — no filter) */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
            style={{
              background: `radial-gradient(circle at center, ${card.glow}, transparent 70%)`,
            }}
          />
          {/* top reflection + side highlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[32px] bg-gradient-to-br from-white/[0.14] via-white/[0.04] to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-full w-px bg-gradient-to-b from-white/25 via-white/5 to-transparent"
          />

          {/* scene */}
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto p-6 sm:p-9 lg:flex-row lg:items-center lg:gap-10 lg:overflow-visible lg:p-11">
            {renderScene(card, progress, sceneActive)}
          </div>

          {/* dim layer while covered */}
          <div
            data-stack-shade
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 rounded-[32px] bg-black opacity-0"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared scene header — liquid morphing heading + SlideUpText support  */
/* ------------------------------------------------------------------ */
function SceneHeader({
  card,
  progress,
  liquidActive,
  large = false,
}: {
  card: StackCardData;
  progress: MotionValue<number>;
  liquidActive: boolean;
  large?: boolean;
}) {
  const phrases =
    card.liquid && card.liquid.length > 0
      ? card.liquid
      : [card.title ?? ""];

  return (
    <div>
      <span
        className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.2em]"
        style={{ color: card.accent }}
      >
        <Zap size={10} strokeWidth={3} />
        <SlideUpText
          as="span"
          split="characters"
          stagger={0.012}
          progress={progress}
          range={[0.04, 0.28]}
        >
          {card.eyebrow ?? "Craavee quick commerce"}
        </SlideUpText>
      </span>

      <CraaveeLiquidHeading
        as="h2"
        texts={phrases}
        active={liquidActive}
        sizeClassName={
          large
            ? "text-[clamp(2rem,4.6vw,3.4rem)] h-[1.14em]"
            : "text-[clamp(1.7rem,3.6vw,2.7rem)] h-[1.16em]"
        }
        className="text-white"
      />

      {card.description && (
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60 sm:text-base">
          <SlideUpText
            as="span"
            split="words"
            stagger={0.05}
            progress={progress}
            range={[0.4, 0.82]}
          >
            {card.description}
          </SlideUpText>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene-item helper — marks an element for GSAP entrance choreography */
/* ------------------------------------------------------------------ */
function SceneItem({
  enter,
  slot,
  className,
  children,
}: {
  enter?: string;
  slot?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-scene-item
      {...(enter ? { "data-enter": enter } : {})}
      {...(slot !== undefined ? { "data-slot": String(slot) } : {})}
      className={className}
    >
      {children}
    </div>
  );
}

function renderScene(
  card: StackCardData,
  progress: MotionValue<number>,
  sceneActive: boolean
) {
  switch (card.type) {
    case "intro":
      return <IntroScene card={card} progress={progress} sceneActive={sceneActive} />;
    case "categories":
      return <CategoriesScene card={card} progress={progress} sceneActive={sceneActive} />;
    case "fresh":
      return <FreshScene card={card} progress={progress} sceneActive={sceneActive} />;
    case "cta":
      return <CtaScene card={card} progress={progress} />;
  }
}

/* ---------------------------- CARD 1 — INTRO ---------------------- */
function IntroScene({
  card,
  progress,
  sceneActive,
}: {
  card: StackCardData;
  progress: MotionValue<number>;
  sceneActive: boolean;
}) {
  const floats = productsFor(card);
  return (
    <>
      <div className="flex flex-1 flex-col justify-center">
        <SceneHeader card={card} progress={progress} liquidActive={sceneActive} large />

        <div className="mt-6 flex flex-wrap gap-2">
          {["Fast delivery", "Fresh picks", "Zero hassle"].map((b) => (
            <SceneItem key={b} enter="up" slot={4}>
              <span className="block rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/70">
                {b}
              </span>
            </SceneItem>
          ))}
        </div>

        <SceneItem enter="up" slot={5}>
          <Link
            href="/shop"
            className="btn-ember mt-8 inline-flex w-fit cursor-pointer items-center gap-2 rounded-full px-7 py-3.5 font-display text-sm font-extrabold"
          >
            Start exploring <ArrowRight size={16} strokeWidth={2.75} />
          </Link>
        </SceneItem>
      </div>

      {/* floating groceries — independent entrances */}
      <div
        aria-hidden
        className="relative hidden shrink-0 lg:block lg:w-[38%]"
      >
        <div className="relative h-72 xl:h-80">
          {floats.slice(0, 3).map((p, i) => (
            <SceneItem
              key={p.id}
              enter={["left", "tr", "diag"][i]}
              slot={i}
              className={
                [
                  "absolute right-6 top-2 w-44",
                  "absolute left-0 top-24 w-36",
                  "absolute bottom-0 right-16 w-32",
                ][i]
              }
            >
              <FloatProduct
                product={p}
                className={["w-full rotate-[6deg]", "w-full -rotate-[7deg]", "w-full rotate-[3deg]"][i]}
                delay={`${i * 1.3}s`}
              />
            </SceneItem>
          ))}
        </div>
      </div>
    </>
  );
}

function FloatProduct({
  product,
  className,
  delay = "0s",
}: {
  product: Product;
  className?: string;
  delay?: string;
}) {
  /* outer owns static transforms; inner runs the float loop */
  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        className="float-soft overflow-hidden rounded-3xl border border-white/18 shadow-[0_26px_54px_-22px_rgba(0,0,0,0.85)]"
        style={{ animationDelay: delay }}
      >
        <img
          src={product.image}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-square w-full object-cover"
        />
        <span className="absolute bottom-2 left-2 rounded-lg border border-white/15 bg-black/60 px-2 py-0.5 text-[11px] font-extrabold tabular-nums text-emerald-300">
          ₹{product.price}
        </span>
      </div>
    </div>
  );
}

/* -------------------------- CARD 2 — CATEGORIES -------------------- */
function CategoriesScene({
  card,
  progress,
  sceneActive,
}: {
  card: StackCardData;
  progress: MotionValue<number>;
  sceneActive: boolean;
}) {
  const router = useRouter();
  return (
    <>
      <div className="lg:w-[34%] lg:shrink-0">
        <SceneHeader card={card} progress={progress} liquidActive={sceneActive} />
      </div>
      <div className="grid flex-1 grid-cols-3 content-center gap-2.5 sm:gap-3">
        {(card.categories ?? []).map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => router.push("/shop")}
            aria-label={`Browse ${c.label}`}
            data-scene-item
            className="group glass-surface-soft flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-4 transition-[transform,background-color] duration-200 hover:-translate-y-1 hover:bg-white/[0.13] sm:py-5"
          >
            <span
              aria-hidden
              className="text-2xl drop-shadow-lg transition-transform duration-300 group-hover:scale-125 sm:text-4xl"
            >
              {c.emoji}
            </span>
            <span className="text-center text-[10px] font-bold leading-tight text-white/70 group-hover:text-white sm:text-xs">
              {c.label}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/* --------------------------- CARD 5 — FRESH ------------------------- */
function FreshScene({
  card,
  progress,
  sceneActive,
}: {
  card: StackCardData;
  progress: MotionValue<number>;
  sceneActive: boolean;
}) {
  const items = productsFor(card);
  return (
    <>
      <div className="lg:w-[34%] lg:shrink-0">
        <SceneHeader card={card} progress={progress} liquidActive={sceneActive} />
      </div>
      <div className="grid flex-1 grid-cols-3 content-center gap-3">
        {items.map((p, i) => (
          <figure
            key={p.id}
            data-scene-item
            data-enter={i % 2 === 0 ? "soft" : "up"}
            className={cn(
              "group relative overflow-hidden border border-white/15 shadow-[inset_0_2px_0_rgba(255,255,255,0.16),0_18px_36px_-18px_rgba(0,0,0,0.7)] transition-transform duration-300 hover:-translate-y-1",
              i % 2 === 0
                ? "rounded-[26px]"
                : "rounded-t-[38px] rounded-b-[18px]",
              "bg-emerald-400/[0.06]"
            )}
          >
            <img
              src={p.image}
              alt={p.name}
              loading="lazy"
              decoding="async"
              className="aspect-[5/4] w-full object-cover transition-transform duration-500 group-hover:scale-110"
            />
            <figcaption className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between rounded-xl bg-black/55 px-2 py-1">
              <span className="truncate text-[10px] font-bold text-white/90">
                {p.name}
              </span>
              <span className="text-[10px] font-extrabold tabular-nums text-emerald-300">
                ₹{p.price}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

/* ----------------------------- CARD 7 — CTA ------------------------- */
function CtaScene({
  card,
  progress,
}: {
  card: StackCardData;
  progress: MotionValue<number>;
}) {
  const cluster = [products[0], products[24], products[7]].filter(Boolean);
  return (
    <div className="relative mx-auto flex w-full max-w-xl flex-col items-center text-center">
      {/* glowing product cluster */}
      <div aria-hidden className="relative mb-8 h-24 w-64">
        <div
          className="absolute left-1/2 top-1/2 h-32 w-56 -translate-x-1/2 -translate-y-1/2"
          style={{
            background:
              "radial-gradient(closest-side, rgba(249,115,22,0.35), transparent 72%)",
          }}
        />
        {cluster.map((p, i) => (
          <SceneItem
            key={p.id}
            enter={["left", "right", "scale"][i]}
            slot={i}
            className={`absolute ${
              i === 0
                ? "left-2 top-4"
                : i === 1
                  ? "right-2 top-3"
                  : "left-1/2 top-8 -translate-x-1/2"
            }`}
          >
            <div className={i === 0 ? "-rotate-[9deg]" : i === 1 ? "rotate-[9deg]" : ""}>
              <img
                src={p.image}
                alt=""
                loading="lazy"
                decoding="async"
                className={`float-soft h-16 w-16 rounded-2xl border border-white/20 object-cover shadow-[0_18px_36px_-14px_rgba(0,0,0,0.85)] ${
                  i === 2 ? "h-20 w-20" : ""
                }`}
                style={{ animationDelay: `${i * 1.2}s` }}
              />
            </div>
          </SceneItem>
        ))}
      </div>

      <h2 className="font-display text-[clamp(2rem,4.6vw,3.6rem)] font-extrabold leading-[1.03] tracking-[-0.03em] text-white">
        <SlideUpText
          as="span"
          split="characters"
          stagger={0.045}
          progress={progress}
          range={[0.05, 0.62]}
        >
          So… what are you craving?
        </SlideUpText>
      </h2>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60 sm:text-base">
        <SlideUpText
          as="span"
          split="words"
          stagger={0.06}
          progress={progress}
          range={[0.5, 0.85]}
        >
          {card.description}
        </SlideUpText>
      </p>

      <SceneItem enter="scale" slot={6}>
        <Link
          href="/shop"
          className="btn-ember mt-9 inline-flex cursor-pointer items-center gap-2 rounded-full px-9 py-4 font-display text-base font-extrabold"
        >
          Start shopping <ArrowRight size={17} strokeWidth={2.75} />
        </Link>
      </SceneItem>

      <HandwritingSvg
        text="Craavee"
        fontUrl="/fonts/IndieFlower-Regular.ttf"
        width={220}
        height={100}
        fontSize={48}
        strokeWidth={1.6}
        duration={1.6}
        delay={0.5}
        ease="easeInOut"
        className="pointer-events-none mt-6 h-auto w-28 text-white/35 sm:w-36"
      />
    </div>
  );
}

export default StackedCards;
