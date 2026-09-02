// Users and staff administration — Phase 9B.
//
// Role changes go through `assign_staff_role` (built in 9A), which is the
// ONLY write path into `staff_roles` — the table has no client-facing RLS
// policy at all, for any role (RBAC §5). The admin check lives inside the
// function because the service role bypasses RLS, so there is no policy
// underneath to catch a mistake.
//
// Two guards worth knowing while reading the UI, both enforced server-
// side and merely reflected here: an admin cannot strip their own admin
// role (locking the door from the inside), and granting `runner` creates
// the `runners` row that D28 requires for the person to be assignable at
// all.
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONSOLE_NAV } from "@/lib/nav";

import { UserBoard, type UserRow } from "./UserBoard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function ConsoleUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; page?: string }>;
}) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const supabase = await createClient();

  // staff_roles is unreadable through PostgREST by design, so the roster
  // is assembled from the two tables an admin CAN read: profiles, and
  // runners (admin policy). A profile with neither is a customer — "no
  // row" IS the customer state, so there is nothing to look up.
  let query = supabase.from("profiles").select("id, full_name, phone, created_at", { count: "exact" });
  const q = (sp.q ?? "").trim();
  if (q) {
    const digits = q.replace(/[^0-9]/g, "");
    query = digits.length >= 4
      ? query.ilike("phone", `%${digits}%`)
      : query.ilike("full_name", `%${q}%`);
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const profiles = ((data ?? []) as { id: string; full_name: string | null; phone: string; created_at: string }[]);

  const [{ data: runnerRows }, { data: storeRows }] = await Promise.all([
    supabase.from("runners").select("id, profile_id, store_id, is_online"),
    supabase.from("stores").select("id, name").order("name"),
  ]);
  const runners = new Map(((runnerRows ?? []) as {
    id: string; profile_id: string; store_id: string; is_online: boolean;
  }[]).map((r) => [r.profile_id, r]));
  const stores = ((storeRows ?? []) as { id: string; name: string }[]);
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  // Live job per runner, so an admin can see before demoting someone that
  // they are mid-delivery.
  const { data: liveRows } = await supabase
    .from("orders").select("runner_id").in("status", ["assigned", "picked_up"]).not("runner_id", "is", null);
  const busy = new Set(((liveRows ?? []) as { runner_id: string }[]).map((o) => o.runner_id));

  const users: UserRow[] = profiles.map((p) => {
    const r = runners.get(p.id);
    return {
      id: p.id,
      name: p.full_name,
      phone: p.phone,
      joined: p.created_at,
      runner: r ? { id: r.id, storeId: r.store_id, storeName: storeName.get(r.store_id) ?? "—", isOnline: r.is_online, onJob: busy.has(r.id) } : null,
    };
  });

  const total = count ?? 0;
  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Users"
      title="Users & staff"
      subtitle={
        error ? "Could not load users"
          : `${total.toLocaleString("en-IN")} profile${total === 1 ? "" : "s"} · page ${page} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`
      }
    >
      <UserBoard
        users={users}
        stores={stores}
        selfId={admin.userId}
        total={total} page={page} pageSize={PAGE_SIZE}
        loadError={error?.message ?? null}
      />
    </OpsShell>
  );
}
