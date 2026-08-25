"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  MapPin,
  Phone,
  Lightning,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Reveal } from "@/components/interactive";
import { useAddress } from "@/components/providers";
import { formatShort } from "@/components/address/AddressSheet";

const stages = [
  { id: 1, label: "Placed", desc: "Order received" },
  { id: 2, label: "Packed", desc: "Being packed" },
  { id: 3, label: "Assigned", desc: "Runner assigned" },
  { id: 4, label: "Picked up", desc: "Runner grabbed it" },
  { id: 5, label: "Delivered", desc: "At your address" },
];

export default function TrackOrderPage() {
  const { address } = useAddress();
  const reduce = useReducedMotion();
  const [eta, setEta] = useState(380);
  const [currentStage, setCurrentStage] = useState(3);

  useEffect(() => {
    const t = setInterval(() => {
      setEta((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const progressPct = ((currentStage - 1) / (stages.length - 1)) * 100;
  const mm = Math.floor(eta / 60);
  const ss = eta % 60;

  return (
    <main className="min-h-[100dvh]  pb-24">
      <header className="glass-bar sticky top-0 z-50">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link
            href="/shop"
            aria-label="Back"
            className="grid h-10 w-10 place-items-center rounded-xl border-2 border-white bg-white text-neutral-700 shadow-[3px_4px_12px_-4px_rgba(21,94,54,0.18)] transition-transform active:scale-95"
          >
            <ArrowLeft size={18} weight="bold" />
          </Link>
          <h1 className="font-display text-lg font-extrabold tracking-tight text-neutral-900">
            Live tracking
          </h1>
          <div className="w-10" />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 pt-6 sm:px-8">
        {/* hero ETA card — 3D tilt scene */}
        <Reveal>
          <div className="tilt-scene">
            <div className="clay-card relative overflow-hidden p-6 tilt-card-3d">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-green-100 blur-2xl"
              />
              <div className="relative flex items-center gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-green-600 text-white shadow-[0_10px_24px_-8px_rgba(22,163,74,0.6)] float-soft">
                  <Lightning weight="fill" size={26} />
                </span>
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                    Arriving in
                  </p>
                  <p className="font-display text-3xl font-extrabold tabular-nums leading-none text-neutral-900">
                    {mm}:{ss.toString().padStart(2, "0")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                    Status
                  </p>
                  <p className="inline-flex items-center gap-1.5 text-sm font-bold text-green-700">
                    <span className="relative flex h-2.5 w-2.5">
                      {!reduce && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      )}
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
                    </span>
                    On its way
                  </p>
                </div>
              </div>
              <div className="relative mt-5 flex items-center gap-1.5 border-t-2 border-dashed border-neutral-200/70 pt-4 text-xs font-medium text-neutral-500">
                <MapPin size={14} weight="fill" className="shrink-0 text-green-600" />
                {address
                  ? `${address.label} · ${formatShort(address)}`
                  : "Delivering to your address"}
              </div>
            </div>
          </div>
        </Reveal>

        {/* stepper */}
        <div className="relative mt-6">
          <div className="absolute bottom-9 left-[19px] top-9 w-1 rounded-full bg-neutral-200/80" />
          <motion.div
            className="absolute left-[19px] top-9 w-1 rounded-full bg-gradient-to-b from-green-500 to-green-600"
            initial={{ height: 0 }}
            animate={{ height: `${progressPct}%` }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          />

          <div className="space-y-5">
            {stages.map((stage, index) => {
              const completed = index < currentStage;
              const active = index === currentStage - 1;
              return (
                <motion.div
                  key={stage.id}
                  initial={reduce ? false : { opacity: 0, x: -18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: reduce ? 0 : index * 0.08 }}
                  className="flex items-start gap-4"
                >
                  <div
                    className={`relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all ${
                      completed
                        ? "bg-green-600 text-white shadow-[0_8px_18px_-6px_rgba(22,163,74,0.55)]"
                        : "border-2 border-white bg-white text-neutral-300 shadow-[3px_4px_12px_-4px_rgba(21,94,54,0.15)]"
                    } ${active ? "scale-110 ring-4 ring-green-200" : ""}`}
                  >
                    {completed ? <Check size={17} weight="bold" /> : stage.id}
                  </div>
                  <div className={`pt-1.5 ${active ? "-translate-y-px" : ""}`}>
                    <h3
                      className={`font-display text-sm ${
                        completed || active
                          ? "font-extrabold text-neutral-900"
                          : "font-semibold text-neutral-400"
                      }`}
                    >
                      {stage.label}
                    </h3>
                    <p
                      className={`mt-0.5 text-xs ${
                        active ? "font-semibold text-green-700" : "text-neutral-400"
                      }`}
                    >
                      {stage.desc}
                    </p>
                  </div>
                  {active && (
                    <span className="ml-auto mt-2 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-green-700">
                      Now
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* runner card */}
        <Reveal delay={0.15}>
          <div className="glass-card mt-6 flex items-center gap-4 p-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-green-500 to-green-700 text-lg font-black text-white shadow-[0_8px_18px_-6px_rgba(22,163,74,0.5)]">
              A
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-neutral-900">Alex M.</h3>
              <p className="text-xs text-neutral-500">Your runner · on the way</p>
            </div>
            <button
              aria-label="Call runner"
              className="cursor-pointer rounded-full border-2 border-green-600/70 bg-white px-4 py-2 text-xs font-bold text-green-700 transition-all hover:bg-green-600 hover:text-white active:scale-95"
            >
              <span className="inline-flex items-center gap-1.5">
                <Phone size={13} weight="bold" /> Call
              </span>
            </button>
          </div>
        </Reveal>
      </div>
    </main>
  );
}