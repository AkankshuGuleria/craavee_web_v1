// Operational order detail — Phase 9A §5.
//
// What an admin needs to answer a support call and then act, and nothing
// else. Explicitly NOT here (§5, SECURITY_MODEL.md):
//
//   * the plaintext delivery code — it lives in order_delivery_codes,
//     readable only by the customer, and an admin has no policy on it at
//     all. There is nothing to redact because there is nothing to read.
//   * gateway refs and raw_event — reconciliation detail, not needed to
//     decide what to do with an order.
//   * the customer's wallet balance — the refund amount is computed
//     server-side from the payment, so no wallet figure is needed to
//     take any action on this page.
import { notFound } from "next/navigation";
import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/ssr";
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/lib/realtime/RealtimeRefresh";
import { CONSOLE_NAV } from "@/lib/nav";
import { absolute, rupees, shortId, statusTone, type OrderStatus } from "@/lib/admin/format";
import { Pill } from "@/lib/admin/ui";

import { OrderActions, type ActionContext } from "./OrderActions";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireAdmin();
  const { orderId } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, store_id, status, payment_status, subtotal, discount, delivery_fee, wallet_applied, payable, " +
      "placed_at, confirmed_at, packed_at, assigned_at, picked_up_at, delivered_at, cancelled_at, cancel_reason, runner_id, " +
      "order_items(id, qty, fulfilled_qty, unit_price, stock_out_at, products(name)), " +
      "addresses(block, floor, room, landmark)",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order) notFound();

  const o = order as unknown as {
    id: string; store_id: string; status: string; payment_status: string;
    subtotal: number; discount: number; delivery_fee: number; wallet_applied: number; payable: number;
    placed_at: string | null; confirmed_at: string | null; packed_at: string | null;
    assigned_at: string | null; picked_up_at: string | null; delivered_at: string | null;
    cancelled_at: string | null; cancel_reason: string | null; runner_id: string | null;
    order_items: { id: string; qty: number; fulfilled_qty: number | null; unit_price: number; stock_out_at: string | null; products: { name: string } | null }[] | null;
    addresses: { block: string; floor: string | null; room: string; landmark: string | null } | null;
  };

  const [{ data: payment }, { data: rules }, { data: runnerRows }, { data: logs }] = await Promise.all([
    supabase.from("payments").select("status, amount, refunded_amount").eq("order_id", orderId).maybeSingle(),
    // Cast: o.status is the DB enum, widened to string by the select above.
    supabase.from("order_transition_rules").select("to_status")
      .eq("from_status", o.status as OrderStatus).eq("actor", "admin"),
    supabase.from("runners").select("id, store_id, is_online, profiles(full_name)"),
    supabase
      .from("audit_logs")
      .select("action, metadata, created_at, actor_id")
      .eq("entity_id", orderId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const { data: liveRows } = await supabase
    .from("orders").select("runner_id").in("status", ["assigned", "picked_up"]).not("runner_id", "is", null);
  const busy = new Set(((liveRows ?? []) as { runner_id: string }[]).map((r) => r.runner_id));

  const runners = ((runnerRows ?? []) as unknown as {
    id: string; store_id: string; is_online: boolean; profiles: { full_name: string | null } | null;
  }[]).map((r) => ({
    id: r.id, storeId: r.store_id, name: r.profiles?.full_name ?? "Unnamed runner",
    isOnline: r.is_online, busy: busy.has(r.id),
  }));

  const a = o.addresses;
  const pay = payment as { status: string; amount: number; refunded_amount: number } | null;

  const timeline: [string, string | null][] = [
    ["Placed", o.placed_at], ["Confirmed", o.confirmed_at], ["Packed", o.packed_at],
    ["Assigned", o.assigned_at], ["Picked up", o.picked_up_at],
    ["Delivered", o.delivered_at], ["Cancelled", o.cancelled_at],
  ];

  const failure = ((logs ?? []) as { action: string; metadata: Record<string, unknown> }[])
    .find((l) => l.action === "order.delivery_failed");

  const ctx: ActionContext = {
    orderId: o.id,
    storeId: o.store_id,
    status: o.status,
    payable: o.payable,
    refundable: pay ? pay.amount - pay.refunded_amount : 0,
    runnerId: o.runner_id,
    allowed: ((rules ?? []) as { to_status: string }[]).map((r) => r.to_status),
    runners,
  };

  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Orders"
      title={`Order ${shortId(o.id)}`}
      subtitle={o.status.replace(/_/g, " ")}
    >
      <RealtimeRefresh table="orders" storeId={null} />

      <div className="space-y-4">
        <Link href="/orders" className="inline-flex items-center gap-1 text-xs font-semibold text-white/50 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
          <CaretLeft size={12} weight="bold" /> All orders
        </Link>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="clay-card space-y-3 p-5 lg:col-span-2">
            <header className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-extrabold text-white">{shortId(o.id)}</h2>
              <Pill tone={statusTone(o.status)}>{o.status.replace(/_/g, " ")}</Pill>
              {pay && <Pill tone={pay.refunded_amount > 0 ? "attention" : "done"}>{pay.status}</Pill>}
            </header>

            {failure && (
              <p className="rounded-xl bg-orange-400/10 p-3 text-sm text-orange-100">
                <b>Delivery failed:</b>{" "}
                {(failure.metadata?.reason as string) ?? "no reason recorded"}
              </p>
            )}

            <div>
              <h3 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-white/40">Items</h3>
              <ul className="space-y-1 text-sm">
                {(o.order_items ?? []).map((i) => (
                  <li key={i.id} className="flex justify-between gap-3 border-b border-white/[0.05] py-1.5 last:border-0">
                    <span className="text-white/85">
                      {i.products?.name ?? "Item"} <span className="text-white/40">× {i.qty}</span>
                      {i.stock_out_at && <span className="ml-2 text-[11px] text-orange-300">stock-out · {i.fulfilled_qty ?? 0} fulfilled</span>}
                    </span>
                    <span className="whitespace-nowrap text-white/60">{rupees(i.unit_price * i.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-white/[0.06] pt-3 text-sm">
              <dt className="text-white/45">Subtotal</dt><dd className="text-right text-white/80">{rupees(o.subtotal)}</dd>
              {o.discount > 0 && (<><dt className="text-white/45">Discount</dt><dd className="text-right text-white/80">−{rupees(o.discount)}</dd></>)}
              <dt className="text-white/45">Delivery</dt><dd className="text-right text-white/80">{rupees(o.delivery_fee)}</dd>
              {o.wallet_applied > 0 && (<><dt className="text-white/45">Wallet applied</dt><dd className="text-right text-white/80">−{rupees(o.wallet_applied)}</dd></>)}
              <dt className="font-semibold text-white/70">Payable</dt><dd className="text-right font-extrabold text-white">{rupees(o.payable)}</dd>
              {pay && pay.refunded_amount > 0 && (
                <><dt className="text-orange-300">Refunded</dt><dd className="text-right text-orange-200">{rupees(pay.refunded_amount)}</dd></>
              )}
            </dl>

            {o.cancel_reason && (
              <p className="text-xs text-white/50"><b className="text-white/70">Cancelled:</b> {o.cancel_reason}</p>
            )}
          </section>

          <div className="space-y-4">
            <section className="clay-card space-y-2 p-5">
              <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-white/40">Delivering to</h3>
              <p className="text-sm text-white/85">
                {a ? [a.block && `Block ${a.block}`, a.floor && `Floor ${a.floor}`, `Room ${a.room}`].filter(Boolean).join(" · ") : "—"}
              </p>
              {a?.landmark && <p className="text-xs text-white/40">{a.landmark}</p>}
              <h3 className="pt-2 text-[11px] font-extrabold uppercase tracking-wide text-white/40">Runner</h3>
              <p className="text-sm text-white/85">
                {o.runner_id ? (runners.find((r) => r.id === o.runner_id)?.name ?? "Unknown") : <span className="text-white/35">unassigned</span>}
              </p>
            </section>

            <section className="clay-card space-y-1.5 p-5">
              <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-white/40">Timeline</h3>
              {timeline.filter(([, t]) => t).map(([label, t]) => (
                <p key={label} className="flex justify-between gap-3 text-xs">
                  <span className="text-white/50">{label}</span>
                  <span className="text-white/75">{absolute(t)}</span>
                </p>
              ))}
            </section>
          </div>
        </div>

        <OrderActions ctx={ctx} />

        <section className="clay-card p-5">
          <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-white/40">
            What happened to this order
          </h3>
          {(logs ?? []).length === 0 ? (
            <p className="text-sm text-white/40">No recorded actions yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {((logs ?? []) as { action: string; metadata: Record<string, unknown>; created_at: string }[]).map((l, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 border-b border-white/[0.05] pb-1.5 text-xs last:border-0">
                  <span className="font-display font-extrabold text-sky-300">{l.action}</span>
                  <span className="text-white/45">{absolute(l.created_at)}</span>
                  {typeof l.metadata?.role === "string" && <span className="text-white/45">by {l.metadata.role}</span>}
                  {typeof l.metadata?.reason === "string" && <span className="text-white/70">“{l.metadata.reason}”</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </OpsShell>
  );
}
