import type { Prisma } from "@stay-ops/db";
import { PrismaClient } from "@stay-ops/db";
import { invalidateCalendarForImportErrorInstant, resolveAppTimeZone } from "@stay-ops/shared/calendar-month-cache";
import { log } from "@stay-ops/shared";

export type SyncRunStatsJson = {
  fetched: number;
  upserted: number;
  errors: number;
  skipped: number;
  /** Rows touched by `GET /rentals` + channel backfill into `source_listings`. */
  listingBackfillUpserted?: number;
};

export function emptySyncRunStats(): SyncRunStatsJson {
  return { fetched: 0, upserted: 0, errors: 0, skipped: 0 };
}

export async function startSyncRun(prisma: PrismaClient, source: string) {
  const initial = emptySyncRunStats();
  return prisma.syncRun.create({
    data: {
      source,
      status: "running",
      statsJson: initial as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function finalizeSyncRun(
  prisma: PrismaClient,
  runId: string,
  status: "completed" | "failed",
  stats: SyncRunStatsJson,
  cursor: string | null,
) {
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status,
      completedAt: new Date(),
      statsJson: stats as unknown as Prisma.InputJsonValue,
      cursor,
    },
  });
}

export async function recordImportError(
  prisma: PrismaClient,
  syncRunId: string,
  code: string,
  message: string,
  payload?: Prisma.InputJsonValue,
) {
  await prisma.importError.create({
    data: {
      syncRunId,
      code,
      message,
      payload: payload ?? undefined,
    },
  });
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    void invalidateCalendarForImportErrorInstant(redisUrl, resolveAppTimeZone(), new Date()).catch((e) => {
      log("warn", "calendar_month_cache_invalidate_failed", {
        op: "recordImportError",
        err: e instanceof Error ? e.message : String(e),
      });
    });
  }
}
