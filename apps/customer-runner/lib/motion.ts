/**
 * Motion, and the one hook that makes it respectful.
 *
 * `useReducedMotion` is not a nicety: vestibular disorders are common
 * enough that an app which ignores the OS setting is inaccessible, and
 * both platforms expose it. Every animated primitive in this app routes
 * through `useMotion()` so a screen cannot forget to check.
 *
 * Durations collapse to `instant` (1ms) rather than 0 — a zero-length
 * animation can be dropped mid-flight by the driver, leaving a
 * half-applied transform.
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { motion } from "@craavee/tokens";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Durations already adjusted for the user's preference. */
export function useMotion() {
  const reduced = useReducedMotion();
  const d = motion.duration;
  return {
    reduced,
    fast: reduced ? d.instant : d.fast,
    normal: reduced ? d.instant : d.normal,
    slow: reduced ? d.instant : d.slow,
    /** Press scale collapses to 1 — no movement at all under reduced motion. */
    pressScale: reduced ? 1 : motion.pressScale,
    spring: motion.spring,
  };
}
