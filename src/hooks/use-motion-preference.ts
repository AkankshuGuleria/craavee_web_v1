"use client";

import { useEffect, useState } from "react";

export type MotionPreference = "reduce" | "full";

const OVERRIDE_KEY = "craavee-motion";

/**
 * Resolved site-wide motion preference:
 *   1. localStorage override  (`craavee-motion = "on" | "off"`)
 *   2. OS `prefers-reduced-motion`
 *
 * Hydration-safe: always starts as "not reduced" so server and first
 * client render agree, then settles after mount. Also mirrors the final
 * decision onto <html data-motion="…"> so CSS can key off it.
 */
export function useMotionReduced(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resolve = () => {
      let override: string | null = null;
      try {
        override = window.localStorage.getItem(OVERRIDE_KEY);
      } catch {
        /* private mode */
      }

      let next: MotionPreference;
      if (override === "on") next = "full";
      else if (override === "off") next = "reduce";
      else next = mq.matches ? "reduce" : "full";

      setReduced(next === "reduce");
      document.documentElement.dataset.motion = next;
    };

    resolve();

    const onStorage = (e: StorageEvent) => {
      if (e.key === OVERRIDE_KEY) resolve();
    };
    const onChange = (e: MediaQueryListEvent) => resolve();

    mq.addEventListener("change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return reduced;
}

/** Imperative helper for non-hook contexts. */
export function setMotionOverride(mode: "on" | "off" | null) {
  try {
    if (mode === null) window.localStorage.removeItem(OVERRIDE_KEY);
    else window.localStorage.setItem(OVERRIDE_KEY, mode);
  } catch {
    /* ignore */
  }
}
