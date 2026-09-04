"use client";

// The interactive half of the failed-delivery queue.
//
// Two actions, both of them existing backend capabilities:
//   Reassign      -> admin_reassign  (ORDER_STATE_MACHINE #13)
//   Cancel+refund -> admin_cancel_order (#14), which delegates the money
//                    to process_refund so there is one refund path
//
// Neither button is a permission. `busy` runners are greyed out because
// showing an operator an option that will fail is bad manners, not
// because greying it out prevents anything — process_admin_reassign
// re-checks, and the partial unique index catches a concurrent claim
// that lands between the check and the write.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowsClockwise, Prohibit } from "@phosphor-icons/react";

import { callFn, explain } from "@/lib/admin/callFn";
import { ago, rupees, shortId } from "@/lib/admin/format";
import {
  ActionResult, ConfirmDialog, EmptyState, ErrorState, Pill, Table, Td, Th,
  btnClass, btnPrimaryClass, fieldClass,
} from "@craavee/ui/ops";

export interface FailedOrder {
  id: string;
  storeId: string;
  status: string;
  payable: number;
  placedAt: string | null;
  failedAt: string | null;
  reason: string | null;
  runnerId: string | null;
  runnerName: string | null;
  units: number;
  location: string;
  landmark: string | null;
}

export interface EligibleRunner {
  id: string;
  storeId: string;
  name: string;
  isOnline: boolean;
  busy: boolean;
}

type Pending =
  | { kind: "reassign"; order: FailedOrder; runnerId: string | "" }
  | { kind: "cancel"; order: FailedOrder; reason: string };

