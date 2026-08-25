"use client";

import { motion } from "motion/react";
import { Lightning, Clock, User, Warning } from "@phosphor-icons/react";
import { AdminShell } from "@/components/site/AdminShell";
import { cn } from "@/lib/utils";

const metrics = [
  { label: "Orders / hr", value: "42", change: "+12%", icon: Lightning, warning: false },
  { label: "Avg fulfillment", value: "8m", change: "", icon: Clock, warning: false },
  { label: "Active runners", value: "5", change: "", icon: User, warning: false },
  { label: "Queue depth", value: "12", change: "Near capacity", icon: Warning, warning: true },
];

const kanbanColumns = [
  {
    id: "placed",
    title: "Placed",
    count: 3,
    orders: [{ id: "#1084", items: "2x Tomato, 1x Atta", time: "1m ago", priority: true }],
  },
  {
    id: "packed",
    title: "Packed",
    count: 2,
    orders: [{ id: "#1081", items: "1x Milk, 1x Eggs", time: "6m ago", priority: false }],
  },
  {
    id: "assigned",
    title: "Assigned",
    count: 1,
    orders: [{ id: "#1078", items: "3x Banana", time: "3m ago", priority: false }],
  },
  {
    id: "picked-up",
    title: "Picked Up",
    count: 2,
    orders: [{ id: "#1075", items: "1x Frozen Pizza", time: "12m ago", priority: false }],
  },
  {
    id: "delivered",
    title: "Delivered",
    count: 4,
    orders: [{ id: "#1070", items: "2x Sparkling Water", time: "25m ago", priority: false }],
  },
];

export default function AdminLiveOpsPage() {
  return (
    <AdminShell
      active="Live Ops"
      title="Live Ops"
      subtitle="Real-time operations board"
    >
      <section className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06, ease: [0.34, 1.56, 0.64, 1] }}
            className={cn(
              "clay-card p-4",
              metric.warning && "!border-orange-200 !bg-gradient-to-br !from-orange-50 !to-white"
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-semibold text-neutral-500">
                <metric.icon size={15} weight="bold" /> {metric.label}
              </span>
              {metric.change && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                    metric.warning ? "bg-orange-100 text-orange-600" : "bg-green-50 text-green-700"
                  )}
                >
                  {metric.change}
                </span>
              )}
            </div>
            <div className="font-display text-3xl font-extrabold text-neutral-900">
              {metric.value}
            </div>
          </motion.div>
        ))}
      </section>

      <section className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
        {kanbanColumns.map((column, index) => (
          <motion.div
            key={column.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className="flex w-72 shrink-0 flex-col gap-3"
          >
            <div className="flex items-center justify-between px-2 py-1">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-neutral-500">
                {column.title}
              </h3>
              <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-extrabold text-white">
                {column.count}
              </span>
            </div>
            <div className="flex min-h-[380px] flex-1 flex-col gap-3 rounded-3xl bg-neutral-100/70 p-3">
              {column.orders.map((order) => (
                <div
                  key={order.id}
                  className={cn(
                    "cursor-pointer rounded-2xl border-2 border-white bg-white p-4 shadow-[4px_6px_14px_-6px_rgba(21,94,54,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[6px_10px_22px_-8px_rgba(21,94,54,0.25)]",
                    order.priority && "border-l-4 border-l-orange-400"
                  )}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <span className="font-display text-sm font-extrabold text-green-700">
                      {order.id}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-neutral-400">
                      <Clock size={11} weight="bold" /> {order.time}
                    </span>
                  </div>
                  <p className="mb-3 line-clamp-2 text-xs font-medium text-neutral-700">
                    {order.items}
                  </p>
                  <div className="flex items-center justify-between border-t-2 border-dashed border-neutral-100 pt-2">
                    <span className="text-[10px] font-semibold text-neutral-400">
                      Awaiting runner
                    </span>
                    <button className="btn-clay cursor-pointer px-3 py-1 text-[10px] font-bold">
                      Assign
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </section>
    </AdminShell>
  );
}