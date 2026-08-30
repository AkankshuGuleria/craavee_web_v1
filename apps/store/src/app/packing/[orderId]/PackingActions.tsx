"use client";

// The packing controls (Phase 6 §9). Built for someone standing up, one
// hand on a crate: large targets, no confirmation dialogs on the happy
// path, and the outcome of every action read back from the server rather
// than assumed.
//
// Nothing here is a security control. The buttons call the Edge
// Functions, which authorize against staff_roles and enforce the
// transaction. A disabled button is a convenience, never the guarantee —
// re-enabling it in devtools just produces the same server-side refusal.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Warning } from "@phosphor-icons/react";

import { createClient } from "@/lib/supabase/client";

export interface PackingItem {
  id: string;
  name: string;
  qty: number;
  fulfilledQty: number;
  reconciled: boolean;
}

const FN_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1`;

async function callFn(name: string, body: unknown): Promise<{ ok: boolean; code?: string }> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";

  const r = await fetch(`${FN_BASE}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { ok: boolean; error?: { code: string } };
  return { ok: j.ok, code: j.error?.code };
}

/** Canonical codes (API_CONTRACTS.md) turned into something an operator
 *  can act on. Raw Postgres text never reaches this layer. */
function explain(code: string | undefined): string {
  switch (code) {
    case "FORBIDDEN":
      return "You are not allowed to pack this order.";
    case "INVALID_ORDER_TRANSITION":
      return "This order is no longer waiting to be packed — refresh the queue.";
    case "ITEM_UNAVAILABLE":
      return "That quantity does not match the order. Refresh and try again.";
    case "AUTH_REQUIRED":
      return "Your session expired. Sign in again.";
    default:
      return "That did not go through. Nothing was changed — try again.";
  }
}

export function PackingActions({
  orderId,
  status,
  items,
}: {
  orderId: string;
  status: string;
  items: PackingItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const packed = status === "packed";
  const allPicked = items.every((i) => picked[i.id] || i.reconciled || packed);

  async function stockOut(item: PackingItem, availableQty: number) {
    setBusy(item.id);
    setError(null);
    const r = await callFn("mark_stock_out", {
      orderId,
      orderItemId: item.id,
      availableQty,
      // Idempotency key per attempt: a retry after a network blip reuses
      // nothing, and the server's per-line guard is what actually
      // prevents a second refund.
      idempotencyKey: crypto.randomUUID(),
    });
    setBusy(null);
    if (!r.ok) return setError(explain(r.code));
    startTransition(() => router.refresh());
  }

  async function pack() {
    setBusy("pack");
    setError(null);
    const r = await callFn("mark_packed", { orderId });
    setBusy(null);
    if (!r.ok) return setError(explain(r.code));
    startTransition(() => router.refresh());
  }

  return (
    <div className="max-w-2xl space-y-5">
      {error && (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>
      )}

      <ul className="space-y-3">
        {items.map((item) => {
          const outstanding = item.reconciled ? item.fulfilledQty : item.qty;
          const isPicked = picked[item.id] || packed;
          return (
            <li
              key={item.id}
              className="rounded-2xl border border-white/10 bg-white/5 p-5"
              data-testid="packing-line"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-medium text-white">{item.name}</p>
                  <p className="mt-1 text-sm text-white/50">
                    {item.reconciled ? (
                      <>
                        <span className="text-amber-300/90">Reconciled</span> · pick {item.fulfilledQty} of{" "}
                        {item.qty}
                      </>
                    ) : (
                      <>Pick {item.qty}</>
                    )}
                  </p>
                </div>

                {!packed && outstanding > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicked((p) => ({ ...p, [item.id]: !p[item.id] }))}
                    aria-pressed={isPicked}
                    className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border transition ${
                      isPicked
                        ? "border-emerald-400/40 bg-emerald-400/20 text-emerald-200"
                        : "border-white/15 bg-white/5 text-white/40 hover:border-white/30"
                    }`}
                  >
                    <Check size={22} weight="bold" />
                  </button>
                )}
              </div>

              {!packed && !item.reconciled && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => stockOut(item, 0)}
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 text-sm font-medium text-amber-200 disabled:opacity-40"
                  >
                    <Warning size={16} weight="bold" />
                    {busy === item.id ? "Recording…" : "None on shelf"}
                  </button>
                  {item.qty > 1 &&
                    Array.from({ length: item.qty - 1 }, (_, n) => n + 1).map((available) => (
                      <button
                        key={available}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => stockOut(item, available)}
                        className="h-11 rounded-xl border border-white/15 bg-white/5 px-4 text-sm text-white/70 disabled:opacity-40"
                      >
                        Only {available}
                      </button>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!packed && (
        <button
          type="button"
          onClick={pack}
          disabled={busy !== null || pending || !allPicked}
          className="h-16 w-full rounded-2xl bg-white text-base font-semibold text-black transition disabled:opacity-30"
        >
          {busy === "pack" ? "Packing…" : allPicked ? "Mark packed" : "Pick every line first"}
        </button>
      )}

      {packed && (
        <p className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-5 text-sm text-emerald-200">
          Packed. It is now waiting for a runner to claim it.
        </p>
      )}
    </div>
  );
}
