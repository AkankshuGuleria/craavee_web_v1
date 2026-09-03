"use client";

// Pause / resume and the queue threshold.
//
// Both go through set_service_pause rather than a direct RLS write to
// `stores`. RBAC permits the direct write, but audit_logs is
// service-role-INSERT only, so the browser path cannot record who paused
// the business or why — and pausing the business is exactly what an audit
// log is for.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pause, Play } from "@phosphor-icons/react";

import { callFn, explain } from "@/lib/admin/callFn";
import {
  ActionResult, ConfirmDialog, ErrorState, Pill,
  btnClass, btnPrimaryClass, fieldClass,
} from "@/lib/admin/ui";

export interface StoreState {
  id: string;
  name: string;
  isOpen: boolean;
  pauseReason: string | null;
  maxQueueDepth: number;
  liveOrders: number;
}

export function ServiceControls({ stores, loadError }: { stores: StoreState[]; loadError: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<{ store: StoreState; reason: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [depths, setDepths] = useState<Record<string, string>>({});

  if (loadError) {
    return <ErrorState title="Store settings could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />;
  }

  async function apply(store: StoreState, body: Record<string, unknown>, note: string) {
    setBusy(store.id);
    setError(null);
    const r = await callFn("set_service_pause", { storeId: store.id, ...body });
    setBusy(null);
    if (!r.ok) {
      setError(explain(r.code));
      return false;
    }
    setSuccess(note);
    router.refresh();
    return true;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <ActionResult error={error} success={success} />

      {stores.map((s) => {
        const nearCapacity = s.liveOrders >= s.maxQueueDepth;
        return (
          <section key={s.id} className="clay-card space-y-4 p-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-extrabold text-white">{s.name}</h2>
                {/* State first and in words. An operator glancing at this
                    page needs to know whether the shop is taking orders
                    before they need anything else. */}
                <p className="mt-0.5 text-sm">
                  {s.isOpen ? (
                    <span className="font-semibold text-emerald-300">Taking orders</span>
                  ) : (
                    <span className="font-semibold text-orange-300">
                      Paused — new orders are refused
                      {s.pauseReason ? `: ${s.pauseReason}` : ""}
                    </span>
                  )}
                </p>
              </div>

              {s.isOpen ? (
                <button
                  type="button"
                  disabled={busy === s.id}
                  className="rounded-xl bg-orange-500/90 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-200 disabled:opacity-40"
                  onClick={() => { setSuccess(null); setError(null); setPending({ store: s, reason: "" }); }}
                >
                  <Pause size={14} weight="bold" className="mr-1.5 inline" />
                  Pause new orders
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === s.id}
                  className={btnPrimaryClass + " px-4 py-2 text-sm"}
                  onClick={() => { setSuccess(null); void apply(s, { isOpen: true }, `${s.name} is taking orders again.`); }}
                >
                  <Play size={14} weight="bold" className="mr-1.5 inline" />
                  {busy === s.id ? "Resuming…" : "Resume orders"}
                </button>
              )}
            </header>

            <div className="grid gap-4 border-t border-white/[0.06] pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-white/40">Live orders</p>
                <p className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold text-white">
                  {s.liveOrders}
                  {nearCapacity && <Pill tone="attention">at capacity</Pill>}
                </p>
                <p className="mt-1 text-[11px] text-white/35">
                  Everything not delivered, cancelled, failed or unpaid — the same count create_order
                  compares against the threshold.
                </p>
              </div>

              <form
                className="space-y-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = Number(depths[s.id] ?? s.maxQueueDepth);
                  setSuccess(null);
                  void apply(s, { isOpen: s.isOpen, pauseReason: s.pauseReason ?? undefined, maxQueueDepth: v },
                    `${s.name} now refuses new orders above ${v} live.`);
                }}
              >
                <label className="block">
                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-white/40">
                    Auto-refuse above
                  </span>
                  <input
                    type="number"
                    min={1}
                    className={fieldClass + " mt-1"}
                    value={depths[s.id] ?? String(s.maxQueueDepth)}
                    onChange={(e) => setDepths({ ...depths, [s.id]: e.target.value })}
                  />
                </label>
                <button type="submit" className={btnClass} disabled={busy === s.id}>
                  Save threshold
                </button>
                <p className="text-[11px] text-white/35">
                  A soft pause: once this many orders are live, checkout is refused until the queue
                  drains. Existing orders keep moving either way.
                </p>
              </form>
            </div>
          </section>
        );
      })}

      <ConfirmDialog
        open={pending !== null}
        title="Pause new orders"
        confirmLabel="Pause the store"
        confirmDisabled={pending !== null && pending.reason.trim().length === 0}
        busy={busy !== null}
        error={error}
        onCancel={() => { setPending(null); setError(null); }}
        onConfirm={async () => {
          if (!pending) return;
          const okDone = await apply(
            pending.store,
            { isOpen: false, pauseReason: pending.reason },
            `${pending.store.name} is paused. Orders already in flight are unaffected.`,
          );
          if (okDone) setPending(null);
        }}
        impact={
          pending ? (
            <>
              Customers will be refused at checkout on <b className="text-white/85">{pending.store.name}</b>{" "}
              with &ldquo;store closed&rdquo;. The{" "}
              <b className="text-white/85">{pending.store.liveOrders}</b> orders already in flight are{" "}
              <b className="text-white/85">not</b> affected — packing, pickup and delivery all continue.
              The reason below is shown to customers and recorded against your name in the audit log.
            </>
          ) : null
        }
      >
        {pending && (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-white/60">
              Reason <span className="text-white/35">(required)</span>
            </span>
            <input
              className={fieldClass}
              autoFocus
              value={pending.reason}
              placeholder="e.g. kitchen flooded, back by 6pm"
              onChange={(e) => setPending({ ...pending, reason: e.target.value })}
            />
          </label>
        )}
      </ConfirmDialog>
    </div>
  );
}
