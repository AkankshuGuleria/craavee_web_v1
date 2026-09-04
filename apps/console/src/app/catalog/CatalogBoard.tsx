"use client";

// Create and edit products. Money is entered in rupees and sent in paise
// (D7): the conversion happens once, here, and the server validates the
// integer it receives — a decimal never reaches the database.
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlass, PencilSimple, Plus } from "@phosphor-icons/react";

import { callFn, explain } from "@/lib/admin/callFn";
import { rupees } from "@/lib/admin/format";
import {
  ActionResult, ConfirmDialog, EmptyState, ErrorState, Pill, Table, Td, Th,
  btnClass, btnPrimaryClass, fieldClass,
} from "@craavee/ui/ops";

export interface ProductRow {
  id: string; storeId: string; storeName: string;
  name: string; brand: string | null; category: string; unitLabel: string | null;
  mrp: number; salePrice: number; isListed: boolean;
}

interface Draft {
  id?: string; storeId: string; name: string; brand: string; category: string;
  unitLabel: string; mrp: string; salePrice: string; isListed: boolean;
  wasPrice?: number;
}

/** Rupees in the box, paise on the wire (D7). */
const toPaise = (s: string) => Math.round(Number(s) * 100);
const toRupeeInput = (paise: number) => (paise / 100).toFixed(2);

