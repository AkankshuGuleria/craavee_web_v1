// Audit log viewer — Phase 9B. Read-only, and structurally so: the table
// has a SELECT policy for admin and no INSERT/UPDATE/DELETE policy for
// any client role at all (RBAC §5). Append-only is a property of the
// database, not a discipline this page observes.
//
// What is deliberately not rendered: the raw `metadata` blob. It is
// written by trusted server code and is not supposed to contain secrets,
// but dumping arbitrary JSON to the screen is how a future field leaks by
// accident. Only known-safe keys are read out — reason, amounts, before/
// after values, role, ids — and anything else is summarised as a count.
import { OpsShell } from "@craavee/ui";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONSOLE_NAV } from "@/lib/nav";

import { AuditBoard, type AuditRow } from "./AuditBoard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ConsoleAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; actor?: string; target?: string; from?: string; to?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const supabase = await createClient();

  let query = supabase
    .from("audit_logs")
    .select("id, actor_id, action, entity_type, entity_id, metadata, created_at", { count: "exact" });

  if (sp.action) query = query.eq("action", sp.action);
  if (sp.entity) query = query.eq("entity_type", sp.entity);
  if (sp.actor) query = query.eq("actor_id", sp.actor);
  const target = (sp.target ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{4,}$/i.test(target)) query = query.ilike("entity_id", `${target}%`);
  if (sp.from) query = query.gte("created_at", new Date(sp.from).toISOString());
  if (sp.to) {
    const end = new Date(sp.to);
    end.setHours(23, 59, 59, 999);
    query = query.lte("created_at", end.toISOString());
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const raw = ((data ?? []) as {
    id: string; actor_id: string | null; action: string; entity_type: string;
    entity_id: string; metadata: Record<string, unknown>; created_at: string;
  }[]);

  // Actor names for the ids on this page only — one query, not one per
  // row.
  const actorIds = [...new Set(raw.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const { data: actorRows } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const actorName = new Map(((actorRows ?? []) as { id: string; full_name: string | null }[])
    .map((p) => [p.id, p.full_name]));

  // The allowlist. A key not named here is never rendered.
  const SAFE = new Set([
    "reason", "role", "fromStatus", "from", "to", "delta", "reserved",
    "priceFrom", "priceTo", "mrpFrom", "mrpTo", "listedFrom", "listedTo",
    "isOpen", "wasOpen", "maxQueueDepth", "settledCount", "totalAmount",
    "previousRole", "name", "amount", "refundedAmount", "destination",
    "linesPacked", "unitsPacked", "outcome", "gateway",
  ]);

  const rows: AuditRow[] = raw.map((r) => {
    const meta = r.metadata ?? {};
    const shown: [string, string][] = [];
    let hidden = 0;
    for (const [k, v] of Object.entries(meta)) {
      if (!SAFE.has(k) || v === null || v === undefined || v === "") { if (!SAFE.has(k)) hidden += 1; continue; }
      shown.push([k, typeof v === "object" ? "…" : String(v)]);
    }
    return {
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      actorId: r.actor_id,
      actorName: r.actor_id ? (actorName.get(r.actor_id) ?? null) : null,
      at: r.created_at,
      details: shown,
      hiddenCount: hidden,
    };
  });

  // Distinct actions for the filter, from a bounded recent window rather
  // than the whole table.
  const { data: actionRows } = await supabase
    .from("audit_logs").select("action").order("created_at", { ascending: false }).limit(1000);
  const actions = [...new Set(((actionRows ?? []) as { action: string }[]).map((a) => a.action))].sort();

  const total = count ?? 0;
  return (
    <OpsShell
      brand="Craavee Console"
      navItems={CONSOLE_NAV}
      active="Audit"
      title="Audit log"
      subtitle={error ? "Could not load the audit log" : `${total.toLocaleString("en-IN")} record${total === 1 ? "" : "s"} · page ${page} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`}
    >
      <AuditBoard
        rows={rows} actions={actions} total={total} page={page} pageSize={PAGE_SIZE}
        loadError={error?.message ?? null}
      />
    </OpsShell>
  );
}
