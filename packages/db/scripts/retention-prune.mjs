#!/usr/bin/env node
/**
 * Deletes audit_events and sync_runs older than RETENTION_MONTHS (default 12).
 *
 * The audit trail is the only record of who changed a booking, so retention below
 * MIN_RETENTION_MONTHS (12) is refused before the database is even opened.
 */
import { fileURLToPath } from "node:url";

export const MIN_RETENTION_MONTHS = 12;

/** Parses RETENTION_MONTHS. Throws when it is not a whole number of at least MIN_RETENTION_MONTHS. */
export function resolveRetentionMonths(raw) {
  const value = raw === undefined || raw === "" ? MIN_RETENTION_MONTHS : Number(raw);
  if (!Number.isInteger(value) || value < MIN_RETENTION_MONTHS) {
    throw new Error(
      `Refusing to prune: RETENTION_MONTHS=${raw} is below the minimum of ${MIN_RETENTION_MONTHS} months of audit history.`,
    );
  }
  return value;
}

async function main() {
  const months = resolveRetentionMonths(process.env.RETENTION_MONTHS);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  try {
    const [a, s] = await prisma.$transaction([
      prisma.auditEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      prisma.syncRun.deleteMany({ where: { startedAt: { lt: cutoff } } }),
    ]);
    console.log(
      `Retention prune: deleted audit_events=${a.count} sync_runs=${s.count} (older than ${cutoff.toISOString()}, ${months} months)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