export function CatalogBoard({
  products, stores, defaultStoreId, total, page, pageSize, loadError,
}: {
  products: ProductRow[];
  stores: { id: string; name: string }[];
  defaultStoreId: string;
  total: number; page: number; pageSize: number; loadError: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
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
    router.push(`/catalog?${p.toString()}`);
  }

  async function save() {
    if (!draft) return;
    const mrp = toPaise(draft.mrp), sale = toPaise(draft.salePrice);
    if (!Number.isInteger(mrp) || !Number.isInteger(sale) || mrp < 0 || sale < 0) {
      return setError("Prices must be valid amounts, zero or more.");
    }
    if (sale > mrp) return setError("The sale price cannot be above the MRP.");

    setBusy(true); setError(null);
    const r = await callFn("admin_upsert_product", {
      ...(draft.id ? { productId: draft.id } : {}),
      storeId: draft.storeId,
      name: draft.name.trim(),
      brand: draft.brand.trim() || undefined,
      category: draft.category.trim(),
      unitLabel: draft.unitLabel.trim() || undefined,
      mrp, salePrice: sale, isListed: draft.isListed,
    });
    setBusy(false);
    if (!r.ok) return setError(explain(r.code, r.message));
    setSuccess(draft.id ? `${draft.name.trim()} updated.` : `${draft.name.trim()} added — set its stock in Inventory.`);
    setDraft(null);
    router.refresh();
  }

  if (loadError) {
    return <ErrorState title="The catalog could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />;
  }

  const priceChanged = draft?.wasPrice !== undefined && toPaise(draft.salePrice) !== draft.wasPrice;

  return (
    <div className="space-y-3">
      <ActionResult error={error} success={success} />

      <div className="flex flex-wrap items-end gap-3">
        <form
          className="clay-card flex flex-1 flex-wrap items-end gap-3 p-3"
          onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() || null }); }}
        >
          <label className="min-w-[13rem] flex-1">
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
          <label>
            <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Listing</span>
            <select className={fieldClass} value={params.get("listed") ?? ""} onChange={(e) => apply({ listed: e.target.value })}>
              <option value="">Any</option><option value="1">Listed</option><option value="0">Unlisted</option>
            </select>
          </label>
          <button type="submit" className={btnClass}>Search</button>
        </form>
        <button
          type="button"
          className={btnPrimaryClass + " h-[38px]"}
          onClick={() => { setSuccess(null); setError(null); setDraft({ storeId: defaultStoreId, name: "", brand: "", category: "", unitLabel: "", mrp: "", salePrice: "", isListed: true }); }}
        >
          <Plus size={12} weight="bold" className="mr-1 inline" /> New product
        </button>
      </div>

      {products.length === 0 ? (
        <EmptyState title="No products match" hint="Try clearing the filters, or add a product." />
      ) : (
        <>
          <Table label="Catalog">
            <thead>
              <tr>
                <Th>Product</Th><Th>Store</Th><Th>Category</Th>
                <Th className="text-right">MRP</Th><Th className="text-right">Sale price</Th>
                <Th>Listing</Th><Th />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.03]">
                  <Td>
                    <span className="font-semibold text-white/90">{p.name}</span>
                    <div className="text-[11px] text-white/40">{[p.brand, p.unitLabel].filter(Boolean).join(" · ")}</div>
                  </Td>
                  <Td className="text-white/65">{p.storeName}</Td>
                  <Td className="text-white/65">{p.category}</Td>
                  <Td className="text-right text-white/55">{rupees(p.mrp)}</Td>
                  <Td className="text-right font-semibold text-white/90">{rupees(p.salePrice)}</Td>
                  <Td>{p.isListed ? <Pill tone="done">listed</Pill> : <Pill tone="dead">hidden</Pill>}</Td>
                  <Td className="text-right">
                    <button type="button" className={btnClass}
                      onClick={() => { setSuccess(null); setError(null); setDraft({
                        id: p.id, storeId: p.storeId, name: p.name, brand: p.brand ?? "", category: p.category,
                        unitLabel: p.unitLabel ?? "", mrp: toRupeeInput(p.mrp), salePrice: toRupeeInput(p.salePrice),
                        isListed: p.isListed, wasPrice: p.salePrice,
                      }); }}>
                      <PencilSimple size={12} weight="bold" className="mr-1 inline" /> Edit
                    </button>
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
        open={draft !== null}
        title={draft?.id ? `Edit — ${draft.name || "product"}` : "New product"}
        confirmLabel={draft?.id ? "Save changes" : "Add product"}
        confirmDisabled={!draft || !draft.name.trim() || !draft.category.trim() || draft.mrp === "" || draft.salePrice === ""}
        busy={busy}
        error={error}
        onCancel={() => { setDraft(null); setError(null); }}
        onConfirm={save}
        impact={
          draft?.id ? (
            <>
              {priceChanged ? (
                <>The price changes for <b className="text-white/85">the next customer only</b>. Orders already
                placed keep the price they were charged — <code className="text-white/60">order_items.unit_price</code> is
                a snapshot, so nothing already paid, refunded or in flight is touched.</>
              ) : (
                <>Catalog details only. No price change, and no existing order is affected.</>
              )}
              {" "}The change is recorded in the audit log against your name.
            </>
          ) : (
            <>
              A new product starts <b className="text-white/85">with zero stock</b>, so it cannot be ordered until
              you set its on-hand count in Inventory. {draft?.isListed ? "It will be visible to customers once stocked." : "It stays hidden until you list it."}
            </>
          )
        }
      >
        {draft && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Name</span>
                <input className={fieldClass} autoFocus value={draft.name}
                       onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Brand <span className="text-white/35">(optional)</span></span>
                <input className={fieldClass} value={draft.brand}
                       onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Category</span>
                <input className={fieldClass} value={draft.category}
                       onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Unit <span className="text-white/35">(optional)</span></span>
                <input className={fieldClass} placeholder="500 ml" value={draft.unitLabel}
                       onChange={(e) => setDraft({ ...draft, unitLabel: e.target.value })} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/60">MRP (₹)</span>
                <input className={fieldClass} type="number" min={0} step="0.01" inputMode="decimal" value={draft.mrp}
                       onChange={(e) => setDraft({ ...draft, mrp: e.target.value })} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Sale price (₹)</span>
                <input className={fieldClass} type="number" min={0} step="0.01" inputMode="decimal" value={draft.salePrice}
                       onChange={(e) => setDraft({ ...draft, salePrice: e.target.value })} />
              </label>
            </div>
            {!draft.id && (
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Store</span>
                <select className={fieldClass} value={draft.storeId}
                        onChange={(e) => setDraft({ ...draft, storeId: e.target.value })}>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-emerald-400" checked={draft.isListed}
                     onChange={(e) => setDraft({ ...draft, isListed: e.target.checked })} />
              <span className="text-xs font-semibold text-white/70">Listed — customers can see and order it</span>
            </label>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
