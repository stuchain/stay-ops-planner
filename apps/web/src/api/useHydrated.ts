import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * False while React hydrates the server HTML, true after. Data restored from the offline copy can be
 * in the cache before hydration ends; showing it only once this is true keeps the first client
 * render equal to the server's (no hydration mismatch).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
