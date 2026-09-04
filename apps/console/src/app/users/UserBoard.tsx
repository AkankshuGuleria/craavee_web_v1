"use client";

// Role administration. Every guard here is a mirror of a server-side one:
// the server refuses self-demotion and requires a store for packer/runner
// whether or not this form does.
//
// What the UI can show that the server cannot: the person's current
// runner state. Demoting someone who is mid-delivery is a real
// operational mistake, so the dialog says so rather than letting the
// admin discover it from a stranded order.
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlass, UserGear } from "@phosphor-icons/react";

import { callFn, explain } from "@/lib/admin/callFn";
import { absolute } from "@/lib/admin/format";
import {
  ActionResult, ConfirmDialog, EmptyState, ErrorState, Pill, Table, Td, Th,
  btnClass, fieldClass,
} from "@craavee/ui/ops";

export interface UserRow {
  id: string;
  name: string | null;
  phone: string;
  joined: string;
  runner: { id: string; storeId: string; storeName: string; isOnline: boolean; onJob: boolean } | null;
}

// RBAC §1 exactly. No role is invented here, and `null` is not a fourth
// role — it is the absence of a staff_roles row, which IS the customer
// state.
const ROLES = [
  { value: "", label: "Customer (no staff role)" },
  { value: "packer", label: "Packer" },
  { value: "runner", label: "Runner" },
  { value: "admin", label: "Admin" },
] as const;

