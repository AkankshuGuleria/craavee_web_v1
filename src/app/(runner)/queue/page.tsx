"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { User, Bell, MapPin, Package, Clock } from "@phosphor-icons/react";

const jobs = [
  { id: 1, location: "Green Park · Gate 2", items: 3, status: "Waiting 5m", urgent: true },
  { id: 2, location: "Model Town · Flat 4B", items: 1, status: "Packed now", urgent: false },
  { id: 3, location: "Civil Lines · Desk 12", items: 6, status: "Packed now", urgent: false },
  { id: 4, location: "Sarabha Nagar · Room 9", items: 2, status: "Just packed", urgent: false },
];

export default function RunnerQueuePage() {
  return (
    <main className="min-h-[100dvh]  pb-24">
      <header className="glass-bar sticky top-0 z-50">
        <div className="mx-auto flex max-w-md items-center justify-between px-5 py-3.5">
          <button
            aria-label="Profile"
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl border-2 border-white bg-white text-neutral-700 shadow-[3px_4px_12px_-4px_rgba(21,94,54,0.18)] active:scale-95"
          >
            <User size={18} weight="bold" />
          </button>
          <h1 className="font-display text-lg font-extrabold tracking-tight text-neutral-900">
            Runner queue
          </h1>
          <button
            aria-label="Notifications"
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl border-2 border-white bg-white text-neutral-700 shadow-[3px_4px_12px_-4px_rgba(21,94,54,0.18)] active:scale-95"
          >
            <Bell size={18} weight="bold" />
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-md flex-col gap-3 px-5 pt-6">
        <div className="mb-2 flex items-end justify-between">
          <div>
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-neutral-900">
              Available jobs
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-bold text-green-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600" />
              </span>
              You're online
            </p>
          </div>
          <span className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-extrabold text-white">
            {jobs.length} pending
          </span>
        </div>

        {jobs.map((job, index) => (
          <motion.div
            key={job.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, ease: [0.34, 1.56, 0.64, 1] }}
            className={`clay-card p-4 ${
              job.urgent ? "!border-l-4 !border-l-orange-400" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <MapPin size={15} weight="fill" className="shrink-0 text-green-600" />
                  <span className="truncate font-display text-base font-extrabold text-neutral-900">
                    {job.location}
                  </span>
                </div>
                <div
                  className={`flex items-center gap-1.5 text-xs font-semibold ${
                    job.urgent ? "text-orange-600" : "text-neutral-400"
                  }`}
                >
                  <Clock size={13} weight="bold" />
                  {job.status}
                </div>
              </div>
              <Link
                href="/active"
                className="btn-clay shrink-0 px-4 py-2 font-display text-xs font-bold"
              >
                Claim
              </Link>
            </div>
            <div className="mt-3 flex items-center gap-1.5 border-t-2 border-dashed border-neutral-100 pt-2.5 text-[11px] font-semibold text-neutral-500">
              <Package size={12} weight="bold" /> {job.items} item
              {job.items > 1 ? "s" : ""} to pick up
            </div>
          </motion.div>
        ))}
      </div>
    </main>
  );
}