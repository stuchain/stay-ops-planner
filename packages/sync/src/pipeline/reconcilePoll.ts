import type { Prisma } from "@stay-ops/db";
import { PrismaClient } from "@stay-ops/db";
import { HosthubClient } from "../hosthub/client.js";
import { applyHosthubReservation } from "./applyHosthubReservation.js";
import {
  emptySyncRunStats,
  finalizeSyncRun,
  recordImportError,
  startSyncRun,
} from "./syncRunService.js";

function rowAsJson(row: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
}

/**
 * Pulls calendar event pages from Hosthub and applies the same upsert path as webhooks.
 * Records `sync_runs` + `import_errors` for observability.
 * Persists `cursor` as Unix `updated_gte` watermark from max `updated` on fetched rows.
 */
export async function runHosthubReconcile(prisma: PrismaClient): Promise<void> {
  const run = await startSyncRun(prisma, "hosthub_poll");
  const stats = emptySyncRunStats();

  try {
    const token = process.env.HOSTHUB_API_TOKEN?.trim();
    if (!token) {
      console.warn("HOSTHUB_API_TOKEN not set; skipping Hosthub reconcile fetch");
      await finalizeSyncRun(prisma, run.id, "completed", stats, null);
      return;
    }

    const prev = await prisma.syncRun.findFirst({
      where: { source: "hosthub_poll", status: "completed", cursor: { not: null } },
      orderBy: { completedAt: "desc" },
    });
    let updatedGte: number | undefined;
    if (prev?.cursor) {
      const n = Number.parseInt(prev.cursor, 10);
      if (Number.isFinite(n)) {
        updatedGte = n;
      }
    }

    const baseUrl = process.env.HOSTHUB_API_BASE?.trim() ?? "https://app.hosthub.com/api/2019-03-01";
    const listPath = process.env.HOSTHUB_API_RESERVATIONS_PATH?.trim();
    const client = new HosthubClient({
      baseUrl,
      apiToken: token,
      ...(listPath ? { listReservationsPath: listPath } : {}),
    });

    let nextPageUrl: string | null = null;
    let runMaxUpdated: number | undefined;

    for (;;) {
      const page = await client.listCalendarEventsPage({
        nextPageUrl,
        updatedGte: nextPageUrl ? undefined : updatedGte,
      });
      if (!page.ok) {
        await recordImportError(prisma, run.id, "SOURCE_CONFLICT", page.error.message, {
          code: page.error.code,
          statusCode: page.error.statusCode,
        });
        await finalizeSyncRun(prisma, run.id, "failed", stats, prev?.cursor ?? null);
        throw new Error(`${page.error.code}: ${page.error.message}`);
      }

      stats.fetched += page.value.data.length + page.value.skipped;
      stats.skipped += page.value.skipped;

      if (page.value.maxUpdated !== undefined) {
        runMaxUpdated =
          runMaxUpdated === undefined ? page.value.maxUpdated : Math.max(runMaxUpdated, page.value.maxUpdated);
      }

      for (const row of page.value.data) {
        try {
          await applyHosthubReservation(prisma, row, rowAsJson(row));
          stats.upserted += 1;
        } catch (e) {
          stats.errors += 1;
          const msg = e instanceof Error ? e.message : String(e);
          await recordImportError(prisma, run.id, "PARSE_ERROR", msg, rowAsJson(row));
        }
      }

      const next = page.value.nextPageUrl;
      if (!next) {
        break;
      }
      nextPageUrl = next;
    }

    const cursorOut =
      runMaxUpdated !== undefined
        ? String(runMaxUpdated)
        : (prev?.cursor ?? null);
    await finalizeSyncRun(prisma, run.id, "completed", stats, cursorOut);
  } catch (e) {
    const current = await prisma.syncRun.findUnique({ where: { id: run.id } });
    if (current && !current.completedAt) {
      await finalizeSyncRun(prisma, run.id, "failed", stats, null);
    }
    throw e;
  }
}
