// Operational overview — Phase 9A §11.
//
// Deliberately not a dashboard. The question this page answers is "is
// anything wrong right now, and where do I click", so exceptions come
// first, the state counts are links into the work rather than decoration,
// and there is no vanity metric on it.
//
// Everything is counted server-side with head:true count queries rather
// than pulled into the browser and length-ed — an operational page must
// not get slower as the business grows.
import Link from "next/link";
import { WarningOctagon, Pause, Package, Bicycle } from "@phosphor-icons/react/ssr";
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/lib/realtime/RealtimeRefresh";
import { CONSOLE_NAV } from "@/lib/nav";
import { ORDER_STATUSES, minutesBetween, median, rupees } from "@/lib/admin/format";

export const dynamic = "force-dynamic";

interface Overview {
  counts: Record<string, number>;
  failedValue: number;
  unassignedPacked: number;
  liveRunnerJobs: number;
  onlineRunners: number;
  stalePacked: number;
  pausedStores: { name: string; reason: string | null }[];
  openStores: number;
  ordersLastHour: number;
  medianFulfilmentMins: number | null;
  error: string | null;
}

async function load(): Promise<Overview> {
  const supabase = await createClient();
  const now = Date.now();

  const counts: Record<string, number> = {};
  const results = await Promise.all(
    ORDER_STATUSES.map(async (s) => {
      const { count } = await supabase
        .from("orders").select("id", { count: "exact", head: true }).eq("status", s);
      return [s, count ?? 0] as const;
    }),
  );
  for (const [s, c] of results) counts[s] = c;

  const [{ data: failed }, { data: packed }, { data: live }, { data: runners }, { data: stores }, { data: recent }] =
    await Promise.all([
      supabase.from("orders").select("payable").eq("status", "delivery_failed"),
      supabase.from("orders").select("packed_at").eq("status", "packed"),
      supabase.from("orders").select("id").in("status", ["assigned", "picked_up"]),
      supabase.from("runners").select("id").eq("is_online", true),
      supabase.from("stores").select("name, is_open, pause_reason"),
      supabase
        .from("orders")
        .select("placed_at, delivered_at")
        .gte("placed_at", new Date(now - 24 * 60 * 60 * 1000).toISOString())
        .limit(500),
    ]);

  const packedRows = (packed ?? []) as { packed_at: string | null }[];
  const recentRows = (recent ?? []) as { placed_at: string | null; delivered_at: string | null }[];
  const storeRows = (stores ?? []) as { name: string; is_open: boolean; pause_reason: string | null }[];

  const fulfilment = recentRows
    .map((o) => minutesBetween(o.placed_at, o.delivered_at))
    .filter((m): m is number => m !== null);

  return {
    counts,
    error: null,
    failedValue: ((failed ?? []) as { payable: number }[]).reduce((n, o) => n + o.payable, 0),
    unassignedPacked: packedRows.length,
    // A packed order nobody has claimed for 15 minutes is the thing an
    // operator should notice before the customer does.
    stalePacked: packedRows.filter((o) => o.packed_at && now - new Date(o.packed_at).getTime() > 15 * 60_000).length,
    liveRunnerJobs: (live ?? []).length,
    onlineRunners: (runners ?? []).length,
    pausedStores: storeRows.filter((s) => !s.is_open).map((s) => ({ name: s.name, reason: s.pause_reason })),
    openStores: storeRows.filter((s) => s.is_open).length,
    ordersLastHour: recentRows.filter((o) => o.placed_at && now - new Date(o.placed_at).getTime() < 3_600_000).length,
    medianFulfilmentMins: median(fulfilment),
  };
}

function Tile({
  label, value, hint, href, tone = "plain", icon,
}: {
  label: string; value: string; hint?: string; href?: string;
  tone?: "plain" | "alarm" | "warn"; icon?: React.ReactNode;
}) {
  const body = (
    <div
      className={[
        "clay-card h-full p-4 transition-colors",
        tone === "alarm" ? "!border-red-400/30 !bg-red-400/[0.08]" : "",
        tone === "warn" ? "!border-orange-400/30 !bg-orange-400/[0.07]" : "",
        href ? "hover:!bg-white/[0.07]" : "",
      ].join(" ")}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-white/45">
        {icon}
        {label}
      </div>
      <div className="font-display text-3xl font-extrabold text-white">{value}</div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-white/40">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-3xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
      {body}
    </Link>
  ) : body;
}

