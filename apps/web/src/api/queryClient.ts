import { QueryClient } from "@tanstack/react-query";

/** Shared defaults: reads stay fresh for 30 s and retry twice; writes never retry on their own. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}
