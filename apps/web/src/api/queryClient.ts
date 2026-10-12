import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { readClientError } from "./errors";
import { reportNetworkFailure, reportNetworkWorks } from "./online";

function noteFailure(error: unknown) {
  if (readClientError(error).code === "NETWORK") reportNetworkFailure();
}

/**
 * Shared defaults: reads stay fresh for 30 s and retry twice; writes never retry on their own and never wait in a
 * queue for the connection (`networkMode: "always"` makes a write without internet fail at once, instead of
 * silently happening later). Requests that fail for lack of network, or get through again, update `useOnline()`.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: noteFailure, onSuccess: reportNetworkWorks }),
    mutationCache: new MutationCache({ onError: noteFailure, onSuccess: reportNetworkWorks }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: true },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}

declare module "@tanstack/react-query" {
  interface Register {
    /** `handlesErrors: true` marks a save that shows its own error, so the shell's MutationErrorFallback stays quiet. */
    mutationMeta: { handlesErrors?: boolean };
  }
}