export default async function OverviewPage() {
  await requireAdmin();
  const o = await load();

  const failed = o.counts["delivery_failed"] ?? 0;
  const somethingWrong = failed > 0 || o.pausedStores.length > 0 || o.stalePacked > 0;

  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Overview"
      title="Operations"
      subtitle={somethingWrong ? "Something needs attention" : "Running normally"}
    >
      <RealtimeRefresh table="orders" storeId={null} />

      <div className="space-y-6">
        {/* Exceptions first. If nothing is wrong this section is a single
            quiet line rather than an empty grid of zeroes. */}
        <section aria-labelledby="exceptions">
          <h2 id="exceptions" className="mb-2 text-xs font-extrabold uppercase tracking-wide text-white/40">
            Needs attention
          </h2>
          {somethingWrong ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {failed > 0 && (
                <Tile
                  tone="alarm"
                  icon={<WarningOctagon size={14} weight="bold" />}
                  label="Failed deliveries"
                  value={String(failed)}
                  hint={`${rupees(o.failedValue)} paid and undelivered — each one needs a decision`}
                  href="/delivery-failures"
                />
              )}
              {o.pausedStores.length > 0 && (
                <Tile
                  tone="warn"
                  icon={<Pause size={14} weight="bold" />}
                  label="Paused stores"
                  value={String(o.pausedStores.length)}
                  hint={o.pausedStores.map((s) => `${s.name}${s.reason ? ` — ${s.reason}` : ""}`).join(" · ")}
                  href="/settings"
                />
              )}
              {o.stalePacked > 0 && (
                <Tile
                  tone="warn"
                  icon={<Package size={14} weight="bold" />}
                  label="Waiting over 15 min"
                  value={String(o.stalePacked)}
                  hint="Packed, paid for, and no runner has claimed it"
                  href="/orders?status=packed"
                />
              )}
            </div>
          ) : (
            <p className="clay-card p-4 text-sm text-white/55">
              Nothing failed, nothing paused, nothing stuck. {o.openStores} store
              {o.openStores === 1 ? "" : "s"} taking orders.
            </p>
          )}
        </section>

        <section aria-labelledby="flow">
          <h2 id="flow" className="mb-2 text-xs font-extrabold uppercase tracking-wide text-white/40">
            In flight
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Awaiting packing" value={String(o.counts["confirmed"] ?? 0)} href="/orders?status=confirmed" />
            <Tile label="Packed, unclaimed" value={String(o.unassignedPacked)} href="/orders?status=packed" />
            <Tile
              label="Out with runners"
              value={String(o.liveRunnerJobs)}
              icon={<Bicycle size={14} weight="bold" />}
              hint={`${o.onlineRunners} runner${o.onlineRunners === 1 ? "" : "s"} online`}
              href="/runners"
            />
            <Tile label="Delivered (all time)" value={String(o.counts["delivered"] ?? 0)} href="/orders?status=delivered" />
          </div>
        </section>

        <section aria-labelledby="rate">
          <h2 id="rate" className="mb-2 text-xs font-extrabold uppercase tracking-wide text-white/40">
            Last 24 hours
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Orders / hour" value={String(o.ordersLastHour)} hint="Placed in the last 60 minutes" />
            <Tile
              label="Median fulfilment"
              value={o.medianFulfilmentMins === null ? "—" : `${Math.round(o.medianFulfilmentMins)}m`}
              hint={o.medianFulfilmentMins === null ? "No deliveries completed yet today" : "Placed to delivered"}
            />
            <Tile label="Cancelled" value={String(o.counts["cancelled"] ?? 0)} href="/orders?status=cancelled" />
            <Tile label="Payment failed" value={String(o.counts["payment_failed"] ?? 0)} href="/orders?status=payment_failed" />
          </div>
          {/* Said plainly rather than implied by a "live" badge. */}
          <p className="mt-2 text-[11px] text-white/30">
            Counts are read when the page loads and refresh live on order changes. Rates cover the
            last 24 hours of orders, up to 500.
          </p>
        </section>
      </div>
    </OpsShell>
  );
}
