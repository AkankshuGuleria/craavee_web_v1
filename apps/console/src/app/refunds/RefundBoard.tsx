"use client";

// Issuing a refund is one call to the Phase 5 `refund` function. Nothing
// about the amount is decided here: the box is a CAP, the server computes
// what actually moves, and leaving it blank means the full remaining
// captured amount.
//
// The idempotency key is generated once per dialog opening, not per
// click, so a double-click on "Refund" replays the same request instead
// of issuing a second one — that is what D29's key is for.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlass, ArrowUUpLeft } from "@phosphor-icons/react";

import { callFn, explain } from "@/lib/admin/callFn";
import { absolute, rupees, shortId } from "@/lib/admin/format";
import {
  ActionResult, ConfirmDialog, EmptyState, ErrorState, Pill, Table, Td, Th,
  btnClass, fieldClass,
} from "@craavee/ui/ops";

export interface RefundRow {
  id: string; orderId: string; amount: number; reason: string | null;
  at: string; capturedTotal: number; refundedTotal: number;
}
export interface RefundableOrder {
  orderId: string; status: string; placedAt: string | null;
  captured: number; alreadyRefunded: number; remaining: number;
}

export function RefundBoard({
  refunds, refundable, total, page, pageSize, loadError,
}: {
  refunds: RefundRow[];
  refundable: RefundableOrder[];
  total: number; page: number; pageSize: number; loadError: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [issuing, setIssuing] = useState<{ order: RefundableOrder; amount: string; reason: string; key: string } | null>(null);
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
    router.push(`/refunds?${p.toString()}`);
  }

  const paise = issuing && issuing.amount.trim() !== "" ? Math.round(Number(issuing.amount) * 100) : null;
  const isFull = paise === null || paise >= (issuing?.order.remaining ?? 0);

  async function issue() {
    if (!issuing) return;
    if (paise !== null && (!Number.isInteger(paise) || paise <= 0)) {
      return setError("Enter a valid amount, or leave it blank to refund everything remaining.");
    }
    if (paise !== null && paise > issuing.order.remaining) {
      return setError(`That is more than the ${rupees(issuing.order.remaining)} still captured on this order.`);
    }
    setBusy(true); setError(null);
    const r = await callFn("refund", {
      orderId: issuing.order.orderId,
      idempotencyKey: issuing.key,
      ...(paise !== null && paise < issuing.order.remaining ? { amount: paise } : {}),
      reason: issuing.reason.trim(),
    });
    setBusy(false);
    if (!r.ok) return setError(explain(r.code, r.message));
    setSuccess(`${shortId(issuing.order.orderId)} refunded to the customer's wallet.`);
    setIssuing(null);
    router.refresh();
  }

  if (loadError) {
    return <ErrorState title="Refunds could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />;
  }

  return (
    <div className="space-y-5">
      <ActionResult error={error} success={success} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-white/40">Refundable now</h2>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() || null }); }}>
            <div className="relative">
              <MagnifyingGlass size={14} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input className={fieldClass + " w-52 pl-8"} placeholder="#4f526d98" value={q}
                     onChange={(e) => setQ(e.target.value)} aria-label="Find an order to refund" />
            </div>
            <button type="submit" className={btnClass}>Find</button>
          </form>
        </div>

        {refundable.length === 0 ? (
          <EmptyState title="Nothing to refund" hint="Orders appear here while they still have a captured amount that has not been returned." />
        ) : (
          <Table label="Refundable orders">
            <thead>
              <tr>
                <Th>Order</Th><Th>Status</Th><Th>Placed</Th>
                <Th className="text-right">Captured</Th><Th className="text-right">Already refunded</Th>
                <Th className="text-right">Remaining</Th><Th />
              </tr>
            </thead>
            <tbody>
              {refundable.map((o) => (
                <tr key={o.orderId} className="hover:bg-white/[0.03]">
                  <Td>
                    <Link href={`/orders/${o.orderId}`}
                          className="font-display font-extrabold text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
                      {shortId(o.orderId)}
                    </Link>
                  </Td>
                  <Td><Pill tone="live">{o.status.replace(/_/g, " ")}</Pill></Td>
                  <Td className="whitespace-nowrap text-white/50">{absolute(o.placedAt)}</Td>
                  <Td className="text-right text-white/65">{rupees(o.captured)}</Td>
                  <Td className="text-right text-white/50">{o.alreadyRefunded > 0 ? rupees(o.alreadyRefunded) : "—"}</Td>
                  <Td className="text-right font-semibold text-white/90">{rupees(o.remaining)}</Td>
                  <Td className="text-right">
                    <button type="button" className={btnClass}
                      onClick={() => { setSuccess(null); setError(null); setIssuing({ order: o, amount: "", reason: "", key: crypto.randomUUID() }); }}>
                      <ArrowUUpLeft size={12} weight="bold" className="mr-1 inline" /> Refund
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-extrabold uppercase tracking-wide text-white/40">
          Refund history <span className="ml-1 font-semibold normal-case tracking-normal text-white/30">
            — every refund goes to the customer&rsquo;s Craavee wallet (D38); there is no gateway-instrument path yet
          </span>
        </h2>
        {refunds.length === 0 ? (
          <EmptyState title="No refunds issued yet" hint="Every refund, however it was triggered, appears here." />
        ) : (
          <>
            <Table label="Refunds issued">
              <thead>
                <tr><Th>Order</Th><Th className="text-right">Amount</Th><Th>Reason</Th><Th>When</Th></tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.03]">
                    <Td>
                      <Link href={`/orders/${r.orderId}`}
                            className="font-display font-extrabold text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
                        {shortId(r.orderId)}
                      </Link>
                      <div className="text-[11px] text-white/40">
                        {r.refundedTotal >= r.capturedTotal ? "fully refunded" : `${rupees(r.capturedTotal - r.refundedTotal)} still captured`}
                      </div>
                    </Td>
                    <Td className="text-right font-semibold text-white/90">{rupees(r.amount)}</Td>
                    <Td className="text-white/65">{r.reason ?? <span className="text-white/30">—</span>}</Td>
                    <Td className="whitespace-nowrap text-white/50">{absolute(r.at)}</Td>
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
      </section>

      <ConfirmDialog
        open={issuing !== null}
        title={issuing ? `Refund ${shortId(issuing.order.orderId)}` : ""}
        confirmLabel="Issue the refund"
        confirmDisabled={!issuing || issuing.reason.trim().length === 0}
        busy={busy}
        error={error}
        onCancel={() => { setIssuing(null); setError(null); }}
        onConfirm={issue}
        impact={
          issuing ? (
            <>
              <b className="text-white/85">
                {paise !== null && paise < issuing.order.remaining ? rupees(paise) : rupees(issuing.order.remaining)}
              </b>{" "}
              goes to the customer&rsquo;s Craavee wallet. The server recomputes this from the payment — the box below
              is only an upper bound, and anything above {rupees(issuing.order.remaining)} is refused.
              {isFull ? (
                <> Because this is the <b className="text-white/85">full</b> remaining amount, the order is also{" "}
                <b className="text-white/85">cancelled</b>
                {issuing.order.status === "confirmed"
                  ? " and its reserved stock goes back on the shelf."
                  : " — stock is not restored, because it left the shelf when the order was packed."}</>
              ) : (
                <> This is a <b className="text-white/85">partial</b> refund, so the order stays{" "}
                <b className="text-white/85">{issuing.order.status.replace(/_/g, " ")}</b> and keeps moving.</>
              )}
              {" "}This cannot be undone.
            </>
          ) : null
        }
      >
        {issuing && (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-white/60">
                Amount (₹) <span className="text-white/35">— blank refunds everything remaining ({rupees(issuing.order.remaining)})</span>
              </span>
              <input className={fieldClass} type="number" min="0.01" step="0.01" inputMode="decimal"
                     placeholder={(issuing.order.remaining / 100).toFixed(2)}
                     value={issuing.amount} onChange={(e) => setIssuing({ ...issuing, amount: e.target.value })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-white/60">
                Reason <span className="text-white/35">(required — it goes in the audit log)</span>
              </span>
              <input className={fieldClass} autoFocus placeholder="e.g. item damaged on arrival"
                     value={issuing.reason} onChange={(e) => setIssuing({ ...issuing, reason: e.target.value })} />
            </label>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
