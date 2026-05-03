import type { Prisma } from "@stay-ops/db";
import { PrismaClient } from "@stay-ops/db";
import { HosthubClient } from "../hosthub/client.js";
import { applyHosthubReservation } from "./applyHosthubReservation.js";
import { backfillSourceListingsFromHosthubRentals } from "./backfillSourceListingsFromRentals.js";
import {
  emptySyncRunStats,
  finalizeSyncRun,
  recordImportError,
  startSyncRun,
} from "./syncRunService.js";
import { isDryRunRollback, mergeDryRunResults, type DryRunResult, type DryRunWarning } from "@stay-ops/shared";

function rowAsJson(row: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
}

export type RunHosthubReconcileOptions = {
  apiToken?: string | null;
  /** When true, no sync_run / import_error rows are written; returns aggregated {@link DryRunResult}. */
  dryRun?: boolean;
  /** When true, omit `updated_gte` so Hosthub returns full visible history from the first page (slower). */
  fullSync?: boolean;
  /** First `GET /calendar-events` page only: Hosthub `is_visible` (`all` | `true` | `false`). */
  calendarEventsIsVisible?: string | null;
  /** When false, skip per-event notes + GR-tax API calls (faster; less enrichment). Default: env or true. */
  fetchEventEnrichment?: boolean;
  /**
   * When true (or env `HOSTHUB_RECONCILE_PER_RENTAL_CALENDAR`), after the global calendar list also
   * walks `GET /rentals/{id}/calendar-events` per rental from backfill (extra API load; catches provider gaps).
   */
  perRentalCalendar?: boolean;
};

function resolveCalendarListOptions(opts?: RunHosthubReconcileOptions): {
  fullSync: boolean;
  isVisible: string | undefined;
  fetchEnrichment: boolean;
} {
  const envFull =
    process.env.HOSTHUB_RECONCILE_FULL_SYNC === "1" || process.env.HOSTHUB_RECONCILE_FULL_SYNC === "true";
  const envVis = process.env.HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE?.trim();
  const envEnrichOff =
    process.env.HOSTHUB_SYNC_FETCH_EVENT_ENRICHMENT === "0" ||
    process.env.HOSTHUB_SYNC_FETCH_EVENT_ENRICHMENT === "false";

  const fullSync = opts?.fullSync === true || (opts?.fullSync === undefined && envFull);

  const vis =
    opts?.calendarEventsIsVisible !== undefined
      ? (opts.calendarEventsIsVisible ?? "").trim()
      : envVis;
  const isVisible = vis && vis.length > 0 ? vis : undefined;

  const fetchEnrichment =
    opts?.fetchEventEnrichment !== undefined ? opts.fetchEventEnrichment : !envEnrichOff;

  return { fullSync, isVisible, fetchEnrichment };
}

function resolvePerRentalCalendar(opts?: RunHosthubReconcileOptions): boolean {
  const env =
    process.env.HOSTHUB_RECONCILE_PER_RENTAL_CALENDAR === "1" ||
    process.env.HOSTHUB_RECONCILE_PER_RENTAL_CALENDAR === "true";
  return opts?.perRentalCalendar === true || (opts?.perRentalCalendar === undefined && env);
}

/**
 * Pulls calendar event pages from Hosthub and applies the same upsert path as webhooks.
 * Records `sync_runs` + `import_errors` for observability (unless `dryRun`).
 * Persists `cursor` as Unix `updated_gte` watermark from max `updated` on fetched rows.
 */
