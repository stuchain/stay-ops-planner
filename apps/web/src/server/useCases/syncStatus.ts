import { prisma } from "@/lib/prisma";

/** What went wrong with the last sync, in the few kinds a person is told about. */
export type SyncProblem = "none" | "auth" | "other";

export type SyncStatus = {
  /** When Hosthub data last arrived in full, or null if never. */
  lastSuccessAt: string | null;
  /** True while a sync is running. */
  running: boolean;
  /** "auth" when Hosthub refused our key on the last run (the key must be renewed), "other" for any other failure. */
  problem: SyncProblem;
};

/**
 * `sync_state.last_error` is "<code>: <message>" from the failed run and is cleared by the next good one.
 * Hosthub refusing the key shows as HOSTHUB_AUTH_FAILED (401) or a 403 client error.
 */
export function classifySyncError(lastError: string | null | undefined): SyncProblem {
  if (!lastError) return "none";
  if (lastError.startsWith("HOSTHUB_AUTH_FAILED") || /client error: 403\b/.test(lastError)) return "auth";
  return "other";
}

/** The Hosthub "last updated" line in the new shell, and the banner when the connection stopped. */
export async function getSyncStatus(): Promise<SyncStatus> {
  const [state, lock] = await Promise.all([
    prisma.syncState.findUnique({ where: { id: 1 }, select: { lastSuccessAt: true, lastError: true } }),
    prisma.syncLock.findUnique({ where: { name: "hosthub_reconcile" }, select: { lockedUntil: true } }),
  ]);
  return {
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    running: lock !== null && lock.lockedUntil.getTime() > Date.now(),
    problem: classifySyncError(state?.lastError),
  };
}
