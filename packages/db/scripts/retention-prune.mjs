#!/usr/bin/env node
/**
 * Deletes audit_events and sync_runs older than RETENTION_MONTHS (default 12).
 */
import { PrismaClient } from "@prisma/client";

const months = Number(process.env.RETENTION_MONTHS ?? 12);
const prisma = new PrismaClient();

const cutoff = new Date();
cutoff.setMonth(cutoff.getMonth() - months);

async function main() {
  const [a, s] = await prisma.$transaction([
    prisma.auditEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.syncRun.deleteMany({ where: { startedAt: { lt: cutoff } } }),
  ]);
  console.log(
    `Retention prune: deleted audit_events=${a.count} sync_runs=${s.count} (older than ${cutoff.toISOString()}, ${months} months)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
