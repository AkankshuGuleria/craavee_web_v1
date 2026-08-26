"use client";

import { motion } from "motion/react";
import { Check } from "@phosphor-icons/react";
import { AdminShell } from "@/components/site/AdminShell";

const packingList = [
  {
    id: "#1084",
    items: [
      { name: "Tomato Hybrid (500 g)", qty: 1, packed: false },
      { name: "Potato (1 kg)", qty: 1, packed: false },
      { name: "Amul Taaza Milk", qty: 2, packed: true },
    ],
    location: "Green Park · Gate 2",
    priority: true,
  },
  {
    id: "#1081",
    items: [
      { name: "Whole Wheat Atta (5 kg)", qty: 1, packed: false },
      { name: "Farm Eggs (6-pack)", qty: 1, packed: false },
    ],
    location: "Model Town · Flat 4B",
    priority: false,
  },
];

export default function AdminPackingPage() {
  return (
    <AdminShell
      active="Packing"
      title="Packing queue"
      subtitle={`${packingList.length} orders waiting to be packed`}
    >
      <div className="max-w-2xl space-y-5">
        {packingList.map((order, index) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, ease: [0.34, 1.56, 0.64, 1] }}
            className={`clay-card p-5 ${
              order.priority ? "!border-l-4 !border-l-orange-400" : ""
            }`}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-display text-base font-extrabold text-white">
                  {order.id}
                </h3>
                {order.priority && (
                  <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-orange-300">
                    Priority
                  </span>
                )}
              </div>
              <span className="text-xs font-semibold text-white/45">
                {order.location}
              </span>
            </div>

            <div className="space-y-2">
              {order.items.map((item, itemIndex) => (
                <div
                  key={itemIndex}
                  className="flex items-center justify-between border-b border-dashed border-white/10 py-2 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`grid h-5 w-5 place-items-center rounded-md ${
                        item.packed
                          ? "bg-emerald-500 text-white"
                          : "border border-white/25"
                      }`}
                    >
                      {item.packed && <Check size={11} weight="bold" />}
                    </div>
                    <span
                      className={`text-sm ${
                        item.packed
                          ? "font-medium text-white/30 line-through"
                          : "font-semibold text-white/85"
                      }`}
                    >
                      {item.name}
                    </span>
                  </div>
                  <span className="text-xs font-bold tabular-nums text-white/50">x{item.qty}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button className="btn-clay cursor-pointer px-5 py-2 font-display text-xs font-bold">
                Mark as packed
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </AdminShell>
  );
}