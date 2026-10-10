import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@stay-ops/db";

const HOSTHUB_SYNC_LOCK_NAME = "hosthub_reconcile";

/**
 * Take the sync lock for 5 minutes. Returns a holder token to pass to the release call, or null
 * when another sync holds it. One statement on a table row, so it works through Neon's pooler,
 * and a holder that was killed mid-sync stops blocking once its time runs out.
 */
export async function tryAcquireHosthubReconcileLock(prisma: PrismaClient): Promise<string | null> {
  const holder = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ holder: string | null }>>`
    INSERT INTO sync_lock (name, locked_until, holder)
    VALUES (${HOSTHUB_SYNC_LOCK_NAME}, now() + interval '5 minutes', ${holder})
    ON CONFLICT (name) DO UPDATE
      SET locked_until = now() + interval '5 minutes', holder = EXCLUDED.holder
      WHERE sync_lock.locked_until < now()
    RETURNING holder
  `;
  return rows[0]?.holder === holder ? holder : null;
}

export async function releaseHosthubReconcileLock(prisma: PrismaClient, holder: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE sync_lock SET locked_until = now()
    WHERE name = ${HOSTHUB_SYNC_LOCK_NAME} AND holder = ${holder}
  `;
}
