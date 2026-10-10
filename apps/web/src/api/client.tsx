"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, type TRPCLink } from "@trpc/client";
import { observable, type Unsubscribable } from "@trpc/server/observable";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState, type ReactNode } from "react";
import type { AppRouter } from "@/server/api/root";
import { isSessionExpired } from "./errors";
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

export function ApiProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({ links: [sessionLink, httpBatchLink({ url: "/api/trpc" })] }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
