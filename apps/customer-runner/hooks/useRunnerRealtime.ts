/**
 * Runner Realtime — D21, Phase 8 §11/§20.
 *
 * Subscribes to Postgres Changes on `orders` for the runner's own store
 * and, on any relevant change, invalidates the queue and active-job
 * queries so TanStack Query refetches from the database.
 *
 * The payload is never written into cache. That is the point (§20: "do
 * not let Realtime mutate authoritative local state without
 * validation"). An event is a hint that something changed; the answer
 * still comes from a fresh RLS-scoped read. Consequences:
 *
 *   * Duplicate events are free — two invalidations produce one refetch
 *     and one correct list, never a duplicated row. The local stack was
 *     observed emitting two events for a single UPDATE, so this is not
 *     hypothetical.
 *   * A missed event costs nothing. The queries are already `staleTime:
 *     0` and refetch on focus, and every mutation invalidates. Realtime
 *     removes the wait; it does not carry the state.
 *   * On (re)subscribe we invalidate immediately, so anything that
 *     changed while the socket was down is picked up (§18).
 *
 * Authorization is RLS, not this file. `orders_select` (migration 0003)
 * scopes a runner to packed rows at their own store plus their own
 * assignment, and Supabase Realtime applies the same policies — verified
 * against the local stack: a store-A change delivered 0 events to a
 * runner at another store.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "../lib/supabase";

export type RealtimeStatus = "connecting" | "live" | "offline";

export function useRunnerRealtime(storeId: string | null): RealtimeStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  useEffect(() => {
    if (!storeId) return;

    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["runner", "queue"] });
      qc.invalidateQueries({ queryKey: ["runner", "active"] });
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      // Realtime binds the subscription to whatever token the socket holds
      // when the channel JOINs, and never re-authorizes it afterwards. A
      // channel opened before the session is restored registers as `anon`
      // and then receives nothing, permanently — observed on the web
      // surfaces, where realtime.subscription.claims_role came back 'anon'
      // for a signed-in staff member. `storeId` here already implies a
      // session, but the token is set explicitly so the ordering is a
      // property of this file rather than a coincidence upstream.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(`store:${storeId}:orders`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` },
          refresh,
        )
        .subscribe((s) => {
          if (s === "SUBSCRIBED") {
            setStatus("live");
            // Recover whatever was missed while disconnected.
            refresh();
          } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            setStatus("offline");
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [storeId, qc]);

  return status;
}

/** The signed-in runner's store, read from their own `runners` row.
 *  Resolved server-side through RLS (`runners_select` allows
 *  `profile_id = auth.uid()`), never taken from client state. */
export function useRunnerStore() {
  const [storeId, setStoreId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("runners").select("store_id").limit(1).maybeSingle();
      if (!cancelled) setStoreId((data as { store_id: string } | null)?.store_id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return storeId;
}
