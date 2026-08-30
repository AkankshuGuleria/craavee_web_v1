import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../lib/auth/AuthProvider";
import { supabase } from "../lib/supabase";

/**
 * Reads the authenticated customer's own `profiles` row — Phase 3 §9.
 *
 * Creates nothing: the row already exists by the time this ever runs,
 * written by the `handle_new_user` trigger on first sign-in (
 * `supabase/migrations/0002_triggers_and_functions.sql`). This is a read
 * through the existing RLS policy (`profiles_select`,
 * `0003_rls_policies.sql`: `id = auth.uid()` for a customer's own row) —
 * no new profile-creation API, per the explicit instruction.
 */
export function useProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, phone, full_name, wallet_balance, created_at")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}
