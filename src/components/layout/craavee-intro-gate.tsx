"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AnimatePresence } from "motion/react";
import { CraaveeLoader } from "@/components/ui/craavee-loader";

/* --------------------------------------------------------------------- */
/* Intro context — lets below-the-fold content (hero) hold its entrance   */
/* until the loader hands over, so nothing animates unseen.               */
/* --------------------------------------------------------------------- */
const IntroContext = createContext<{ done: boolean }>({ done: false });

export function useIntroDone(): boolean {
  return useContext(IntroContext).done;
}

/**
 * Plays the Craavee intro once per full page load, then reveals the app
 * underneath. The loader leaves only when BOTH the intro timeline finished
 * AND the page is ready (or a hard cap prevents an endless wait).
 */
export function CraaveeIntroGate({ children }: { children: React.ReactNode }) {
  const [introDone, setIntroDone] = useState(false);
  const [pageReady, setPageReady] = useState(false);

  /* Track real page readiness */
  useEffect(() => {
    if (document.readyState === "complete") {
      setPageReady(true);
      return;
    }
    const onLoad = () => setPageReady(true);
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  /* Hard cap — never let a stalled resource trap the user */
  useEffect(() => {
    const t = window.setTimeout(() => setPageReady(true), 6000);
    return () => window.clearTimeout(t);
  }, []);

  const handleIntroDone = useCallback(() => setIntroDone(true), []);

  /* Explicit user skip: reveal immediately, same as the hard cap */
  const handleSkip = useCallback(() => {
    setIntroDone(true);
    setPageReady(true);
  }, []);

  const show = !(introDone && pageReady);

  /* Lock scrolling while the intro is on screen */
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show]);

  return (
    <>
      <AnimatePresence>
        {show && (
          <CraaveeLoader onDone={handleIntroDone} onSkip={handleSkip} />
        )}
      </AnimatePresence>
      <IntroContext.Provider value={{ done: !show }}>
        {children}
      </IntroContext.Provider>
    </>
  );
}

export default CraaveeIntroGate;
