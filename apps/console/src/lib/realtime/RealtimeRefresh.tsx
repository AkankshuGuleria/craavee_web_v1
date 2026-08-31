"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Staff Realtime — D21, Phase 8 §11/§19/§21.
 *
 * Subscribes to Postgres Changes on one table and, when something
 * relevant changes, calls `router.refresh()` so the surrounding **server**
 * component re-runs its RLS-scoped query.
 *
 * That indirection is the whole design, and it is deliberate:
 *
 *   * The payload is never rendered. Nothing here trusts what arrived on
 *     the socket — it is only a hint that "something changed, go ask the
 *     database again". Realtime is a delivery mechanism, never a source
 *     of truth (Phase 8 final principle).
 *   * Duplicate events are therefore free. A refresh is idempotent, so
 *     two events for one change produce one correct render rather than a
 *     duplicated row (§19: "do not duplicate orders on repeated events").
 *     This matters — the local stack was observed emitting two events for
 *     a single UPDATE.
 *   * A missed event costs correctness nothing. Any navigation refetches,
 *     and the subscription refetches once on SUBSCRIBED. Realtime removes
 *     the wait, it does not carry the state. It has to be this way: the
 *     stack authorizes an event lazily, so an order that has already
 *     moved past a status this staff member can read stops delivering its
 *     earlier events as well.
 *
 * The socket is authorized before it joins, not after. Realtime binds a
 * postgres_changes subscription to whatever token the socket holds at
 * JOIN time and does not re-authorize it later, so subscribing before the
 * session has been read out of cookies produces a channel registered as
 * `anon` that silently receives nothing forever. That was observed
 * directly: realtime.subscription.claims_role came back 'anon' for a
 * signed-in admin, and the board never updated. `getSession()` is the
 * right call here even though it is not a verified read — the token is
 * only being handed to the server, which verifies it. Nothing on this
 * page trusts it.
 *
 * Authorization itself is not implemented here. Supabase Realtime
 * evaluates the same RLS policies as the table, so a store-A packer
 * receives nothing for store B even if they remove the filter below or
 * guess a channel name. Verified directly against the local stack: a
 * store-A change delivered 2 events to the store-A packer and 0 to a
 * packer at another store. (A customer would receive their own order
 * rows — ownership, not silence, is what the policy grants them — which
 * is why D20's "customers poll" is enforced in the customer app rather
 * than assumed from RLS.)
 *
 * `storeId` is null for an admin (all-store scope), in which case no
 * filter is sent and RLS alone decides what arrives.
 */
export function RealtimeRefresh({
  table,
  storeId,
}: {
  table: "orders" | "inventory";
  storeId: string | null;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(true);
  // A ref, not state: changing it must never re-run the effect and tear
  // the subscription down.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(storeId ? `store:${storeId}:${table}` : `all:${table}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            // A bandwidth optimisation, not the security boundary.
            ...(storeId ? { filter: `store_id=eq.${storeId}` } : {}),
          },
          () => {
            // Coalesce a burst — packing an order fires several row events
            // in quick succession and one refresh covers all of them.
            if (pending.current) clearTimeout(pending.current);
            pending.current = setTimeout(() => router.refresh(), 250);
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setConnected(true);
            // Recover anything missed while disconnected. The client must
            // never assume every event arrived (§18).
            router.refresh();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnected(false);
          }
        });
    })();

    return () => {
      cancelled = true;
      if (pending.current) clearTimeout(pending.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [table, storeId, router]);

  if (connected) return null;

  // Honest about degraded state rather than silently showing stale rows.
  return (
    <p className="px-1 py-2 text-sm text-amber-700" role="status">
      Live updates disconnected — reconnecting. Refresh to see the latest.
    </p>
  );
}
