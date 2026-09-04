"use client";

// Runner roster with in-place reassignment of a live job.
//
// The eligible list is "at this store, not this runner, no live job of
// their own". All three of those are re-checked by
// process_admin_reassign, and the one-live-job partial unique index
// catches a runner who claims something in the gap between this page
// rendering and the operator clicking. Greying out a busy runner is a
// courtesy, not the mechanism.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";

import { callFn, explain } from "@/lib/admin/callFn";
import { ago, rupees, shortId } from "@/lib/admin/format";
import {
  ActionResult, ConfirmDialog, EmptyState, ErrorState, Pill, Table, Td, Th,
  Button, fieldClass,
} from "@craavee/ui/ops";

export interface RunnerRow {
  id: string;
  name: string;
  storeId: string;
  storeName: string;
  isOnline: boolean;
  job: { orderId: string; status: string; since: string | null } | null;
  deliveredThisWeek: number;
  unsettled: number;
}

export function RunnerBoard({
  runners, now, loadError,
}: {
  runners: RunnerRow[];
  now: number;
  loadError: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<{ from: RunnerRow; toId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (loadError) {
    return <ErrorState title="Runners could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />;
  }
  if (!runners.length) {
    return <EmptyState title="No runners yet" hint="A profile becomes a runner when an admin grants the runner role." />;
  }

  async function reassign() {
    if (!pending?.from.job) return;
    setBusy(true);
    setError(null);
    const r = await callFn("admin_reassign", {
      orderId: pending.from.job.orderId,
      ...(pending.toId ? { runnerId: pending.toId } : {}),
    });
    setBusy(false);
    if (!r.ok) return setError(explain(r.code));

    const target = runners.find((x) => x.id === pending.toId);
    setPending(null);
    setSuccess(
      target
        ? `${shortId(pending.from.job.orderId)} moved to ${target.name}.`
        : `${shortId(pending.from.job.orderId)} released back to the claim queue.`,
    );
    router.refresh();
  }

  // Only an `assigned` job can go back to the open queue (#8). Once it is
  // picked_up the goods are physically with a runner, so it must go to a
  // named person.
  const releasable = pending?.from.job?.status === "assigned";

  return (
    <div className="space-y-3">
      <ActionResult error={error} success={success} />

      <Table label="Runners">
        <thead>
          <tr>
            <Th>Runner</Th>
            <Th>Store</Th>
            <Th>Shift</Th>
            <Th>Carrying</Th>
            <Th className="text-right">Delivered (7d)</Th>
            <Th className="text-right">Unsettled</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {runners.map((r) => (
            <tr key={r.id} className="hover:bg-white/[0.03]">
              <Td className="font-semibold text-white/90">{r.name}</Td>
              <Td className="text-white/65">{r.storeName}</Td>
              <Td>{r.isOnline ? <Pill tone="done">online</Pill> : <Pill tone="dead">offline</Pill>}</Td>
              <Td>
                {r.job ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/orders/${r.job.orderId}`}
                      className="font-display font-extrabold text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                    >
                      {shortId(r.job.orderId)}
                    </Link>
                    <Pill tone="live">{r.job.status.replace(/_/g, " ")}</Pill>
                    <span className="text-[11px] text-white/40">{ago(r.job.since, now)}</span>
                  </div>
                ) : (
                  <span className="text-white/30">free</span>
                )}
              </Td>
              <Td className="text-right text-white/70">{r.deliveredThisWeek}</Td>
              <Td className="text-right text-white/70">{r.unsettled > 0 ? rupees(r.unsettled) : "—"}</Td>
              <Td className="text-right">
                {/* Phase 10D: the shared ops Button rather than a bare
                    <button> with a pasted class string. It brings the focus
                    ring, the 44pt minimum target and aria-busy the raw
                    element did not have. */}
                {r.job && (
                    <Button
                      onClick={() => { setSuccess(null); setError(null); setPending({ from: r, toId: "" }); }}
                      title="Move this runner's live job to someone else"
                    >
                      <ArrowsClockwise size={12} weight="bold" />
                      Move job
                    </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <p className="px-1 text-[11px] text-white/30">
        A runner sets their own availability from the app — `runners_update` is scoped to their own
        row, so there is no admin toggle here rather than a button that would fail.
      </p>

      <ConfirmDialog
        open={pending !== null}
        title="Move this job to someone else"
        confirmLabel="Move the job"
        confirmDisabled={pending !== null && !pending.toId && !releasable}
        busy={busy}
        error={error}
        onCancel={() => { setPending(null); setError(null); }}
        onConfirm={reassign}
        impact={
          pending?.from.job ? (
            <>
              <b className="text-white/85">{shortId(pending.from.job.orderId)}</b> leaves{" "}
              <b className="text-white/85">{pending.from.name}</b>&rsquo;s app immediately. The order stays{" "}
              <b className="text-white/85">{pending.from.job.status.replace(/_/g, " ")}</b> and no money moves.
              {pending.from.job.status === "picked_up" && (
                <> The goods are already off the shelf and physically with {pending.from.name} — make sure the handover actually happens.</>
              )}
            </>
          ) : null
        }
      >
        {pending && (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-white/60">Move to</span>
            <select className={fieldClass} value={pending.toId} onChange={(e) => setPending({ ...pending, toId: e.target.value })}>
              <option value="">{releasable ? "Anyone at the store (back on the claim queue)" : "Choose a runner…"}</option>
              {runners
                .filter((r) => r.storeId === pending.from.storeId && r.id !== pending.from.id)
                .map((r) => (
                  <option key={r.id} value={r.id} disabled={!!r.job}>
                    {r.name}{r.job ? " — already on a job" : r.isOnline ? "" : " — offline"}
                  </option>
                ))}
            </select>
            {!releasable && (
              <span className="block text-[11px] text-white/35">
                Already picked up, so it has to go to a named runner rather than back to the open queue.
              </span>
            )}
          </label>
        )}
      </ConfirmDialog>
    </div>
  );
}
