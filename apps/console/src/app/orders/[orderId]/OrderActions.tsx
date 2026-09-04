"use client";

// The actions an admin may take on one order — Phase 9A §8.
//
// `allowed` comes from order_transition_rules for THIS order's current
// status and actor='admin'. The page does not decide what is legal; it
// asks the same table the trigger enforces. So a `packed` order shows no
// admin action at all, correctly — there is no packed->cancelled row.
//
// Reassignment is offered for `assigned` and `picked_up` too, not just
// after a failure: swapping the runner on a live job does not change
// orders.status, so it never appears in the transition table, but
// process_admin_reassign supports it and an operator needs it when a
// runner's phone dies mid-delivery.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowsClockwise, Prohibit } from "@phosphor-icons/react";

import { callFn, explain } from "@/lib/admin/callFn";
import { rupees, shortId } from "@/lib/admin/format";
import { ActionResult, ConfirmDialog, fieldClass, btnClass, btnPrimaryClass } from "@craavee/ui/ops";

export interface ActionContext {
  orderId: string;
  storeId: string;
  status: string;
  payable: number;
  refundable: number;
  runnerId: string | null;
  allowed: string[];
  runners: { id: string; storeId: string; name: string; isOnline: boolean; busy: boolean }[];
}

type Pending =
  | { kind: "reassign"; runnerId: string }
  | { kind: "cancel"; reason: string };

export function OrderActions({ ctx }: { ctx: ActionContext }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canCancel = ctx.allowed.includes("cancelled");
  const canReassignFromFailure = ctx.allowed.includes("assigned");
  const isLive = ctx.status === "assigned" || ctx.status === "picked_up";
  const canReassign = canReassignFromFailure || isLive;

  // "Release back to the open queue" is only reachable from `assigned`
  // (#8). From delivery_failed the only forward edge is a named runner.
  const canRelease = ctx.status === "assigned";

  if (!canCancel && !canReassign) {
    return (
      <section className="clay-card p-5">
        <h3 className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-white/40">Actions</h3>
        <p className="text-sm text-white/45">
          Nothing for an admin to do from <b className="text-white/70">{ctx.status.replace(/_/g, " ")}</b>. The
          state machine has no admin transition out of it — the next move belongs to the store, the
          runner or the customer.
        </p>
      </section>
    );
  }

  async function run() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const r =
      pending.kind === "reassign"
        ? await callFn("admin_reassign", {
            orderId: ctx.orderId,
            ...(pending.runnerId ? { runnerId: pending.runnerId } : {}),
          })
        : await callFn("admin_cancel_order", {
            orderId: ctx.orderId,
            reason: pending.reason,
            idempotencyKey: crypto.randomUUID(),
          });
    setBusy(false);
    if (!r.ok) return setError(explain(r.code));

    setPending(null);
    setSuccess(
      pending.kind === "reassign"
        ? pending.runnerId
          ? "Reassigned. The new runner sees it immediately."
          : "Released back to the claim queue."
        : `Cancelled and refunded ${rupees(ctx.refundable)} to the customer's wallet.`,
    );
    router.refresh();
  }

  return (
    <section className="clay-card space-y-3 p-5">
      <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-white/40">Actions</h3>
      <ActionResult error={error} success={success} />

      <div className="flex flex-wrap gap-2">
        {canReassign && (
          <button
            type="button"
            className={btnPrimaryClass}
            onClick={() => { setSuccess(null); setError(null); setPending({ kind: "reassign", runnerId: "" }); }}
          >
            <ArrowsClockwise size={12} weight="bold" className="mr-1 inline" />
            {ctx.status === "delivery_failed" ? "Re-attempt delivery" : "Change runner"}
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            className={btnClass}
            onClick={() => { setSuccess(null); setError(null); setPending({ kind: "cancel", reason: "" }); }}
          >
            <Prohibit size={12} weight="bold" className="mr-1 inline" />
            Cancel + refund
          </button>
        )}
      </div>

      <ConfirmDialog
        open={pending?.kind === "reassign"}
        title={ctx.status === "delivery_failed" ? "Send this order out again" : "Change the runner"}
        confirmLabel="Confirm"
        confirmDisabled={pending?.kind === "reassign" && !pending.runnerId && !canRelease}
        busy={busy}
        error={error}
        onCancel={() => { setPending(null); setError(null); }}
        onConfirm={run}
        impact={
          ctx.status === "delivery_failed" ? (
            <>
              <b className="text-white/85">{shortId(ctx.orderId)}</b> goes back to{" "}
              <b className="text-white/85">assigned</b> with a fresh delivery code — the previous one
              was destroyed when the delivery failed. No money moves.
            </>
          ) : (
            <>
              The order stays <b className="text-white/85">{ctx.status.replace(/_/g, " ")}</b>; only who is
              carrying it changes. The current runner loses it from their app immediately. No money moves.
            </>
          )
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
              <option value="">{canRelease ? "Anyone at the store (back on the claim queue)" : "Choose a runner…"}</option>
              {ctx.runners
                .filter((r) => r.storeId === ctx.storeId && r.id !== ctx.runnerId)
                .map((r) => (
                  <option key={r.id} value={r.id} disabled={r.busy}>
                    {r.name}{r.busy ? " — already on a job" : r.isOnline ? "" : " — offline"}
                  </option>
                ))}
            </select>
            {!canRelease && (
              <span className="block text-[11px] text-white/35">
                A failed delivery goes straight to a named runner — it cannot be returned to the open
                claim queue.
              </span>
            )}
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
          <>
            <b className="text-white/85">{shortId(ctx.orderId)}</b> becomes{" "}
            <b className="text-white/85">cancelled</b> and{" "}
            <b className="text-white/85">{rupees(ctx.refundable)}</b> — the remaining captured amount,
            computed by the server, not by this page — is refunded to the customer&rsquo;s wallet.
            {ctx.status === "confirmed"
              ? " The reserved stock is released back to the shelf."
              : " Stock is not put back: it left the shelf at packing, so a physical restock is a separate inventory correction."}
            {" "}This cannot be undone.
          </>
        }
      >
        {pending?.kind === "cancel" && (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-white/60">
              Reason <span className="text-white/35">(required — it goes in the audit log)</span>
            </span>
            <input
              className={fieldClass}
              autoFocus
              value={pending.reason}
              placeholder="e.g. customer called to cancel"
              onChange={(e) => setPending({ ...pending, reason: e.target.value })}
            />
          </label>
        )}
      </ConfirmDialog>
    </section>
  );
}
