"use client";

import React, { useEffect, useRef } from "react";
import {
  motion,
  useMotionValue,
  useMotionTemplate,
  useSpring,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* CursorGlow — ambient radial highlight that tracks the pointer.      */
/* Uses motion values only (no React re-render per frame).            */
/* ------------------------------------------------------------------ */
export function CursorGlow() {
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const sx = useSpring(x, { stiffness: 120, damping: 22, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 120, damping: 22, mass: 0.4 });
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const onMove = (e: MouseEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [reduce, x, y]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[60] h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        x: sx,
        y: sy,
        background:
          "radial-gradient(circle, rgba(34,197,94,0.16), rgba(134,239,172,0.07) 40%, transparent 70%)",
        filter: "blur(28px)",
        opacity: reduce ? "0" : "1",
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Magnetic — wraps any element so it drifts toward the pointer.      */
/* ------------------------------------------------------------------ */
export function Magnetic({
  children,
  className,
  strength = 0.3,
}: {
  children: React.ReactNode;
  className?: string;
  strength?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 160, damping: 14, mass: 0.3 });
  const y = useSpring(0, { stiffness: 160, damping: 14, mass: 0.3 });
  const reduce = useReducedMotion();

  const onMove = (e: React.MouseEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x, y }}
      className={cn("inline-flex", className)}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* TiltCard — 3D perspective tilt on pointer move + glare sweep.     */
/* ------------------------------------------------------------------ */
export function TiltCard({
  children,
  className,
  intensity = 12,
  glare = true,
}: {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
  glare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(0, { stiffness: 150, damping: 18, mass: 0.4 });
  const ry = useSpring(0, { stiffness: 150, damping: 18, mass: 0.4 });
  const px = useMotionValue(50);
  const py = useMotionValue(50);
  const reduce = useReducedMotion();

  const glareBg = useMotionTemplate`radial-gradient(circle at ${px}% ${py}%, rgba(34,197,94,0.20), rgba(134,239,172,0.10) 38%, transparent 60%)`;

  const onMove = (e: React.MouseEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    ry.set((nx - 0.5) * intensity * 2);
    rx.set((0.5 - ny) * intensity * 2);
    px.set(nx * 100);
    py.set(ny * 100);
  };
  const reset = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{
        rotateX: rx,
        rotateY: ry,
        transformPerspective: 1100,
        transformStyle: "preserve-3d",
      }}
      className={cn("relative will-change-transform", className)}
    >
      {children}
      {glare && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-70"
          style={{ background: glareBg }}
        />
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Reveal — spring entrance as the element enters the viewport.       */
/* ------------------------------------------------------------------ */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 28,
  amount = 0.25,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  amount?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* StickyStack — cards pin and stack on top of each other on scroll,  */
/* each popping in with a 3D spring as it arrives.                    */
/* ------------------------------------------------------------------ */
export function StickyStack({ items }: { items: React.ReactNode[] }) {
  return (
    <div className="relative">
      {items.map((item, i) => (
        <div
          key={i}
          className="sticky top-[12vh]"
          style={{ zIndex: i + 1 }}
        >
          <motion.div
            initial={{ opacity: 0, y: 70, scale: 0.92 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: false, amount: 0.45 }}
            transition={{ type: "spring", stiffness: 90, damping: 18 }}
            className="will-change-transform"
          >
            {item}
          </motion.div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SpotlightCard — cursor-tracked radial highlight (CSS ::before)      */
/* ------------------------------------------------------------------ */
export function SpotlightCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div ref={ref} onMouseMove={onMove} className={cn("spotlight-card", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* useMouseParallax — spring-smoothed pointer offset (-0.5 … 0.5)      */
/* ------------------------------------------------------------------ */
export function useMouseParallax(enabled = true) {
  const mx = useSpring(0, { stiffness: 60, damping: 20, mass: 0.6 });
  const my = useSpring(0, { stiffness: 60, damping: 20, mass: 0.6 });

  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const onMove = (e: MouseEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5);
      my.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [enabled, mx, my]);

  return { mx, my };
}

/* ------------------------------------------------------------------ */
/* ScrollProgress — thin ember bar tied to page scroll (top of page). */
/* ------------------------------------------------------------------ */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <motion.div
      aria-hidden
      className="fixed left-0 top-0 z-[70] h-0.5 w-full origin-left bg-green-600"
      style={{ scaleX }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Float — gentle perpetual hover (for icons/visuals). Honors reduce. */
/* ------------------------------------------------------------------ */
export function useFloat(duration = 4): MotionValue<number> {
  const reduce = useReducedMotion();
  const y = useSpring(0, { stiffness: 40, damping: 12 });
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      const p = (t - start) / 1000;
      y.set(Math.sin(p * (Math.PI * 2) / duration) * 10);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduce, duration, y]);
  return y;
}
