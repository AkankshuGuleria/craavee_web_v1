"use client";

// Stock corrections. The dialog states the delta and what is reserved,
// because "set on hand to 12" reads very differently when 9 of the
// current 14 are already promised to orders.
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlass, PencilSimple } from "@phosphor-icons/react";

import { callFn, explain } from "@/lib/admin/callFn";
import { rupees } from "@/lib/admin/format";
import {
  ActionResult, ConfirmDialog, EmptyState, ErrorState, Pill, Table, Td, Th,
  btnClass, fieldClass,
} from "@/lib/admin/ui";

export interface InventoryRow {
  storeId: string; storeName: string; productId: string;
  name: string; brand: string | null; category: string;
  salePrice: number; isListed: boolean;
  onHand: number; reserved: number;
}

export function InventoryBoard({
  rows, stores, total, page, pageSize, loadError,
}: {
  rows: InventoryRow[];
  stores: { id: string; name: string }[];
  total: number; page: number; pageSize: number; loadError: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [editing, setEditing] = useState<{ row: InventoryRow; onHand: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function apply(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") p.delete(k); else p.set(k, v);
    }
    if (!("page" in next)) p.delete("page");
    router.push(`/inventory?${p.toString()}`);
  }

  async function save() {
    if (!editing) return;
    const qty = Number(editing.onHand);
    if (!Number.isInteger(qty) || qty < 0) return setError("On-hand must be a whole number, zero or more.");
    setBusy(true); setError(null);
    const r = await callFn("admin_adjust_inventory", {
      storeId: editing.row.storeId,
      productId: editing.row.productId,
      qtyOnHand: qty,
      reason: editing.reason.trim(),
    });
    setBusy(false);
    if (!r.ok) return setError(explain(r.code, r.message));
    setSuccess(`${editing.row.name}: on hand ${editing.row.onHand} → ${qty}.`);
    setEditing(null);
    router.refresh();
  }

  if (loadError) {
    return <ErrorState title="Inventory could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />;
  }

  const delta = editing ? Number(editing.onHand) - editing.row.onHand : 0;

  return (
    <div className="space-y-3">
      <ActionResult error={error} success={success} />

      <form
        className="clay-card flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() || null }); }}
      >
        <label className="min-w-[14rem] flex-1">
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Product</span>
          <div className="relative">
            <MagnifyingGlass size={14} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input className={fieldClass + " pl-8"} placeholder="Search by name" value={q}
                   onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
          </div>
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Store</span>
          <select className={fieldClass} value={params.get("store") ?? ""} onChange={(e) => apply({ store: e.target.value })}>
            <option value="">Any</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" className="size-4 accent-sky-400" checked={params.get("low") === "1"}
                 onChange={(e) => apply({ low: e.target.checked ? "1" : null })} />
          <span className="text-xs font-semibold text-white/70">5 or fewer available</span>
        </label>
        <button type="submit" className={btnClass}>Search</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Nothing stocked here" hint="Add a product from the Catalog, then set its stock." />
      ) : (
        <>
          <Table label="Inventory">
            <thead>
              <tr>
                <Th>Product</Th><Th>Store</Th>
                <Th className="text-right">On hand</Th>
                <Th className="text-right">Reserved</Th>
                <Th className="text-right">Available</Th>
                <Th className="text-right">Price</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const available = r.onHand - r.reserved;
                return (
                  <tr key={`${r.storeId}:${r.productId}`} className="hover:bg-white/[0.03]">
                    <Td>
                      <span className="font-semibold text-white/90">{r.name}</span>
                      <div className="text-[11px] text-white/40">
                        {[r.brand, r.category].filter(Boolean).join(" · ")}
                        {!r.isListed && <span className="ml-2 text-orange-300">unlisted</span>}
                      </div>
                    </Td>
                    <Td className="text-white/65">{r.storeName}</Td>
                    <Td className="text-right text-white/85">{r.onHand}</Td>
                    <Td className="text-right text-white/55">{r.reserved}</Td>
                    <Td className="text-right">
                      {available <= 0
                        ? <Pill tone="alarm">out</Pill>
                        : available <= 5
                          ? <Pill tone="attention">{available}</Pill>
                          : <span className="font-semibold text-white/85">{available}</span>}
                    </Td>
                    <Td className="text-right text-white/65">{rupees(r.salePrice)}</Td>
                    <Td className="text-right">
                      <button type="button" className={btnClass}
                        onClick={() => { setSuccess(null); setError(null); setEditing({ row: r, onHand: String(r.onHand), reason: "" }); }}>
                        <PencilSimple size={12} weight="bold" className="mr-1 inline" /> Correct
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <nav className="flex items-center justify-between gap-3 px-1" aria-label="Pagination">
            <p className="text-xs text-white/40">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-IN")}
            </p>
            <div className="flex gap-2">
              <button type="button" className={btnClass} disabled={page <= 1} onClick={() => apply({ page: String(page - 1) })}>
                <CaretLeft size={12} weight="bold" className="mr-1 inline" /> Previous
              </button>
              <button type="button" className={btnClass} disabled={page >= lastPage} onClick={() => apply({ page: String(page + 1) })}>
                Next <CaretRight size={12} weight="bold" className="ml-1 inline" />
              </button>
            </div>
          </nav>
        </>
      )}

      <ConfirmDialog
        open={editing !== null}
        title={editing ? `Correct stock — ${editing.row.name}` : ""}
        confirmLabel="Save correction"
        confirmDisabled={!editing || editing.reason.trim().length === 0 || editing.onHand.trim() === ""}
        busy={busy}
        error={error}
        onCancel={() => { setEditing(null); setError(null); }}
        onConfirm={save}
        impact={
          editing ? (
            <>
              On hand goes <b className="text-white/85">{editing.row.onHand} → {editing.onHand || "?"}</b>
              {Number.isFinite(delta) && delta !== 0 && (
                <> ({delta > 0 ? "+" : ""}{delta})</>
              )}.{" "}
              <b className="text-white/85">{editing.row.reserved}</b>{" "}
              {editing.row.reserved === 1 ? "unit is" : "units are"} already reserved by live orders and cannot be
              counted away — the server refuses a correction below that. Reserved stock is not editable here; it
              belongs to the orders that claimed it.
            </>
          ) : null
        }
      >
        {editing && (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-white/60">Counted on the shelf</span>
              <input className={fieldClass} type="number" min={0} inputMode="numeric" autoFocus
                     value={editing.onHand} onChange={(e) => setEditing({ ...editing, onHand: e.target.value })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-white/60">
                Reason <span className="text-white/35">(required — it goes in the audit log)</span>
              </span>
              <input className={fieldClass} placeholder="e.g. stock count, damaged units removed"
                     value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} />
            </label>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
