// Refund administration — Phase 9B.
//
// This page issues nothing itself. It reads the refund history and hands
// the actual work to the Phase 5 `refund` Edge Function, which is the
// only path that moves money: one transaction across
// payments/refunds/wallet_ledger/orders, idempotency-keyed, with the
// amount computed server-side.
//
// The browser never chooses how much money moves. It may propose a
// partial CAP; `refund` treats it as an upper bound and refuses anything
// above the remaining captured amount (REFUND_EXCEEDS_CAPTURED). Omitting
// it means "the full remaining amount", which is also what every
// cancellation row in the state machine specifies.
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONSOLE_NAV } from "@/lib/nav";

import { RefundBoard, type RefundRow, type RefundableOrder } from "./RefundBoard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function ConsoleRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const supabase = await createClient();

  const { data, count, error } = await supabase
    .from("refunds")
    .select("id, payment_id, amount, reason, destination, created_at, actor_id, payments!inner(order_id, amount, refunded_amount)",
            { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const rows = ((data ?? []) as unknown as {
    id: string; payment_id: string; amount: number; reason: string | null;
    destination: string; created_at: string; actor_id: string | null;
    payments: { order_id: string; amount: number; refunded_amount: number };
  }[]);

  const refunds: RefundRow[] = rows.map((r) => ({
    id: r.id,
    orderId: r.payments.order_id,
    amount: r.amount,
    reason: r.reason,
    destination: r.destination,
    at: r.created_at,
    capturedTotal: r.payments.amount,
    refundedTotal: r.payments.refunded_amount,
  }));

  // Orders an admin could refund right now, so the page is a place to act
  // and not only a ledger. `captured` with something left is the whole
  // condition — process_refund re-checks it and owns the decision.
  const q = (sp.q ?? "").trim().replace(/^#/, "");
  let live = supabase
    .from("payments")
    .select("order_id, amount, refunded_amount, status, orders!inner(status, placed_at)")
    .eq("status", "captured")
    .order("created_at", { ascending: false })
    .limit(25);
  if (/^[0-9a-f]{4,}$/i.test(q)) live = live.ilike("order_id", `${q}%`);

  const { data: liveRows } = await live;
  const refundable: RefundableOrder[] = ((liveRows ?? []) as unknown as {
    order_id: string; amount: number; refunded_amount: number;
    orders: { status: string; placed_at: string | null };
  }[])
    .filter((p) => p.amount - p.refunded_amount > 0)
    .map((p) => ({
      orderId: p.order_id,
      status: p.orders.status,
      placedAt: p.orders.placed_at,
      captured: p.amount,
      alreadyRefunded: p.refunded_amount,
      remaining: p.amount - p.refunded_amount,
    }));

  const total = count ?? 0;
  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Refunds"
      title="Refunds"
      subtitle={error ? "Could not load refunds" : `${total.toLocaleString("en-IN")} issued · page ${page} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`}
    >
      <RefundBoard
        refunds={refunds}
        refundable={refundable}
        total={total} page={page} pageSize={PAGE_SIZE}
        loadError={error?.message ?? null}
      />
    </OpsShell>
  );
}
