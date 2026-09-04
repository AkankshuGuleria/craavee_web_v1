import "../global.css";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { useState } from "react";

import { PERSIST_BUSTER, PERSIST_MAX_AGE, shouldPersistQuery } from "../lib/query/persist";

import { AuthBoundary } from "../components/AuthBoundary";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AuthProvider } from "../lib/auth/AuthProvider";
import { usePushNotifications } from "../lib/notifications/usePushNotifications";

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
            // gcTime must be >= the persister's maxAge, or the cache is
            // garbage-collected before the restored entry can be used and
            // persistence silently does nothing (TanStack persistence docs).
            gcTime: PERSIST_MAX_AGE,
          },
        },
      })
  );

  const [persister] = useState(() =>
    createAsyncStoragePersister({
      storage: AsyncStorage,
      // AsyncStorage on a busy list can be written to constantly; throttling
      // keeps the disk write off the interaction path.
      throttleTime: 2_000,
    }),
  );

  return (
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE,
          buster: PERSIST_BUSTER,
          // The allowlist. See lib/query/persist.ts — orders, payments,
          // profile and addresses are deliberately excluded.
          dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
        }}
      >
        <AuthProvider>
          <AuthBoundary>
            {/* Inside QueryClientProvider because a notification tap
                invalidates the order query before navigating, and inside
                AuthProvider because registration is a no-op until there
                is a signed-in profile to attach the token to. */}
            <PushNotifications />
            <Stack screenOptions={{ headerShown: false }} />
          </AuthBoundary>
        </AuthProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}

/** Renders nothing. Exists so the push hook lives under the providers it
 *  needs without turning RootLayout into a client of them. */
function PushNotifications() {
  usePushNotifications();
  return null;
}
