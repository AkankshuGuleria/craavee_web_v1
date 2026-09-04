"use client";

// Read-only by construction — there is no mutation in this file and no
// policy that would accept one.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";

import { absolute, shortId } from "@/lib/admin/format";
import { EmptyState, ErrorState, Pill, Table, Td, Th, btnClass, fieldClass } from "@craavee/ui/ops";

export interface AuditRow {
  id: string; action: string; entityType: string; entityId: string;
  actorId: string | null; actorName: string | null; at: string;
  details: [string, string][]; hiddenCount: number;
}

const TONE_FOR = (action: string) =>
  action.includes("cancel") || action.includes("failed") || action.includes("paused") ? "attention"
  : action.includes("refund") ? "alarm"
  : action.includes("delivered") || action.includes("resumed") ? "done"
  : "live";

export function AuditBoard({
  rows, actions, total, page, pageSize, loadError,
}: {
  rows: AuditRow[]; actions: string[];
  total: number; page: number; pageSize: number; loadError: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [target, setTarget] = useState(params.get("target") ?? "");

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function apply(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") p.delete(k); else p.set(k, v);
    }
    if (!("page" in next)) p.delete("page");
    router.push(`/audit?${p.toString()}`);
  }

  const active = ["action", "entity", "actor", "target", "from", "to"].filter((k) => params.get(k));

  if (loadError) {
    return <ErrorState title="The audit log could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />;
  }

  return (
    <div className="space-y-3">
      <form
        className="clay-card flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => { e.preventDefault(); apply({ target: target.trim() || null }); }}
      >
        <label className="min-w-[12rem] flex-1">
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Target id</span>
          <div className="relative">
            <MagnifyingGlass size={14} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input className={fieldClass + " pl-8"} placeholder="#4f526d98" value={target}
                   onChange={(e) => setTarget(e.target.value)} aria-label="Filter by target id" />
          </div>
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Action</span>
          <select className={fieldClass} value={params.get("action") ?? ""} onChange={(e) => apply({ action: e.target.value })}>
            <option value="">Any</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Target type</span>
          <select className={fieldClass} value={params.get("entity") ?? ""} onChange={(e) => apply({ entity: e.target.value })}>
            <option value="">Any</option>
            {["order", "product", "profile", "runner", "store", "payment"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">From</span>
          <input type="date" className={fieldClass} value={params.get("from") ?? ""} onChange={(e) => apply({ from: e.target.value })} />
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">to</span>
          <input type="date" className={fieldClass} value={params.get("to") ?? ""} onChange={(e) => apply({ to: e.target.value })} />
        </label>
        <button type="submit" className={btnClass}>Filter</button>
        {active.length > 0 && (
          <button type="button" className={btnClass} onClick={() => { setTarget(""); router.push("/audit"); }}>
            Clear {active.length}
          </button>
        )}
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded here" hint={active.length ? "Try widening the filters." : "Every authoritative action writes a record."} />
      ) : (
        <>
          <Table label="Audit log">
            <thead>
              <tr><Th>When</Th><Th>Action</Th><Th>Actor</Th><Th>Target</Th><Th>Details</Th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-white/[0.03]">
                  <Td className="whitespace-nowrap text-white/50">{absolute(r.at)}</Td>
                  <Td><Pill tone={TONE_FOR(r.action)}>{r.action}</Pill></Td>
                  <Td className="text-white/70">
                    {r.actorName ?? (r.actorId ? <span className="text-white/40">unnamed</span> : <span className="text-white/30">system</span>)}
                  </Td>
                  <Td>
                    {r.entityType === "order" ? (
                      <Link href={`/orders/${r.entityId}`}
                            className="font-display font-extrabold text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
                        {shortId(r.entityId)}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-white/60">{shortId(r.entityId)}</span>
                    )}
                    <div className="text-[11px] text-white/35">{r.entityType}</div>
                  </Td>
                  <Td>
                    {r.details.length === 0 ? (
                      <span className="text-white/25">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {r.details.map(([k, v]) => (
                          <li key={k} className="text-[11px]">
                            <span className="text-white/40">{k}</span>{" "}
                            <span className="text-white/80">{v}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.hiddenCount > 0 && (
                      <p className="mt-1 text-[10px] text-white/25">
                        {r.hiddenCount} further field{r.hiddenCount === 1 ? "" : "s"} not shown
                      </p>
                    )}
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

      <p className="px-1 text-[11px] text-white/30">
        Read-only. <code>audit_logs</code> has an admin SELECT policy and no insert, update or delete policy for any
        client role — append-only is enforced by the database, not by this page. Only known-safe metadata fields are
        rendered; anything else is counted, never printed.
      </p>
    </div>
  );
}
