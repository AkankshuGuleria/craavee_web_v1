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

// `payments` is deliberately not readable through PostgREST — it carries
// gateway refs and raw_event, so RBAC_MATRIX.md §5 routes reads through
// two column-restricted views instead. This page uses the admin one; the
// base table is never queried from a browser.
const PAYMENTS_VIEW = "payments_admin_view";
const REFUNDS_VIEW = "refunds_admin_view";

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

  // The base `refunds` table is unreadable from a browser even for an
  // admin — its policy joins `payments`, which is ungranted by design —
  // so this reads the admin view added in 0012 §4.
  const { data, count, error } = await supabase
    .from(REFUNDS_VIEW)
    .select("id, payment_id, amount, reason, created_at, actor_id, order_id, payment_amount, payment_refunded",
            { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const refunds: RefundRow[] = ((data ?? []) as {
    id: string; payment_id: string; amount: number; reason: string | null;
    created_at: string; actor_id: string | null;
    order_id: string; payment_amount: number; payment_refunded: number;
  }[]).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    amount: r.amount,
    reason: r.reason,
    at: r.created_at,
    capturedTotal: r.payment_amount,
    refundedTotal: r.payment_refunded,
  }));

  // Orders an admin could refund right now, so the page is a place to act
  // and not only a ledger. `captured` with something left is the whole
  // condition — process_refund re-checks it and owns the decision.
  const q = (sp.q ?? "").trim().replace(/^#/, "");
  let live = supabase
    .from(PAYMENTS_VIEW)
    .select("order_id, amount, refunded_amount, status")
    .eq("status", "captured")
    .order("created_at", { ascending: false })
    .limit(25);
  if (/^[0-9a-f]{4,}$/i.test(q)) live = live.ilike("order_id", `${q}%`);

  const { data: liveRows } = await live;
  const captured = ((liveRows ?? []) as {
    order_id: string; amount: number; refunded_amount: number;
  }[]).filter((p) => p.amount - p.refunded_amount > 0);

  const { data: orderRows } = captured.length
    ? await supabase.from("orders").select("id, status, placed_at").in("id", captured.map((p) => p.order_id))
    : { data: [] };
  const orderById = new Map(((orderRows ?? []) as {
    id: string; status: string; placed_at: string | null;
  }[]).map((o) => [o.id, o]));

  const refundable: RefundableOrder[] = captured.map((p) => {
    const o = orderById.get(p.order_id);
    return {
      orderId: p.order_id,
      status: o?.status ?? "unknown",
      placedAt: o?.placed_at ?? null,
      captured: p.amount,
      alreadyRefunded: p.refunded_amount,
      remaining: p.amount - p.refunded_amount,
    };
  });

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