export function UserBoard({
  users, stores, selfId, total, page, pageSize, loadError,
}: {
  users: UserRow[];
  stores: { id: string; name: string }[];
  selfId: string;
  total: number; page: number; pageSize: number; loadError: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [editing, setEditing] = useState<{ user: UserRow; role: string; storeId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function apply(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") p.delete(k); else p.set(k, v);
    }
    if (!("page" in next)) p.delete("page");
    router.push(`/users?${p.toString()}`);
  }

  async function save() {
    if (!editing) return;
    setBusy(true); setError(null);
    const r = await callFn("assign_staff_role", {
      profileId: editing.user.id,
      role: editing.role === "" ? null : editing.role,
      ...(editing.role === "packer" || editing.role === "runner" ? { storeId: editing.storeId } : {}),
      ...(editing.role === "admin" && editing.storeId ? { storeId: editing.storeId } : {}),
    });
    setBusy(false);
    if (!r.ok) return setError(explain(r.code, r.message));
    const who = editing.user.name ?? editing.user.phone;
    setSuccess(editing.role === "" ? `${who} is now a customer.` : `${who} is now a ${editing.role}.`);
    setEditing(null);
    router.refresh();
  }

  if (loadError) {
    return <ErrorState title="Users could not be loaded." detail="Refresh the page. If it keeps failing, the database may be unreachable." />;
  }

  const needsStore = editing?.role === "packer" || editing?.role === "runner";
  const isSelf = editing?.user.id === selfId;

  return (
    <div className="space-y-3">
      <ActionResult error={error} success={success} />

      <form
        className="clay-card flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() || null }); }}
      >
        <label className="min-w-[16rem] flex-1">
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-white/40">Name or phone</span>
          <div className="relative">
            <MagnifyingGlass size={14} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input className={fieldClass + " pl-8"} placeholder="Meera, or 9000001201" value={q}
                   onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
          </div>
        </label>
        <button type="submit" className={btnClass}>Search</button>
        {params.get("q") && (
          <button type="button" className={btnClass} onClick={() => { setQ(""); router.push("/users"); }}>Clear</button>
        )}
      </form>

      {/* Said plainly rather than left as a puzzle: the roster cannot show
          a packer/admin badge because staff_roles is unreadable through
          PostgREST by design. */}
      <p className="px-1 text-[11px] text-white/30">
        Runner status comes from the <code>runners</code> table. Packer and admin grants are not listed here —
        <code> staff_roles</code> has no client read policy at all (RBAC §5), so the Console can write a role through
        <code> assign_staff_role</code> but cannot read one back. Changes are visible in the audit log.
      </p>

      {users.length === 0 ? (
        <EmptyState title="No users match" hint="Search by name, or by the last few digits of a phone number." />
      ) : (
        <>
          <Table label="Users">
            <thead>
              <tr>
                <Th>Person</Th><Th>Phone</Th><Th>Runner</Th><Th>Joined</Th><Th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-white/[0.03]">
                  <Td>
                    <span className="font-semibold text-white/90">{u.name ?? <span className="text-white/40">Unnamed</span>}</span>
                    {u.id === selfId && <span className="ml-2 text-[10px] font-extrabold text-sky-300">you</span>}
                  </Td>
                  <Td className="font-mono text-xs text-white/65">{u.phone}</Td>
                  <Td>
                    {u.runner ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={u.runner.isOnline ? "done" : "dead"}>{u.runner.isOnline ? "online" : "offline"}</Pill>
                        <span className="text-[11px] text-white/50">{u.runner.storeName}</span>
                        {u.runner.onJob && <Pill tone="live">on a job</Pill>}
                      </span>
                    ) : <span className="text-white/30">—</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-white/50">{absolute(u.joined)}</Td>
                  <Td className="text-right">
                    <button type="button" className={btnClass}
                      onClick={() => { setSuccess(null); setError(null); setEditing({ user: u, role: u.runner ? "runner" : "", storeId: u.runner?.storeId ?? stores[0]?.id ?? "" }); }}>
                      <UserGear size={12} weight="bold" className="mr-1 inline" /> Change role
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <nav className="flex items-center justify-between gap-3 px-1" aria-label="Pagination">
            <p className="text-xs text-white/40">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-IN")}
            </p>
            <div className="flex gap-2">
              <button type="button" className={btnClass} disabled={page <= 1} onClick={() => apply({ page: String(page - 1) })}>
                <CaretLeft size={12} weight="bold" className="mr-1 inline" /> Previous
              </button>
              <button type="button" className={btnClass} disabled={page >= lastPage} onClick={() => apply({ page: String(page + 1) })}>
                Next <CaretRight size={12} weight="bold" className="ml-1 inline" />
              </button>
            </div>
          </nav>
        </>
      )}

      <ConfirmDialog
        open={editing !== null}
        title={editing ? `Change role — ${editing.user.name ?? editing.user.phone}` : ""}
        confirmLabel="Change the role"
        confirmDisabled={!editing || (needsStore && !editing.storeId) || isSelf}
        busy={busy}
        error={error}
        onCancel={() => { setEditing(null); setError(null); }}
        onConfirm={save}
        impact={
          editing ? (
            <>
              {isSelf ? (
                <b className="text-red-200">This is your own account. An admin cannot change their own role — the
                server refuses it, so that the last admin cannot lock everyone out.</b>
              ) : editing.role === "" ? (
                <>Their staff role is removed and they become an ordinary customer. Any existing{" "}
                <code className="text-white/60">runners</code> row stays, so re-granting runner later keeps their history.</>
              ) : editing.role === "runner" ? (
                <>They can claim and deliver jobs at the selected store. If they have no{" "}
                <code className="text-white/60">runners</code> row yet, one is created — without it they cannot be
                assigned an order at all (D28).</>
              ) : editing.role === "admin" ? (
                <><b className="text-white/85">Full administrative access</b>, including refunds, cancellations, the
                kill switch and role changes for everyone else. Leave the store blank for all-store scope.</>
              ) : (
                <>They can pack orders at the selected store, and see nothing outside it.</>
              )}
              {editing.user.runner?.onJob && editing.role !== "runner" && (
                <> <b className="text-orange-200">They are carrying an order right now</b> — reassign it first, or the
                delivery is stranded.</>
              )}
            </>
          ) : null
        }
      >
        {editing && (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-white/60">Role</span>
              <select className={fieldClass} value={editing.role} disabled={isSelf}
                      onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            {(needsStore || editing.role === "admin") && (
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/60">
                  Store {editing.role === "admin" && <span className="text-white/35">(optional — blank means all stores)</span>}
                </span>
                <select className={fieldClass} value={editing.storeId} disabled={isSelf}
                        onChange={(e) => setEditing({ ...editing, storeId: e.target.value })}>
                  {editing.role === "admin" && <option value="">All stores</option>}
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
