import type { PrismaClient } from "@stay-ops/db";

/** Single-flight key shared by reconcile, full-resync, and cron poll (must match all callers). */
export const HOSTHUB_RECONCILE_ADVISORY_LOCK_KEY = BigInt("848424015");

const RUNNING_ROW_GRACE_MS = 2 * 60_000;

export type InFlightHosthubPoll = { id: string; startedAt: Date };

/**
 * Best-effort fast path: a hosthub_poll row still "running" with a recent startedAt
 * usually means reconcile is active (or crashed without completing — same conservative overlap).
 */
export async function findInFlightHosthubPoll(prisma: PrismaClient): Promise<InFlightHosthubPoll | null> {
  const running = await prisma.syncRun.findFirst({
    where: {
      source: "hosthub_poll",
      completedAt: null,
      startedAt: { gte: new Date(Date.now() - RUNNING_ROW_GRACE_MS) },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  return running;
}

export async function tryAcquireHosthubReconcileLock(prisma: PrismaClient): Promise<boolean> {
  const lockRows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${HOSTHUB_RECONCILE_ADVISORY_LOCK_KEY}) AS acquired
  `;
  return Boolean(lockRows[0]?.acquired);
}

export async function releaseHosthubReconcileLock(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT pg_advisory_unlock(${HOSTHUB_RECONCILE_ADVISORY_LOCK_KEY})`;
}