export async function runHosthubReconcile(
  prisma: PrismaClient,
  opts?: RunHosthubReconcileOptions,
): Promise<void | DryRunResult> {
  if (opts?.dryRun) {
    return runHosthubReconcileDryRun(prisma, opts);
  }

  const run = await startSyncRun(prisma, "hosthub_poll");
  const stats = emptySyncRunStats();

  try {
    const token = opts?.apiToken?.trim() || process.env.HOSTHUB_API_TOKEN?.trim();
    if (!token) {
      console.warn("HOSTHUB_API_TOKEN not set; skipping Hosthub reconcile fetch");
      await finalizeSyncRun(prisma, run.id, "completed", stats, null);
      return;
    }

    const syncOpts = resolveCalendarListOptions(opts);
    const prev = await prisma.syncRun.findFirst({
      where: { source: "hosthub_poll", status: "completed", cursor: { not: null } },
      orderBy: { completedAt: "desc" },
    });
    let updatedGte: number | undefined;
    if (!syncOpts.fullSync && prev?.cursor) {
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

    let rentalIdsFromBackfill: string[] = [];
    try {
      const bf = await backfillSourceListingsFromHosthubRentals(prisma, client);
      rentalIdsFromBackfill = bf.rentalIds;
      if (bf.upsertsTouched > 0) {
        stats.listingBackfillUpserted = bf.upsertsTouched;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordImportError(prisma, run.id, "LISTING_BACKFILL_ERROR", msg, rowAsJson({ phase: "rentals_channels" }));
    }

    let nextPageUrl: string | null = null;
    let runMaxUpdated: number | undefined;
    const seenPageUrls = new Set<string>();
    let pagesRead = 0;

    for (;;) {
      if (nextPageUrl) {
        if (seenPageUrls.has(nextPageUrl)) {
          break;
        }
        seenPageUrls.add(nextPageUrl);
      }
      pagesRead += 1;
      if (pagesRead > 500) {
        break;
      }
      const page = await client.listCalendarEventsPage({
        nextPageUrl,
        updatedGte: nextPageUrl ? undefined : updatedGte,
        isVisible: nextPageUrl ? undefined : syncOpts.isVisible,
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

      for (let idx = 0; idx < page.value.data.length; idx += 1) {
        const row = page.value.data[idx];
        if (!row) {
          continue;
        }
        const rawEvent = page.value.rawData?.[idx] ?? row;
        try {
          let hosthubNotesRaw: Prisma.InputJsonValue | null = null;
          let hosthubGrTaxesRaw: Prisma.InputJsonValue | null = null;
          if (syncOpts.fetchEnrichment) {
            const notesRes = await client.getCalendarEventNotes(row.reservationId);
            const grTaxesRes = await client.getCalendarEventGrTaxes(row.reservationId);
            hosthubNotesRaw = notesRes.ok ? rowAsJson(notesRes.value) : null;
            hosthubGrTaxesRaw = grTaxesRes.ok ? rowAsJson(grTaxesRes.value) : null;
          }

          await applyHosthubReservation(prisma, row, rowAsJson(rawEvent), {
            hosthubNotesRaw,
            hosthubGrTaxesRaw,
          });
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

    if (resolvePerRentalCalendar(opts)) {
      for (const rentalId of rentalIdsFromBackfill) {
        let rentalNextUrl: string | null = null;
        const seenRentalPageUrls = new Set<string>();
        let pagesReadPerRental = 0;
        for (;;) {
          if (rentalNextUrl) {
            if (seenRentalPageUrls.has(rentalNextUrl)) {
              break;
            }
            seenRentalPageUrls.add(rentalNextUrl);
          }
          pagesReadPerRental += 1;
          if (pagesReadPerRental > 500) {
            break;
          }
          const rentalPage = await client.listRentalCalendarEventsPage({
            rentalId,
            nextPageUrl: rentalNextUrl,
            updatedGte: rentalNextUrl ? undefined : updatedGte,
            isVisible: rentalNextUrl ? undefined : syncOpts.isVisible,
          });
          if (!rentalPage.ok) {
            await recordImportError(prisma, run.id, "SOURCE_CONFLICT", rentalPage.error.message, {
              code: rentalPage.error.code,
              statusCode: rentalPage.error.statusCode,
              phase: "per_rental_calendar",
              rentalId,
            });
            await finalizeSyncRun(prisma, run.id, "failed", stats, prev?.cursor ?? null);
            throw new Error(`${rentalPage.error.code}: ${rentalPage.error.message}`);
          }

          stats.fetched += rentalPage.value.data.length + rentalPage.value.skipped;
          stats.skipped += rentalPage.value.skipped;

          if (rentalPage.value.maxUpdated !== undefined) {
            runMaxUpdated =
              runMaxUpdated === undefined
                ? rentalPage.value.maxUpdated
                : Math.max(runMaxUpdated, rentalPage.value.maxUpdated);
          }

          for (let idx = 0; idx < rentalPage.value.data.length; idx += 1) {
            const row = rentalPage.value.data[idx];
            if (!row) {
              continue;
            }
            const rawEvent = rentalPage.value.rawData?.[idx] ?? row;
            try {
              let hosthubNotesRaw: Prisma.InputJsonValue | null = null;
              let hosthubGrTaxesRaw: Prisma.InputJsonValue | null = null;
              if (syncOpts.fetchEnrichment) {
                const notesRes = await client.getCalendarEventNotes(row.reservationId);
                const grTaxesRes = await client.getCalendarEventGrTaxes(row.reservationId);
                hosthubNotesRaw = notesRes.ok ? rowAsJson(notesRes.value) : null;
                hosthubGrTaxesRaw = grTaxesRes.ok ? rowAsJson(grTaxesRes.value) : null;
              }

              await applyHosthubReservation(prisma, row, rowAsJson(rawEvent), {
                hosthubNotesRaw,
                hosthubGrTaxesRaw,
              });
              stats.upserted += 1;
            } catch (e) {
              stats.errors += 1;
              const msg = e instanceof Error ? e.message : String(e);
              await recordImportError(prisma, run.id, "PARSE_ERROR", msg, rowAsJson(row));
            }
          }

          const rentalNext = rentalPage.value.nextPageUrl;
          if (!rentalNext) {
            break;
          }
          rentalNextUrl = rentalNext;
        }
      }
    }

    const cursorOut =
      runMaxUpdated !== undefined ? String(runMaxUpdated) : (prev?.cursor ?? null);
    await finalizeSyncRun(prisma, run.id, "completed", stats, cursorOut);
  } catch (e) {
    const current = await prisma.syncRun.findUnique({ where: { id: run.id } });
    if (current && !current.completedAt) {
      await finalizeSyncRun(prisma, run.id, "failed", stats, null);
    }
    throw e;
  }
}

async function runHosthubReconcileDryRun(
  prisma: PrismaClient,
  opts: RunHosthubReconcileOptions,
): Promise<DryRunResult> {
  const rowPlans: DryRunResult[] = [];
  const extraWarnings: DryRunWarning[] = [];

  const token = opts?.apiToken?.trim() || process.env.HOSTHUB_API_TOKEN?.trim();
  if (!token) {
    console.warn("HOSTHUB_API_TOKEN not set; dry-run reconcile skipped");
    return {
      dryRun: true,
      totals: { processed: 0, byAction: {}, byEntity: {} },
      warnings: [{ code: "NO_TOKEN", message: "Hosthub API token is not configured" }],
      entries: [],
      truncated: false,
    };
  }

  const syncOpts = resolveCalendarListOptions(opts);

  const prev = await prisma.syncRun.findFirst({
    where: { source: "hosthub_poll", status: "completed", cursor: { not: null } },
    orderBy: { completedAt: "desc" },
  });
  let updatedGte: number | undefined;
  if (!syncOpts.fullSync && prev?.cursor) {
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
  const seenPageUrls = new Set<string>();
  let pagesRead = 0;

  for (;;) {
    if (nextPageUrl) {
      if (seenPageUrls.has(nextPageUrl)) {
        break;
      }
      seenPageUrls.add(nextPageUrl);
    }
    pagesRead += 1;
    if (pagesRead > 500) {
      break;
    }
    const page = await client.listCalendarEventsPage({
      nextPageUrl,
      updatedGte: nextPageUrl ? undefined : updatedGte,
      isVisible: nextPageUrl ? undefined : syncOpts.isVisible,
    });
    if (!page.ok) {
      extraWarnings.push({
        code: page.error.code,
        message: page.error.message,
        details: { statusCode: page.error.statusCode },
      });
      break;
    }

    for (let idx = 0; idx < page.value.data.length; idx += 1) {
      const row = page.value.data[idx];
      if (!row) {
        continue;
      }
      const rawEvent = page.value.rawData?.[idx] ?? row;
      try {
        let hosthubNotesRaw: Prisma.InputJsonValue | null = null;
        let hosthubGrTaxesRaw: Prisma.InputJsonValue | null = null;
        if (syncOpts.fetchEnrichment) {
          const notesRes = await client.getCalendarEventNotes(row.reservationId);
          const grTaxesRes = await client.getCalendarEventGrTaxes(row.reservationId);
          hosthubNotesRaw = notesRes.ok ? rowAsJson(notesRes.value) : null;
          hosthubGrTaxesRaw = grTaxesRes.ok ? rowAsJson(grTaxesRes.value) : null;

          if (!notesRes.ok) {
            extraWarnings.push({
              code: String(notesRes.error.code),
              message: notesRes.error.message,
              details: { reservationId: row.reservationId, scope: "calendar_event_notes" },
            });
          }
          if (!grTaxesRes.ok) {
            extraWarnings.push({
              code: String(grTaxesRes.error.code),
              message: grTaxesRes.error.message,
              details: { reservationId: row.reservationId, scope: "calendar_event_gr_taxes" },
            });
          }
        }

        await applyHosthubReservation(
          prisma,
          row,
          rowAsJson(rawEvent),
          {
            hosthubNotesRaw,
            hosthubGrTaxesRaw,
          },
          { dryRun: true },
        );
      } catch (e) {
        if (isDryRunRollback(e)) {
          rowPlans.push(e.plan);
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          extraWarnings.push({
            code: "ROW_APPLY_ERROR",
            message: msg,
            details: { reservationId: row.reservationId, row: rowAsJson(row) },
          });
        }
      }
    }

    const next = page.value.nextPageUrl;
    if (!next) {
      break;
    }
    nextPageUrl = next;
  }

  const merged = mergeDryRunResults(rowPlans);
  return {
    ...merged,
    warnings: [...merged.warnings, ...extraWarnings],
  };
}