export function FailureQueue({
  orders, runners, actions, now, loadError,
}: {
  orders: FailedOrder[];
  runners: EligibleRunner[];
  actions: string[];
  now: number;
  loadError: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Read out of order_transition_rules, not asserted here.
  const canReassign = actions.includes("assigned");
  const canCancel = actions.includes("cancelled");

  if (loadError) {
    return <ErrorState title="The queue could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />;
  }
  if (!orders.length) {
    return <EmptyState title="No failed deliveries" hint="Orders a runner could not hand over land here, with the reason they gave and the two ways out." />;
  }

  async function run() {
    if (!pending) return;
    setBusy(true);
    setError(null);

    const r =
      pending.kind === "reassign"
        ? await callFn("admin_reassign", { orderId: pending.order.id, runnerId: pending.runnerId })
        : await callFn("admin_cancel_order", {
            orderId: pending.order.id,
            reason: pending.reason,
            idempotencyKey: crypto.randomUUID(),
          });

    setBusy(false);
    if (!r.ok) return setError(explain(r.code));

    setPending(null);
    setSuccess(
      pending.kind === "reassign"
        ? `${shortId(pending.order.id)} is back out for delivery.`
        : `${shortId(pending.order.id)} cancelled and refunded to the customer's wallet.`,
    );
    // The row's fate is read back from the server, never assumed here.
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <ActionResult success={success} />

      <Table label="Failed deliveries">
        <thead>
          <tr>
            <Th>Order</Th>
            <Th>Why it failed</Th>
            <Th>Where</Th>
            <Th>Runner</Th>
            <Th>Failed</Th>
            <Th className="text-right">At risk</Th>
            <Th className="text-right">Next</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-white/[0.03]">
              <Td>
                <div className="font-display font-extrabold text-sky-300">{shortId(o.id)}</div>
                <div className="text-[11px] text-white/40">{o.units} {o.units === 1 ? "unit" : "units"}</div>
              </Td>
              <Td className="max-w-[15rem]">
                {o.reason ? (
                  <span className="text-white/85">{o.reason}</span>
                ) : (
                  <span className="text-white/35">no reason recorded</span>
                )}
              </Td>
              <Td className="max-w-[13rem]">
                <div className="text-white/80">{o.location}</div>
                {o.landmark && <div className="text-[11px] text-white/40">{o.landmark}</div>}
              </Td>
              <Td>{o.runnerName ?? <span className="text-white/35">unassigned</span>}</Td>
              <Td className="whitespace-nowrap text-white/60">{ago(o.failedAt, now)}</Td>
              <Td className="whitespace-nowrap text-right font-semibold text-white/85">{rupees(o.payable)}</Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canReassign && (
                    <button
                      type="button"
                      className={btnPrimaryClass}
                      onClick={() => { setSuccess(null); setError(null); setPending({ kind: "reassign", order: o, runnerId: "" }); }}
                    >
                      <ArrowsClockwise size={12} weight="bold" className="mr-1 inline" />
                      Re-attempt
                    </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      className={btnClass}
                      onClick={() => { setSuccess(null); setError(null); setPending({ kind: "cancel", order: o, reason: "" }); }}
                    >
                      <Prohibit size={12} weight="bold" className="mr-1 inline" />
                      Cancel + refund
                    </button>
                  )}
                  {!canReassign && !canCancel && <Pill tone="dead">no admin action</Pill>}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <ConfirmDialog
        open={pending?.kind === "reassign"}
        title="Send this order out again"
        confirmLabel="Re-attempt delivery"
        confirmDisabled={pending?.kind === "reassign" && !pending.runnerId}
        busy={busy}
        error={error}
        onCancel={() => { setPending(null); setError(null); }}
        onConfirm={run}
        impact={
          pending?.kind === "reassign" ? (
            <>
              <b className="text-white/85">{shortId(pending.order.id)}</b> goes back to{" "}
              <b className="text-white/85">assigned</b>. The customer is told it is on its way again and a
              fresh delivery code is issued — the old one was destroyed when the delivery failed.
              No money moves.
            </>
          ) : null
        }
      >
        {pending?.kind === "reassign" && (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-white/60">Give it to</span>
            <select
              className={fieldClass}
              value={pending.runnerId}
              onChange={(e) => setPending({ ...pending, runnerId: e.target.value })}
            >
              <option value="">Choose a runner…</option>
              {runners
                .filter((r) => r.storeId === pending.order.storeId)
                .map((r) => (
                  <option key={r.id} value={r.id} disabled={r.busy}>
                    {r.name}
                    {r.busy ? " — already on a job" : r.isOnline ? "" : " — offline"}
                  </option>
                ))}
            </select>
            {/* Not an arbitrary UI rule. `delivery_failed -> assigned` is
                the only forward edge an admin has here (#13); there is no
                `delivery_failed -> packed`, so "put it back on the open
                queue" is not a state this order can reach. Offering it
                would just produce a server refusal the operator cannot
                act on. */}
            <span className="block text-[11px] text-white/35">
              A failed delivery goes straight to a named runner — it cannot be returned to the open
              claim queue.
            </span>
          </label>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "cancel"}
        title="Cancel and refund this order"
        confirmLabel="Cancel and refund"
        confirmDisabled={pending?.kind === "cancel" && pending.reason.trim().length === 0}
        busy={busy}
        error={error}
        onCancel={() => { setPending(null); setError(null); }}
        onConfirm={run}
        impact={
          pending?.kind === "cancel" ? (
            <>
              <b className="text-white/85">{shortId(pending.order.id)}</b> becomes{" "}
              <b className="text-white/85">cancelled</b> and the full remaining captured amount
              (<b className="text-white/85">{rupees(pending.order.payable)}</b>) is refunded to the
              customer&rsquo;s Craavee wallet. Stock is <b className="text-white/85">not</b> put back —
              it left the shelf when the order was packed, so a physical restock is a separate
              inventory correction. This cannot be undone.
            </>
          ) : null
        }
      >
        {pending?.kind === "cancel" && (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-white/60">
              Reason <span className="text-white/35">(required — it goes in the audit log)</span>
            </span>
            <input
              className={fieldClass}
              value={pending.reason}
              autoFocus
              placeholder="e.g. customer moved out, unreachable for two days"
              onChange={(e) => setPending({ ...pending, reason: e.target.value })}
            />
          </label>
        )}
      </ConfirmDialog>
    </div>
  );
}
