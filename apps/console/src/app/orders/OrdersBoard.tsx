"use client";

// The Console operations board. Visuals are unchanged from Phase 2B —
// same OpsShell, same metric cards, same kanban columns, same motion.
// What changed in Phase 8 is only where the numbers come from: they are
// now derived from real `orders` rows (§21: "metrics must remain derived
// from authoritative data") instead of the hardcoded placeholders this
// file carried, and the board refreshes live via D21 Realtime.
import { motion } from "motion/react";
import { Lightning, Clock, User, Warning } from "@phosphor-icons/react/ssr";
import { OpsShell, cn } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";
import { RealtimeRefresh } from "@/lib/realtime/RealtimeRefresh";

export interface BoardOrder { id: string; items: string; time: string; priority: boolean }
export interface BoardColumn { id: string; title: string; count: number; orders: BoardOrder[] }
export interface BoardMetric { label: string; value: string; change: string; warning: boolean }

const METRIC_ICONS = [Lightning, Clock, User, Warning];

export function OrdersBoard({
  metrics,
  kanbanColumns,
}: {
  metrics: BoardMetric[];
  kanbanColumns: BoardColumn[];
}) {
  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="Orders" title="Live orders" subtitle="Real-time operations board">
      {/* Admin scope is all-store, so no store filter is sent and RLS
          alone decides what arrives (D21). */}
      <RealtimeRefresh table="orders" storeId={null} />

      <section className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric, index) => {
          const Icon = METRIC_ICONS[index] ?? Lightning;
          return (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06, ease: [0.34, 1.56, 0.64, 1] }}
            className={cn(
              "clay-card p-4",
              metric.warning && "!border-orange-400/30 !bg-gradient-to-br !from-orange-500/15 !to-transparent"
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-semibold text-white/50">
                <Icon size={15} weight="bold" /> {metric.label}
              </span>
              {metric.change && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                    metric.warning ? "bg-orange-400/15 text-orange-300" : "bg-emerald-500/15 text-emerald-300"
                  )}
                >
                  {metric.change}
                </span>
              )}
            </div>
            <div className="font-display text-3xl font-extrabold text-white">{metric.value}</div>
          </motion.div>
          );
        })}
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
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-white/45">{column.title}</h3>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-extrabold text-white/70">{column.count}</span>
            </div>
            <div className="flex min-h-[380px] flex-1 flex-col gap-3 rounded-3xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.07]">
              {column.orders.map((order) => (
                <div
                  key={order.id}
                  className={cn(
                    "clay-card cursor-pointer rounded-2xl !rounded-2xl transition-[background-color,border-color,color,box-shadow,transform] hover:-translate-y-0.5",
                    order.priority && "!border-l-4 !border-l-orange-400"
                  )}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <span className="font-display text-sm font-extrabold text-sky-300">{order.id}</span>
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-white/40">
                      <Clock size={11} weight="bold" /> {order.time}
                    </span>
                  </div>
                  <p className="mb-3 line-clamp-2 text-xs font-medium text-white/70">{order.items}</p>
                  <div className="flex items-center justify-between border-t border-dashed border-white/10 pt-2">
                    <span className="text-[10px] font-semibold text-white/40">Awaiting runner</span>
                    <button className="btn-clay cursor-pointer px-3 py-1 text-[10px] font-bold">Assign</button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </section>
    </OpsShell>
  );
}
