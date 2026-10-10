import { prisma } from "@/lib/prisma";

export type SyncStatus = {
  /** When Hosthub data last arrived in full, or null if never. */
  lastSuccessAt: string | null;
  /** True while a sync is running. */
  running: boolean;
};

/** The Hosthub "last updated" line in the new shell. */
export async function getSyncStatus(): Promise<SyncStatus> {
  const [lastOk, running] = await Promise.all([
    prisma.syncRun.findFirst({
      where: { status: "completed", completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    prisma.syncRun.count({ where: { status: "running", startedAt: { gt: new Date(Date.now() - 10 * 60_000) } } }),
  ]);
  return { lastSuccessAt: lastOk?.completedAt?.toISOString() ?? null, running: running > 0 };
}
