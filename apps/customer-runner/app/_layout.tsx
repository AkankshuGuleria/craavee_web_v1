import "../global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";

import { AuthBoundary } from "../components/AuthBoundary";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AuthProvider } from "../lib/auth/AuthProvider";

/**
 * Root layout for the customer-runner app.
 *
 * Phase 3: `AuthBoundary` now does real route protection, driven by
 * `AuthProvider`'s verified session/role state (see both files' own
 * comments). `AuthProvider` must sit above `AuthBoundary` in the tree —
 * the boundary reads it via `useAuth()`.
 */
export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Phase 3 §14/§23: the catalog is a high-read, low-write-
            // frequency path — a short stale window avoids a refetch on
            // every screen focus while still catching a same-session
            // price/availability change within a minute. Individual
            // queries (e.g. useCatalog) may override this where a
            // different cadence makes sense.
            staleTime: 60_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthBoundary>
            <Stack screenOptions={{ headerShown: false }} />
          </AuthBoundary>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
