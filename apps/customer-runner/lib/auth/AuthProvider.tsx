import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "../supabase";
import type { Role } from "./resolveRouteAccess";

interface AuthContextValue {
  session: Session | null;
  /**
   * The server-verified `role` claim (D8: `custom_access_token_hook`,
   * `supabase/migrations/0002_triggers_and_functions.sql`) — `null` while
   * loading or unauthenticated. Never derived from `session.user` alone;
   * see the `getClaims()` call below.
   */
  role: Role | null;
  storeId: string | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Reads and verifies the JWT's custom claims via `getClaims()`.
 *
 * `getClaims()` (not a raw client-side JWT decode, and not `session.user`)
 * is what makes this a *verified* role read rather than a trusted-blind
 * one: for this project's local/HS256 setup it falls back to an
 * `auth.getUser()` round-trip against the Auth server before trusting the
 * decoded payload (confirmed by reading `@supabase/auth-js`'s own
 * `getClaims` implementation — HS256 tokens have no local-verification
 * path since there's no public key to check the signature against
 * client-side); for a project using asymmetric signing keys in
 * production it verifies the signature locally instead. Either way, the
 * `role` this function returns has been through real verification, not a
 * client-trusted decode — Phase 3 §8.
 */
async function fetchVerifiedRole(): Promise<{ role: Role | null; storeId: string | null }> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return { role: null, storeId: null };

  const claims = data.claims as { role?: string; store_id?: string };
  const role = claims.role;
  if (role === "customer" || role === "packer" || role === "runner" || role === "admin") {
    return { role, storeId: claims.store_id ?? null };
  }
  // No `staff_roles` row and no hook run yet (shouldn't happen once the
  // hook is registered, per config.toml — but a missing/malformed claim
  // is treated as "no role," never guessed at) — the resulting `null`
  // routes through resolveRouteAccess's unsupported-role branch, not
  // silently treated as "customer."
  return { role: null, storeId: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialSession() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      if (data.session) {
        const claims = await fetchVerifiedRole();
        if (cancelled) return;
        setRole(claims.role);
        setStoreId(claims.storeId);
      }
      setIsLoading(false);
    }
    loadInitialSession();

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
      if (newSession) {
        const claims = await fetchVerifiedRole();
        if (cancelled) return;
        setRole(claims.role);
        setStoreId(claims.storeId);
      } else {
        setRole(null);
        setStoreId(null);
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      role,
      storeId,
      isLoading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, role, storeId, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
