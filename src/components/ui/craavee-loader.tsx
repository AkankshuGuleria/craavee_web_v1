"use client";

import { useCallback, useEffect, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { HandwritingSvg } from "./handwriting-svg";

const FONT_URL = "/fonts/IndieFlower-Regular.ttf";

/*
 * Timeline (seconds) — measured from the moment the wordmark path is ready,
 * so slow font loads can never cut the hero animation short. A fallback
 * force-starts the timeline if the font never resolves.
 */
const DRAW_DELAY = 0.35;
const DRAW_DURATION = 2.15;
const CAPTION_DELAY = 1.05;
const PROGRESS_DELAY = 1.0;
const PROGRESS_DURATION = 1.9;
const INTRO_TOTAL_MS = 3300;
const READY_FALLBACK_MS = 2500;

/* Reduced-motion timeline — every entrance completes before REDUCED_TOTAL_MS */
const R_CAPTION_DELAY = 0.15;
const R_ENTRANCE_DUR = 0.35;
const R_PROGRESS_VALUE_DELAY = 0.25;
const R_PROGRESS_VALUE_DUR = 0.6;
const REDUCED_TOTAL_MS = 1400;

const EXIT_DURATION = 0.65;

/* Deterministic particle field — fixed values keep SSR/client markup identical */
const PARTICLES = [
  { left: "12%", top: "66%", size: 4, dur: 9, delay: 0 },
  { left: "21%", top: "26%", size: 3, dur: 11, delay: 1.2 },
  { left: "79%", top: "72%", size: 5, dur: 8, delay: 0.6 },
  { left: "87%", top: "32%", size: 3, dur: 10, delay: 2 },
  { left: "50%", top: "15%", size: 2.5, dur: 12, delay: 0.9 },
  { left: "63%", top: "84%", size: 3, dur: 9.5, delay: 1.6 },
] as const;

export interface CraaveeLoaderProps {
  /** Fired once the intro timeline has fully played out. */
  onDone?: () => void;
  /** Fired when the user explicitly skips (Esc) — bypasses page-readiness waiting. */
  onSkip?: () => void;
}

export function CraaveeLoader({ onDone, onSkip }: CraaveeLoaderProps) {
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);

  /* Shared progress value drives both the bar and the % readout */
  const progress = useMotionValue(0);
  const pctText = useTransform(progress, (v) => `${Math.round(v * 100)}%`);
  const fillScale = useTransform(progress, [0, 1], [0, 1]);

  /* Never let a stalled font request freeze the intro */
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), READY_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, []);

  /* Master timeline starts only once the hero path is drawable */
  useEffect(() => {
    if (!ready) return;

    const controls = reduce
      ? animate(progress, 1, {
          delay: R_PROGRESS_VALUE_DELAY,
          duration: R_PROGRESS_VALUE_DUR,
          ease: "easeOut",
        })
      : animate(progress, 1, {
          delay: PROGRESS_DELAY,
          duration: PROGRESS_DURATION,
          ease: [0.65, 0, 0.35, 1],
        });

    const total = reduce ? REDUCED_TOTAL_MS : INTRO_TOTAL_MS;
    const doneTimer = window.setTimeout(() => {
      setLeaving(true);
      onDone?.();
    }, total);

    return () => {
      controls.stop();
      window.clearTimeout(doneTimer);
    };
  }, [onDone, progress, ready, reduce]);

  /* Esc is an explicit user skip — tear down via onSkip even if the page isn't ready */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setLeaving(true);
      if (onSkip) onSkip();
      else onDone?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone, onSkip]);

  const handleWordmarkReady = useCallback(() => setReady(true), []);

  return (
    <motion.div
      aria-busy="true"
      aria-label="Craavee is loading"
      className="fixed inset-0 z-[70] overflow-hidden bg-[#0a0c0e]"
      initial={{ opacity: 1 }}
      exit={
        reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, filter: "blur(10px)" }
      }
      transition={{ duration: EXIT_DURATION, ease: "easeInOut" }}
    >
      {/* ---- ambient light sources ------------------------------------- */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        style={{
          background:
            "radial-gradient(48% 42% at 18% 10%, rgba(255,249,239,0.09), transparent 64%)," +
            "radial-gradient(44% 40% at 85% 85%, rgba(232,163,61,0.12), transparent 62%)," +
            "radial-gradient(36% 30% at 72% 18%, rgba(52,211,153,0.05), transparent 60%)",
        }}
      />

      {/* slow drifting warm lights */}
      <motion.div
        aria-hidden
        className="absolute -left-40 top-[16%] h-[28rem] w-[28rem] rounded-full bg-[#f4d7a8]/[0.06] blur-[110px]"
        animate={{ x: [0, 26, 0], y: [0, -22, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute -right-32 bottom-[8%] h-[24rem] w-[24rem] rounded-full bg-[#ff8a3d]/[0.07] blur-[100px]"
        animate={{ x: [0, -20, 0], y: [0, 18, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* ---- orbit ring -------------------------------------------------- */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <motion.div
          className="relative h-[300px] w-[300px] rounded-full border border-white/[0.07] sm:h-[420px] sm:w-[420px]"
          animate={{ rotate: 360 }}
          transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
        >
          <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f4d7a8] shadow-[0_0_12px_2px_rgba(244,215,168,0.45)]" />
        </motion.div>
      </div>

      {/* ---- glass sphere (tablet/desktop) ------------------------------- */}
      <motion.div
        aria-hidden
        className="absolute right-[9%] top-[17%] hidden sm:block"
        animate={{ y: [0, -14, 0], rotate: [0, 4, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      >
        <div
          className="h-24 w-24 rounded-full border border-white/15 lg:h-28 lg:w-28"
          style={{
            background:
              "radial-gradient(circle at 31% 27%, rgba(255,255,255,0.5), rgba(255,255,255,0.06) 42%, rgba(255,255,255,0.015) 70%)",
            boxShadow:
              "inset 0 1px 1px rgba(255,255,255,0.45), inset 0 -22px 34px rgba(232,163,61,0.10), 0 34px 70px -28px rgba(0,0,0,0.7)",
          }}
        />
      </motion.div>

      {/* ---- warm clay pebble (tablet/desktop) --------------------------- */}
      <motion.div
        aria-hidden
        className="absolute bottom-[21%] left-[8%] hidden sm:block"
        animate={{ y: [0, -10, 0], rotate: [-6, 2, -6] }}
        transition={{ duration: 7.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <div
          className="h-11 w-16 rounded-[18px] lg:h-12 lg:w-[4.5rem]"
          style={{
            background: "linear-gradient(145deg, #ffd9ae 0%, #e8a33d 100%)",
            boxShadow:
              "inset 0 2px 2px rgba(255,255,255,0.55), inset 0 -4px 6px rgba(120,70,20,0.25), 0 22px 44px -18px rgba(232,163,61,0.45)",
          }}
        />
      </motion.div>

      {/* ---- particle dust ------------------------------------------------ */}
      {PARTICLES.map((p, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute rounded-full bg-white/50"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -20, 0],
            opacity: [0.18, 0.6, 0.18],
          }}
          transition={{
            duration: p.dur,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* ---- center stage -------------------------------------------------- */}
      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <HandwritingSvg
            text="Craavee"
            fontUrl={FONT_URL}
            width={420}
            height={180}
            fontSize={92}
            strokeWidth={1.6}
            duration={reduce ? 0.01 : DRAW_DURATION}
            delay={reduce ? 0 : DRAW_DELAY}
            ease="easeInOut"
            onReady={handleWordmarkReady}
            className="h-auto w-[min(76vw,420px)] text-[#fff9ef] drop-shadow-[0_0_30px_rgba(244,215,168,0.22)]"
          />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={
            ready || reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }
          }
          transition={{
            delay: reduce ? R_CAPTION_DELAY : CAPTION_DELAY,
            duration: reduce ? R_ENTRANCE_DUR : 0.7,
            ease: "easeOut",
          }}
          className="mt-3 text-sm tracking-wide text-white/55 sm:text-[15px]"
        >
          Fresh things are on the way.
        </motion.p>

        {/* progress */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={ready || reduce ? { opacity: 1 } : { opacity: 0 }}
          transition={{
            delay: reduce ? R_CAPTION_DELAY : PROGRESS_DELAY,
            duration: reduce ? R_ENTRANCE_DUR : 0.6,
          }}
          className="mt-12 flex w-[min(62vw,230px)] items-center gap-4"
        >
          <div className="h-px flex-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[#f4d7a8] to-[#ff8a3d]"
              style={{ scaleX: fillScale }}
            />
          </div>
          <motion.span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/50">
            {pctText}
          </motion.span>
        </motion.div>
      </div>

      {/* texture + skip hint */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving || reduce ? 0 : 0.28 }}
        transition={{ delay: reduce ? 0 : 1.6, duration: 0.6 }}
        className="absolute inset-x-0 bottom-6 hidden text-center text-[10px] uppercase tracking-[0.2em] text-white sm:block"
      >
        Press esc to skip
      </motion.p>
    </motion.div>
  );
}

export default CraaveeLoader;
