"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createTRPCClient, httpBatchLink, splitLink, type TRPCLink } from "@trpc/client";
import { observable, type Unsubscribable } from "@trpc/server/observable";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useEffect, useState, type ReactNode } from "react";
import type { AppRouter } from "@/server/api/root";
import { isSessionExpired } from "./errors";
import {
  createOfflinePersister,
  dropOtherUsersCache,
  OFFLINE_BUSTER,
  OFFLINE_MAX_AGE_MS,
  refreshRestored,
  shouldPersistQuery,
} from "./offlineCache";
import { makeQueryClient } from "./queryClient";
import { waitForSignIn } from "./sessionGate";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

/** A request refused because the session ran out waits for the person to sign in again, then runs once more (E2-1). */
export const sessionLink: TRPCLink<AppRouter> =
  () =>
  ({ next, op }) =>
    observable((observer) => {
      let subscription: Unsubscribable | undefined;
      let stopped = false;
      const attempt = (retried: boolean) => {
        subscription = next(op).subscribe({
          next: (value) => observer.next(value),
          error: (error) => {
            if (retried || !isSessionExpired(error)) {
              observer.error(error);
              return;
            }
            waitForSignIn(error).then(
              () => {
                if (!stopped) attempt(true);
              },
              () => observer.error(error),
            );
          },
          complete: () => observer.complete(),
        });
      };
      attempt(false);
      return () => {
        stopped = true;
        subscription?.unsubscribe();
      };
    });

/**
 * With a `userId` the answers behind Today and Calendar are also kept in this browser for offline reading (P4-8),
 * under a key of that user, and are dropped when the release changes.
 */
export function ApiProvider({ children, userId }: { children: ReactNode; userId?: string }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        sessionLink,
        // The guest search carries what was typed (names, phones): sent as POST so it never sits in a URL.
        splitLink({
          condition: (op) => op.path === "booking.search",
          true: httpBatchLink({ url: "/api/trpc", methodOverride: "POST" }),
          false: httpBatchLink({ url: "/api/trpc" }),
        }),
      ],
    }),
  );
  const [persister] = useState(() => (userId ? createOfflinePersister(userId) : null));
  useEffect(() => {
    if (userId) dropOtherUsersCache(userId);
  }, [userId]);
  const inner = (
    <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
      {children}
    </TRPCProvider>
  );
  if (!persister) return <QueryClientProvider client={queryClient}>{inner}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: OFFLINE_MAX_AGE_MS,
        buster: OFFLINE_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
      onSuccess={() => refreshRestored(queryClient)}
    >
      {inner}
    </PersistQueryClientProvider>
  );
}
