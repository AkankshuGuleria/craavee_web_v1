import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../lib/auth/AuthProvider";
import { supabase } from "../lib/supabase";

/**
 * Structured campus addresses — Phase 4 prompt §5, DATABASE_SPEC.md §5,
 * D15. No free-text delivery address: a customer picks a `zone`, then
 * fills `block` / `floor` / `room` (+ an optional `landmark` for
 * runner-readability only). Reads/writes go through the existing
 * `addresses` RLS policy (`customer_id = auth.uid()`,
 * `0003_rls_policies.sql`).
 *
 * Serviceability is NOT resolved or cached here — it is a live
 * `zones.is_serviceable` check inside `create_order` at checkout
 * (DATABASE_SPEC.md §5), so a paused zone takes effect immediately for
 * every saved address.
 */
export interface Zone {
  id: string;
  name: string;
  deliveryFee: number;
  isServiceable: boolean;
}

export interface Address {
  id: string;
  zoneId: string;
  zoneName: string;
  deliveryFee: number;
  isServiceable: boolean;
  block: string;
  floor: string | null;
  room: string;
  landmark: string | null;
  isDefault: boolean;
}

export function useZones() {
  return useQuery({
    queryKey: ["zones"],
    queryFn: async (): Promise<Zone[]> => {
      const { data, error } = await supabase
        .from("zones")
        .select("id, name, delivery_fee, is_serviceable")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((z) => ({
        id: z.id,
        name: z.name,
        deliveryFee: z.delivery_fee,
        isServiceable: z.is_serviceable,
      }));
    },
    staleTime: 5 * 60_000,
  });
}

export function useAddresses() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["addresses", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Address[]> => {
      const { data, error } = await supabase
        .from("addresses")
        .select("id, zone_id, block, floor, room, landmark, is_default, zones(name, delivery_fee, is_serviceable)")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((a) => {
        const zone = (Array.isArray(a.zones) ? a.zones[0] : a.zones) as
          | { name: string; delivery_fee: number; is_serviceable: boolean }
          | null;
        return {
          id: a.id,
          zoneId: a.zone_id,
          zoneName: zone?.name ?? "",
          deliveryFee: zone?.delivery_fee ?? 0,
          isServiceable: zone?.is_serviceable ?? false,
          block: a.block,
          floor: a.floor,
          room: a.room,
          landmark: a.landmark,
          isDefault: a.is_default,
        };
      });
    },
  });
}

export interface NewAddress {
  zoneId: string;
  block: string;
  floor?: string;
  room: string;
  landmark?: string;
  isDefault?: boolean;
}

export function useCreateAddress() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (input: NewAddress): Promise<string> => {
      const { data, error } = await supabase
        .from("addresses")
        .insert({
          customer_id: session!.user.id, // RLS `with check (customer_id = auth.uid())` is the real guard
          zone_id: input.zoneId,
          block: input.block.trim(),
          floor: input.floor?.trim() || null,
          room: input.room.trim(),
          landmark: input.landmark?.trim() || null,
          is_default: input.isDefault ?? false,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["addresses"] }),
  });
}
