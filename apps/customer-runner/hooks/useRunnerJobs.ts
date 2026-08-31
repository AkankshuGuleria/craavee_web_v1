/**
 * Runner queue + active job — Phase 7 §5/§18.
 *
 * Server state lives in TanStack Query, never in Zustand: which job a
 * runner holds is decided by the database, so caching it in a client
 * store would create a second, divergent answer to a question only the
 * server can answer (§18). Every mutation invalidates rather than
 * patching local state.
 *
 * The queue query relies on RLS, not on a client-side filter: the
 * `orders_select` policy (migration 0003) already restricts a runner to
 * `status = 'packed'` at their own store plus their own assignment, so
 * even a tampered client cannot widen it. The `.eq("status", ...)` calls
 * below are for correctness of the two lists, not for security.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "../lib/supabase";

export interface QueueJob {
  id: string;
  placedAt: string;
  itemCount: number;
  block: string | null;
  floor: string | null;
  room: string | null;
  landmark: string | null;
}

export interface ActiveJob extends QueueJob {
  status: "assigned" | "picked_up";
}

/** Deliberately narrow (§16): enough to find the door and carry the bag.
 *  No payable, no wallet, no payment reference, no customer profile. */
const JOB_COLUMNS =
  "id, placed_at, status, addresses:address_id (block, floor, room, landmark), order_items (id)";

interface RawJob {
  id: string;
  placed_at: string;
  status: string;
  addresses: { block: string | null; floor: string | null; room: string | null; landmark: string | null } | null;
  order_items: { id: string }[] | null;
}

function shape(r: RawJob) {
  return {
    id: r.id,
    placedAt: r.placed_at,
    itemCount: (r.order_items ?? []).length,
    block: r.addresses?.block ?? null,
    floor: r.addresses?.floor ?? null,
    room: r.addresses?.room ?? null,
    landmark: r.addresses?.landmark ?? null,
  };
}

/** Claimable jobs: packed and unassigned, oldest first. */
export function useRunnerQueue() {
  return useQuery({
    queryKey: ["runner", "queue"],
    queryFn: async (): Promise<QueueJob[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select(JOB_COLUMNS)
        .eq("status", "packed")
        .is("runner_id", null)
        .order("placed_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as RawJob[]).map(shape);
    },
    // The queue is contended, so a stale list is actively misleading.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** The runner's own live job, if any. At most one exists — the database
 *  guarantees it (partial unique index, D13). */
export function useActiveJob() {
  return useQuery({
    queryKey: ["runner", "active"],
    queryFn: async (): Promise<ActiveJob | null> => {
      const { data, error } = await supabase
        .from("orders")
        .select(JOB_COLUMNS)
        .in("status", ["assigned", "picked_up"])
        .limit(1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as RawJob[];
      if (rows.length === 0) return null;
      return { ...shape(rows[0]), status: rows[0].status as "assigned" | "picked_up" };
    },
    staleTime: 0,
  });
}

interface Envelope { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string } }

/** supabase-js does NOT put a non-2xx body on `data` - it raises and
 *  hangs the Response off `error.context`. Reading only `data` therefore
 *  loses every canonical error code and collapses "wrong delivery code"
 *  into a generic retry prompt, which tells the runner to try again when
 *  they should be asking the customer for the right code. Same unwrap the
 *  customer checkout path already uses (hooks/useCreateOrder.ts). */
async function safeJson(err: unknown): Promise<Envelope | null> {
  try {
    const ctx = (err as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") return (await ctx.json()) as Envelope;
  } catch {
    // fall through to the generic code below
  }
  return null;
}

async function invoke(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const invoked = await supabase.functions.invoke(name, { body });
  const envelope: Envelope =
    (invoked.error ? await safeJson(invoked.error) : (invoked.data as Envelope)) ??
    { ok: false, error: { code: "SERVICE_UNAVAILABLE" } };

  if (!envelope.ok || envelope.error) throw { code: envelope.error?.code ?? "SERVICE_UNAVAILABLE" };
  return envelope.data ?? {};
}

/** After any mutation the authoritative state is re-read, never patched
 *  locally (§18) — the server decides who holds what. */
function useRunnerMutation<TVars>(fn: (v: TVars) => Promise<Record<string, unknown>>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["runner", "queue"] });
      qc.invalidateQueries({ queryKey: ["runner", "active"] });
    },
  });
}

export function useClaimJob() {
  return useRunnerMutation<{ orderId: string }>((v) => invoke("claim_job", { orderId: v.orderId }));
}

export function useMarkPickedUp() {
  return useRunnerMutation<{ orderId: string }>((v) => invoke("mark_picked_up", { orderId: v.orderId }));
}

export function useReleaseJob() {
  return useRunnerMutation<{ orderId: string; reason?: string }>((v) =>
    invoke("release_job", { orderId: v.orderId, ...(v.reason ? { reason: v.reason } : {}) }),
  );
}

/** Phase 8: the exit a runner previously did not have. `picked_up` goes
 *  only to `delivered` or `delivery_failed`, so a runner holding a bag
 *  they cannot hand over had no way out at all. */
export function useMarkDeliveryFailed() {
  return useRunnerMutation<{ orderId: string; reason: string }>((v) =>
    invoke("mark_delivery_failed", { orderId: v.orderId, reason: v.reason }),
  );
}

export function useVerifyDeliveryCode() {
  return useRunnerMutation<{ orderId: string; code: string }>((v) =>
    invoke("verify_delivery_code", { orderId: v.orderId, code: v.code }),
  );
}
