import { prisma } from "@/lib/prisma";

export type SyncStatus = {
  /** When Hosthub data last arrived in full, or null if never. */
  lastSuccessAt: string | null;
  /** True while a sync is running. */
  running: boolean;
};

/** The Hosthub "last updated" line in the new shell. */
export async function getSyncStatus(): Promise<SyncStatus> {
  const [state, lock] = await Promise.all([
    prisma.syncState.findUnique({ where: { id: 1 }, select: { lastSuccessAt: true } }),
    prisma.syncLock.findUnique({ where: { name: "hosthub_reconcile" }, select: { lockedUntil: true } }),
  ]);
  return {
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    running: lock !== null && lock.lockedUntil.getTime() > Date.now(),
  };
}
