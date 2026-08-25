"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { ArrowLeft, MapPin, Package, Check } from "@phosphor-icons/react";

const items = [
  { name: "Tomato Hybrid (500 g)", qty: 1, note: "" },
  { name: "Potato (1 kg)", qty: 1, note: "" },
  { name: "Instant Noodle Cup", qty: 1, note: "Extra spicy" },
];

export default function RunnerActiveJobPage() {
  return (
    <main className="min-h-[100dvh]  pb-24">
      <header className="glass-bar sticky top-0 z-50">
        <div className="mx-auto flex max-w-md items-center justify-between px-5 py-3.5">
          <Link
            href="/queue"
            aria-label="Back to queue"
            className="grid h-10 w-10 place-items-center rounded-xl border-2 border-white bg-white text-neutral-700 shadow-[3px_4px_12px_-4px_rgba(21,94,54,0.18)] active:scale-95"
          >
            <ArrowLeft size={18} weight="bold" />
          </Link>
          <h1 className="font-display text-lg font-extrabold tracking-tight text-neutral-900">
            Active job
          </h1>
          <div className="w-10" />
        </div>
      </header>

      <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="clay-card p-6 text-center"
        >
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-green-100 text-green-700 float-soft">
            <MapPin weight="bold" size={26} />
          </div>
          <h2 className="font-display text-2xl font-extrabold text-neutral-900">
            Green Park · Gate 2
          </h2>
          <p className="mt-1 text-xs font-semibold text-neutral-400">
            Order #1084 · 3 items
          </p>
          <span className="mt-3 inline-block rounded-full bg-green-50 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-green-700">
            In progress
          </span>
        </motion.div>

        <div className="space-y-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-neutral-400">
            Items to pick up
          </h3>
          {items.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.08 }}
              className="flex items-center justify-between clay-card p-4"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-green-50 text-green-700">
                  <Package size={16} weight="bold" />
                </span>
                <div>
                  <p className="text-sm font-bold text-neutral-800">{item.name}</p>
                  {item.note && (
                    <p className="mt-0.5 text-xs font-medium text-orange-500">
                      Note: {item.note}
                    </p>
                  )}
                </div>
              </div>
              <span className="font-display text-sm font-extrabold text-neutral-900">
                x{item.qty}
              </span>
            </motion.div>
          ))}
        </div>

        <div className="mt-2 flex gap-3">
          <button className="flex-1 cursor-pointer rounded-full border-2 border-neutral-200 bg-white px-4 py-3 font-display text-sm font-bold text-neutral-700 shadow-[3px_4px_12px_-5px_rgba(21,94,54,0.15)] transition-all hover:border-neutral-300 active:scale-[0.97]">
            Mark picked up
          </button>
          <button className="btn-clay flex-1 px-4 py-3 font-display text-sm font-bold">
            <span className="inline-flex items-center justify-center gap-1.5">
              <Check size={15} weight="bold" /> Delivered
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}