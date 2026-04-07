import { BookingStatus, PrismaClient } from "@stay-ops/db";

const prisma = new PrismaClient();

function isoHoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function ageBucket(updatedAt: Date): "lt_24h" | "h24_to_72" | "gt_72h" {
  const ageMs = Date.now() - updatedAt.getTime();
  if (ageMs < 24 * 60 * 60 * 1000) return "lt_24h";
  if (ageMs < 72 * 60 * 60 * 1000) return "h24_to_72";
  return "gt_72h";
}

export async function getOperationalDashboardSummary() {
  const startedAt = Date.now();
  const since = isoHoursAgo(24);

  const [recentSyncRuns, unresolvedImportErrors, conflictBacklog, cleaningBacklog, oldestUnresolvedImportError] =
    await Promise.all([
    prisma.syncRun.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, startedAt: true, completedAt: true },
    }),
    prisma.importError.groupBy({
      by: ["code"],
      where: { resolved: false },
      _count: { _all: true },
    }),
    prisma.booking.findMany({
      where: { status: BookingStatus.needs_reassignment },
      select: { id: true, updatedAt: true },
    }),
    prisma.cleaningTask.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.importError.findFirst({
      where: { resolved: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, code: true },
    }),
  ]);

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 500) {
    console.warn(`[dashboard] getOperationalDashboardSummary slow: ${elapsedMs}ms`);
  }

  const totalSync = recentSyncRuns.length;
  const successfulSync = recentSyncRuns.filter((r) => {
    const s = (r.status ?? "").toLowerCase();
    return s === "completed" || s === "done";
  }).length;
  const syncSuccessRatio24h = totalSync === 0 ? 0 : Number(((successfulSync / totalSync) * 100).toFixed(2));

  const unresolvedByAge = { lt_24h: 0, h24_to_72: 0, gt_72h: 0 };
  for (const b of conflictBacklog) {
    unresolvedByAge[ageBucket(b.updatedAt)] += 1;
  }

  return {
    sync: {
      totalRuns24h: totalSync,
      successfulRuns24h: successfulSync,
      successRatio24h: syncSuccessRatio24h,
      latestRuns: recentSyncRuns.slice(0, 10).map((r) => ({
        id: r.id,
        status: r.status ?? "unknown",
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
    },
    importErrors: {
      unresolvedTotal: unresolvedImportErrors.reduce((acc, row) => acc + row._count._all, 0),
      byCode: unresolvedImportErrors.map((row) => ({
        code: row.code ?? "UNKNOWN",
        count: row._count._all,
      })),
      oldestUnresolved: oldestUnresolvedImportError
        ? {
            id: oldestUnresolvedImportError.id,
            code: oldestUnresolvedImportError.code ?? "UNKNOWN",
            createdAt: oldestUnresolvedImportError.createdAt.toISOString(),
            ageMs: Date.now() - oldestUnresolvedImportError.createdAt.getTime(),
          }
        : null,
    },
    conflicts: {
      unresolvedTotal: conflictBacklog.length,
      byAgeBucket: unresolvedByAge,
    },
    cleaning: {
      backlogByStatus: cleaningBacklog.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
    },
  };
}
