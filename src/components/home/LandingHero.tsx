"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight, Search, Zap } from "lucide-react";
import { PremiumButtonLink } from "@/components/ui/premium-button";
import { useIntroDone } from "@/components/layout/craavee-intro-gate";
import { CraaveeLiquidHeading } from "@/components/ui/craavee-liquid-heading";
import { useMotionReduced } from "@/hooks/use-motion-preference";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}
export function LandingHero({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const introDone = useIntroDone();
  const reduce = useMotionReduced();
  const rootRef = useRef<HTMLElement>(null);
  const enterRef = useRef<gsap.core.Timeline | null>(null);

  /*
   * ONE GSAP context owns the whole hero scene:
   *   ENTRANCE — time-based timeline (paused), played the moment the
   *              loading screen hands over. Badge → line1 → line2 →
   *              description → CTAs → search → products → cue.
   *   EXIT     — one scrubbed ScrollTrigger timeline mapped to hero scroll:
   *              cue dies first, badge lifts away, line2 exits before
   *              line1, description/CTAs/search peel off in layers.
   * Ownership: GSAP writes transform/opacity only; Motion is not used
   * here, so nothing fights over the same properties.
   */
  useEffect(() => {
    if (reduce) return;
    const root = rootRef.current;
    if (!root) return;

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);

      /* ---- ENTRANCE (played after loader hand-off) ---- */
      const enter = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.out" },
      });
      enter
        .fromTo(
          q('[data-hero="badge"]'),
          { opacity: 0, y: 18 },
          { opacity: 1, y: 0, duration: 0.6 },
          0
        )
        .fromTo(
          q('[data-hero="line1"]'),
          { opacity: 0, y: 44 },
          { opacity: 1, y: 0, duration: 0.9 },
          0.12
        )
        .fromTo(
          q('[data-hero="line2"]'),
          { opacity: 0, y: 44, scale: 0.985 },
          { opacity: 1, y: 0, scale: 1, duration: 0.9 },
          0.26
        )
        .fromTo(
          q('[data-hero="desc"]'),
          { opacity: 0, y: 26 },
          { opacity: 1, y: 0, duration: 0.7 },
          0.42
        )
        .fromTo(
          q('[data-hero="ctas"]'),
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.6 },
          0.54
        )
        .fromTo(
          q('[data-hero="search"]'),
          { opacity: 0, y: 15 },
          { opacity: 1, y: 0, duration: 0.6 },
          0.66
        );

      enter.fromTo(
        q('[data-hero="cue"]'),
        { opacity: 0 },
        { opacity: 1, duration: 0.7 },
        1.25
      );
      enterRef.current = enter;

      /* ---- EXIT + DRIFT (scroll-scrubbed) ---- */
      const exit = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: root,
          start: "top top",
          end: "bottom top",
          scrub: 0.5,
        },
      });
      exit
        .to(q('[data-hero="cue"]'), { opacity: 0, duration: 0.07 }, 0)
        .to(q('[data-hero="badge"]'), { opacity: 0, y: -14, duration: 0.3 }, 0.06)
        .to(
          q('[data-hero="line2"]'),
          { opacity: 0, y: -36, scale: 1.015, duration: 0.45 },
          0.14
        )
        .to(q('[data-hero="line1"]'), { opacity: 0, y: -30, duration: 0.45 }, 0.24)
        .to(q('[data-hero="desc"]'), { opacity: 0, y: -22, duration: 0.4 }, 0.32)
        .to(q('[data-hero="ctas"]'), { opacity: 0, y: 12, duration: 0.35 }, 0.4)
        .to(q('[data-hero="search"]'), { opacity: 0, y: 15, duration: 0.35 }, 0.48);

      ScrollTrigger.refresh();
    }, root);

    return () => ctx.revert();
  }, [reduce]);

  /* Play the entrance exactly when the loader hands over. */
  useEffect(() => {
    if (reduce) return;
    if (introDone) enterRef.current?.play();
    else enterRef.current?.pause(0);
  }, [introDone, reduce]);

  return (
    <section
      ref={rootRef}
      aria-label="Craavee hero"
      className="relative flex min-h-[100svh] items-center overflow-hidden px-5 pb-20 pt-32 sm:px-8"
    >
      {/* ---- local ambient glows (pre-softened gradients, no filter) ---- */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-[22%] h-[30rem] w-[30rem]"
        style={{
          background:
            "radial-gradient(circle at center, rgba(249,115,22,0.13), transparent 68%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 bottom-[6%] h-[26rem] w-[26rem]"
        style={{
          background:
            "radial-gradient(circle at center, rgba(99,102,241,0.14), transparent 68%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[38%] top-[8%] h-[16rem] w-[16rem]"
        style={{
          background:
            "radial-gradient(circle at center, rgba(244,63,94,0.09), transparent 70%)",
        }}
      />

      {/* ---- copy block -------------------------------------------------- */}
      <div className="relative z-10 mx-auto w-full max-w-2xl text-center">
        <div className="flex flex-col items-center">
          <span
            data-hero="badge"
            className="mb-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.22em] text-sky-200 sm:mb-14"
          >
            <Zap size={12} className="text-amber-300" strokeWidth={3} />
            10-minute delivery
          </span>

          <h1
            aria-label="Crave it now. At your door in 10."
            className="[font-family:var(--font-grotesk),var(--font-display),sans-serif] text-[clamp(2.8rem,7.6vw,6rem)] font-bold leading-[1.02] tracking-[-0.035em] text-white"
          >
            <span data-hero="line1" className="block">
              Crave it now.
            </span>
            <span data-hero="line2" className="mt-1 block">
              <CraaveeLiquidHeading
                as="span"
                texts={[
                  "At your door in 10.",
                  "Midnight cravings.",
                  "Fresh stuff.",
                  "Snacks. Drinks. Groceries.",
                ]}
                active={introDone}
                sizeClassName="text-[clamp(2.6rem,7.2vw,5.6rem)] h-[1.08em]"
                className="text-gradient-craavee italic tracking-[-0.03em]"
              />
            </span>
          </h1>

          <p
            data-hero="desc"
            className="mt-7 max-w-lg text-base leading-relaxed text-white/60 sm:mt-8 sm:text-lg"
          >
            Fresh groceries, snacks, drinks and everything you crave — picked
            and packed the moment you tap, delivered before the craving
            changes.
          </p>

          <div
            data-hero="ctas"
            className="mt-9 flex flex-wrap items-center justify-center gap-3.5 sm:mt-10"
          >
            <PremiumButtonLink href="/shop" size="lg">
              Order Now
              <ArrowRight size={18} strokeWidth={2.75} />
            </PremiumButtonLink>
            <PremiumButtonLink href="/#categories" variant="ghost" size="lg">
              Explore Products
            </PremiumButtonLink>
          </div>

          {onOpenSearch && (
            <button
              data-hero="search"
              onClick={onOpenSearch}
              aria-label="Search snacks, drinks and groceries"
              className="group mx-auto mt-8 flex w-full max-w-md cursor-pointer items-center gap-3 rounded-full border border-white/15 bg-white/[0.12] px-5 py-3.5 text-left transition-[background-color,border-color] duration-300 hover:border-white/35 hover:bg-white/[0.16]"
            >
              <Search
                size={17}
                strokeWidth={2.5}
                className="shrink-0 text-white/50 transition-colors group-hover:text-sky-300"
              />
              <span className="flex-1 truncate text-sm font-medium text-white/45">
                What are you craving?
              </span>
              <kbd className="hidden shrink-0 items-center gap-1 rounded-md border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] font-bold text-white/45 sm:flex">
                ⌘K
              </kbd>
            </button>
          )}
        </div>
      </div>

      {/* scroll cue — fades as soon as scrolling starts */}
      <div
        data-hero="cue"
        aria-hidden
        className="absolute inset-x-0 bottom-6 z-10 flex justify-center"
      >
        <div className="flex h-9 w-5 items-start justify-center rounded-full border border-white/20 p-1.5">
          <span
            className="h-1.5 w-1 rounded-full bg-white/60"
            style={{
              animation: "float-soft 1.8s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </section>
  );
}

export default LandingHero;
