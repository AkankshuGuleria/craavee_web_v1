// Runner operations — Phase 9A §8.
//
// Operationally useful, not a workforce platform (§8 is explicit about
// that). The questions it answers: who is on shift, what are they
// carrying right now, how long have they had it, and who is free if I
// need to move a job.
//
// One thing it deliberately does NOT offer: toggling a runner's
// availability. `runners_update` (0003) is scoped to
// `profile_id = auth.uid()` — a runner controls their own is_online and
// an admin has read access only. There is no backend capability to
// change it on their behalf, so there is no button pretending otherwise.
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/lib/realtime/RealtimeRefresh";
import { CONSOLE_NAV } from "@/lib/nav";

import { RunnerBoard, type RunnerRow } from "./RunnerBoard";

export const dynamic = "force-dynamic";

/** Kept out of the component body deliberately: `Date.now()` is impure
 *  and must not run during render (react-hooks/purity). Reading it once
 *  here also means every "8m ago" on a single render is measured from the
 *  same instant. */
async function loadRunners() {
  const now = Date.now();
  const supabase = await createClient();

  const [{ data: runnerRows, error }, { data: storeRows }] = await Promise.all([
    supabase.from("runners").select("id, store_id, is_online, joined_at, profiles(full_name, phone)").order("joined_at"),
    supabase.from("stores").select("id, name"),
  ]);

  const runners = ((runnerRows ?? []) as unknown as {
    id: string; store_id: string; is_online: boolean; joined_at: string;
    profiles: { full_name: string | null; phone: string | null } | null;
  }[]);
  const storeName = new Map(((storeRows ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  // Live jobs, and how long each has been held — a picked_up order that
  // has been out for 40 minutes is the row worth looking at.
  const { data: liveRows } = await supabase
    .from("orders")
    .select("id, runner_id, status, assigned_at, picked_up_at")
    .in("status", ["assigned", "picked_up"])
    .not("runner_id", "is", null);
  const live = new Map(
    ((liveRows ?? []) as { id: string; runner_id: string; status: string; assigned_at: string | null; picked_up_at: string | null }[])
      .map((o) => [o.runner_id, o]),
  );

  // Recent throughput, from the earnings rows verify_delivery_code
  // writes on delivery (#11) — already-supported activity, not new
  // tracking.
  const since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: earnRows } = await supabase
    .from("runner_earnings").select("runner_id, amount, settled_at, created_at").gte("created_at", since);
  const delivered = new Map<string, { count: number; unsettled: number }>();
  for (const e of ((earnRows ?? []) as { runner_id: string; amount: number; settled_at: string | null }[])) {
    const cur = delivered.get(e.runner_id) ?? { count: 0, unsettled: 0 };
    cur.count += 1;
    if (!e.settled_at) cur.unsettled += e.amount;
    delivered.set(e.runner_id, cur);
  }

  const rows: RunnerRow[] = runners.map((r) => {
    const job = live.get(r.id);
    const stats = delivered.get(r.id);
    return {
      id: r.id,
      name: r.profiles?.full_name ?? "Unnamed runner",
      storeId: r.store_id,
      storeName: storeName.get(r.store_id) ?? "—",
      isOnline: r.is_online,
      job: job
        ? { orderId: job.id, status: job.status, since: job.status === "picked_up" ? job.picked_up_at : job.assigned_at }
        : null,
      deliveredThisWeek: stats?.count ?? 0,
      unsettled: stats?.unsettled ?? 0,
    };
  });

  return { rows, now, error: error?.message ?? null };
}

export default async function ConsoleRunnersPage() {
  await requireAdmin();
  const { rows, now, error } = await loadRunners();
  const onShift = rows.filter((r) => r.isOnline).length;
  const carrying = rows.filter((r) => r.job).length;

  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Runners"
      title="Runners"
      subtitle={error ? "Could not load runners" : `${onShift} online · ${carrying} carrying an order`}
    >
      <RealtimeRefresh table="orders" storeId={null} />
      <RunnerBoard runners={rows} now={now} loadError={error} />
    </OpsShell>
  );
}
