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
 *   * A missed event costs correctness nothing. The page still has its
 *     normal `revalidate`, and any navigation refetches. Realtime removes
 *     the wait, it does not carry the state.
 *
 * Authorization is not implemented here. Supabase Realtime evaluates the
 * same RLS policies as the table, so a store-A packer receives nothing
 * for store B even if they remove the filter below or guess a channel
 * name. Verified directly against the local stack: a store-A change
 * delivered 2 events to the store-A packer, 0 to a packer at another
 * store, and 0 to a customer.
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
    const channel = supabase
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

    return () => {
      if (pending.current) clearTimeout(pending.current);
      void supabase.removeChannel(channel);
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
