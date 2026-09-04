"use client";

// Filter bar, table and pager. Filters write to the URL and let the
// server component re-query — no client-side filtering of a page of 25,
// which would silently disagree with the total count above it.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";

import { ago, rupees, shortId, statusTone, ORDER_STATUSES } from "@/lib/admin/format";
import { EmptyState, ErrorState, Pill, Table, Td, Th, btnClass, fieldClass } from "@craavee/ui/ops";

export interface OrderRow {
  id: string;
  status: string;
  payable: number;
  placedAt: string | null;
  units: number;
  storeName: string;
  runnerName: string | null;
}
export interface RunnerOption { id: string; storeId: string; name: string }
export interface StoreOption { id: string; name: string }

export function OrderList({
  orders, runners, stores, total, page, pageSize, now, loadError,
}: {
  orders: OrderRow[];
  runners: RunnerOption[];
  stores: StoreOption[];
  total: number;
  page: number;
  pageSize: number;
  now: number;
  loadError: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function apply(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    // Any filter change invalidates the page number — staying on page 4
    // of a narrower result set shows an empty table for no reason.
    if (!("page" in next)) p.delete("page");
    router.push(`/orders?${p.toString()}`);
  }

  const active = ["status", "store", "runner", "q", "from", "to"].filter((k) => params.get(k));

  return (
    <div className="space-y-3">
      <form
        className="clay-card flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() || null }); }}
      >
        <label className="min-w-[12rem] flex-1">
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">
            Order reference
          </span>
          <div className="relative">
            <MagnifyingGlass size={14} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              className={fieldClass + " pl-8"}
              placeholder="#4f526d98"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search by order reference"
            />
          </div>
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Status</span>
          <select className={fieldClass} value={params.get("status") ?? ""} onChange={(e) => apply({ status: e.target.value })}>
            <option value="">Any</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Store</span>
          <select className={fieldClass} value={params.get("store") ?? ""} onChange={(e) => apply({ store: e.target.value })}>
            <option value="">Any</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Runner</span>
          <select className={fieldClass} value={params.get("runner") ?? ""} onChange={(e) => apply({ runner: e.target.value })}>
            <option value="">Any</option>
            <option value="none">Unassigned</option>
            {runners.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Placed from</span>
          <input type="date" className={fieldClass} value={params.get("from") ?? ""} onChange={(e) => apply({ from: e.target.value })} />
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">to</span>
          <input type="date" className={fieldClass} value={params.get("to") ?? ""} onChange={(e) => apply({ to: e.target.value })} />
        </label>

        <button type="submit" className={btnClass}>Search</button>
        {active.length > 0 && (
          <button type="button" className={btnClass} onClick={() => { setQ(""); router.push("/orders"); }}>
            Clear {active.length}
          </button>
        )}
      </form>

      {loadError ? (
        <ErrorState title="Orders could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders match"
          hint={active.length ? "Try widening or clearing the filters." : "Orders appear here as soon as customers place them."}
        />
      ) : (
        <>
          <Table label="Orders">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Status</Th>
                <Th>Store</Th>
                <Th>Runner</Th>
                <Th>Placed</Th>
                <Th className="text-right">Value</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-white/[0.03]">
                  <Td>
                    <Link
                      href={`/orders/${o.id}`}
                      className="font-display font-extrabold text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                    >
                      {shortId(o.id)}
                    </Link>
                    <div className="text-[11px] text-white/40">{o.units} {o.units === 1 ? "unit" : "units"}</div>
                  </Td>
                  <Td><Pill tone={statusTone(o.status)}>{o.status.replace(/_/g, " ")}</Pill></Td>
                  <Td className="text-white/70">{o.storeName}</Td>
                  <Td className="text-white/70">{o.runnerName ?? <span className="text-white/30">unassigned</span>}</Td>
                  <Td className="whitespace-nowrap text-white/60">{ago(o.placedAt, now)}</Td>
                  <Td className="whitespace-nowrap text-right font-semibold text-white/85">{rupees(o.payable)}</Td>
                  <Td className="text-right">
                    <Link href={`/orders/${o.id}`} className={btnClass + " inline-block"}>Open</Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <nav className="flex items-center justify-between gap-3 px-1" aria-label="Pagination">
            <p className="text-xs text-white/40">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-IN")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={btnClass}
                disabled={page <= 1}
                onClick={() => apply({ page: String(page - 1) })}
              >
                <CaretLeft size={12} weight="bold" className="mr-1 inline" /> Previous
              </button>
              <button
                type="button"
                className={btnClass}
                disabled={page >= lastPage}
                onClick={() => apply({ page: String(page + 1) })}
              >
                Next <CaretRight size={12} weight="bold" className="ml-1 inline" />
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
