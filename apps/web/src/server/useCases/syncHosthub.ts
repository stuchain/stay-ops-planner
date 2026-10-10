import { mapHosthubListingChannel, finalizeSyncRun, recordImportError, startSyncRun } from "@stay-ops/sync";
import type { HosthubReservationPage } from "@stay-ops/sync";
import type { Prisma, PrismaClient } from "@stay-ops/db";
import { log, withRetry } from "@stay-ops/shared";
import { isTransientPrismaError } from "@stay-ops/sync";
import { prisma } from "@/lib/prisma";
import {
  applyHosthubBooking,
  hosthubUpdatedAt,
  type ApplyOutcome,
  type IncomingBooking,
} from "@/server/sync/applyBooking";
import type { HosthubSource } from "@/server/sync/hosthubSource";
import { releaseHosthubReconcileLock, tryAcquireHosthubReconcileLock } from "@/server/sync/lock";

/**
 * Why a sync runs. "open" is the app opening (and every 15 minutes while open): quick, no notes or
 * GR taxes. "manual" is the button, "scheduled" the cron route; both fetch notes and GR taxes for
 * new and changed bookings.
 */
export type SyncTrigger = "open" | "manual" | "scheduled";

export type SyncStats = {
  fetched: number;
  /** created + updated, kept for the old "last sync" screens. */
  upserted: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Older than what is stored (a late delivery). */
  stale: number;
  skipped: number;
  enriched: number;
  errors: number;
  listingBackfillUpserted?: number;
};

export type SyncResult =
  { status: "completed"; runId: string; stats: SyncStats } | { status: "skipped"; reason: "locked" | "recent" };

export type SyncHosthubOptions = {
  source: HosthubSource;
  trigger: SyncTrigger;
  /** Fetch every event, not only those changed since the last run. */
  full?: boolean | undefined;
  db?: PrismaClient | undefined;
};

/** Events applied per transaction. */
export const SYNC_BATCH_SIZE = 50;
/** An "open" sync is skipped when the last good one is newer than this (several people, several tabs). */
const OPEN_DEBOUNCE_MS = 5 * 60_000;
const MAX_PAGES = 500;

function emptyStats(): SyncStats {
  return {
    fetched: 0,
    upserted: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    stale: 0,
    skipped: 0,
    enriched: 0,
    errors: 0,
  };
}

function count(stats: SyncStats, outcome: ApplyOutcome): void {
  stats[outcome] += 1;
  if (outcome === "created" || outcome === "updated") stats.upserted += 1;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The cursor for the next run: the newest `updated` seen, but never past a row that failed, so
 * that row is fetched again (`updated_gte` is inclusive). A failed row without `updated` keeps
 * the old cursor.
 */
export function nextCursor(args: {
  previous: string | null;
  maxUpdated: number | undefined;
  failedMinUpdated: number | undefined;
  failedWithoutUpdated: boolean;
}): string | null {
  if (args.failedWithoutUpdated) return args.previous;
  const candidates = [args.maxUpdated, args.failedMinUpdated].filter((n): n is number => n !== undefined);
  if (candidates.length === 0) return args.previous;
  return String(args.failedMinUpdated !== undefined ? Math.min(...candidates) : args.maxUpdated);
}

type PageFetch = (nextPageUrl: string | null) => ReturnType<HosthubSource["listCalendarEventsPage"]>;

/** Every page of one Hosthub list, following `navigation.next` until it ends or repeats. */
async function* pages(fetchPage: PageFetch): AsyncGenerator<HosthubReservationPage> {
  let next: string | null = null;
  const seen = new Set<string>();
  for (let n = 0; n < MAX_PAGES; n++) {
    const page = await fetchPage(next);
    if (!page.ok) throw new HosthubFetchError(page.error.code, page.error.message, page.error.statusCode);
    yield page.value;
    next = page.value.nextPageUrl;
    if (!next || seen.has(next)) return;
    seen.add(next);
  }
}

export class HosthubFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number | undefined,
  ) {
    super(`${code}: ${message}`);
    this.name = "HosthubFetchError";
  }
}

class Run {
  readonly stats = emptyStats();
  maxUpdated: number | undefined;
  failedMinUpdated: number | undefined;
  failedWithoutUpdated = false;

  constructor(
    readonly db: PrismaClient,
    readonly runId: string,
    readonly source: HosthubSource,
    readonly enrich: boolean,
  ) {}

  noteFailed(raw: unknown): void {
    const updated = hosthubUpdatedAt(raw);
    if (!updated) {
      this.failedWithoutUpdated = true;
      return;
    }
    const unix = Math.floor(updated.getTime() / 1000);
    this.failedMinUpdated = this.failedMinUpdated === undefined ? unix : Math.min(this.failedMinUpdated, unix);
  }

  async page(page: HosthubReservationPage): Promise<void> {
    this.stats.fetched += page.data.length + page.skipped;
    this.stats.skipped += page.skipped;
    if (page.maxUpdated !== undefined) {
      this.maxUpdated = this.maxUpdated === undefined ? page.maxUpdated : Math.max(this.maxUpdated, page.maxUpdated);
    }
    const items: IncomingBooking[] = page.data.map((dto, i) => ({ dto, raw: page.rawData?.[i] ?? dto }));
    for (let i = 0; i < items.length; i += SYNC_BATCH_SIZE) {
      await this.batch(items.slice(i, i + SYNC_BATCH_SIZE));
    }
  }

  /** Notes and GR taxes, only for bookings that are new or changed in Hosthub since last stored. */
  private async enrichBatch(items: IncomingBooking[]): Promise<void> {
    if (!this.enrich) return;
    const existing = await this.db.booking.findMany({
      where: {
        OR: items.map(({ dto }) => ({
          channel: mapHosthubListingChannel(dto.listingChannel),
          externalBookingId: dto.reservationId,
        })),
      },
      select: { channel: true, externalBookingId: true, hosthubUpdatedAt: true },
    });
    const stored = new Map(existing.map((b) => [`${b.channel}|${b.externalBookingId}`, b.hosthubUpdatedAt]));
    for (const item of items) {
      if (item.dto.status === "cancelled") continue;
      const key = `${mapHosthubListingChannel(item.dto.listingChannel)}|${item.dto.reservationId}`;
      const incoming = hosthubUpdatedAt(item.raw);
      const before = stored.get(key);
      const isNewOrChanged = !stored.has(key) || !before || !incoming || incoming.getTime() > before.getTime();
      if (!isNewOrChanged) continue;
      const [notes, taxes] = await Promise.all([
        this.source.getCalendarEventNotes(item.dto.reservationId),
        this.source.getCalendarEventGrTaxes(item.dto.reservationId),
      ]);
      if (notes.ok) item.notesRaw = notes.value;
      if (taxes.ok) item.grTaxesRaw = taxes.value;
      if (notes.ok || taxes.ok) this.stats.enriched += 1;
    }
  }

  /** One transaction per batch; if any event fails, each is retried alone so one bad row costs only itself. */
  private async batch(items: IncomingBooking[]): Promise<void> {
    await this.enrichBatch(items);
    try {
      const outcomes = await this.db.$transaction(
        async (tx) => {
          const out: ApplyOutcome[] = [];
          for (const item of items) out.push(await applyHosthubBooking(tx, item));
          return out;
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
      for (const outcome of outcomes) count(this.stats, outcome);
      return;
    } catch (e) {
      log("warn", "hosthub_sync_batch_failed", { size: items.length, err: errorMessage(e) });
    }
    for (const item of items) {
      try {
        const outcome = await withRetry(() => this.db.$transaction((tx) => applyHosthubBooking(tx, item)), {
          maxAttempts: 3,
          isTransient: isTransientPrismaError,
        });
        count(this.stats, outcome);
      } catch (e) {
        this.stats.errors += 1;
        this.noteFailed(item.raw);
        await recordImportError(this.db, this.runId, "APPLY_ERROR", errorMessage(e), toJson(item.raw));
      }
    }
  }
}

/**
 * Bring bookings in from Hosthub. Holds the sync lock for the whole run, fetches events changed
 * since `sync_state.cursor` (or all of them for a full sync), applies them 50 per transaction and
 * records one `sync_runs` row. Per-event failures go to `import_errors` and do not stop the run.
 */
export async function syncHosthub(options: SyncHosthubOptions): Promise<SyncResult> {
  const db = options.db ?? prisma;
  const full = options.full === true;

  if (options.trigger === "open" && !full) {
    const state = await db.syncState.findUnique({ where: { id: 1 } });
    if (state?.lastSuccessAt && Date.now() - state.lastSuccessAt.getTime() < OPEN_DEBOUNCE_MS) {
      return { status: "skipped", reason: "recent" };
    }
  }

  const holder = await tryAcquireHosthubReconcileLock(db);
  if (!holder) return { status: "skipped", reason: "locked" };

  try {
    const state = await db.syncState.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const runRow = await startSyncRun(db, "hosthub_poll");
    const run = new Run(db, runRow.id, options.source, options.trigger !== "open");
    try {
      let rentalIds: string[] = [];
      if (options.trigger !== "open" && options.source.backfillListings) {
        try {
          const backfill = await options.source.backfillListings(db);
          rentalIds = backfill.rentalIds;
          if (backfill.upserts > 0) run.stats.listingBackfillUpserted = backfill.upserts;
        } catch (e) {
          await recordImportError(db, run.runId, "LISTING_BACKFILL_ERROR", errorMessage(e), {
            phase: "rentals_channels",
          });
        }
      }

      const parsed = state.cursor ? Number.parseInt(state.cursor, 10) : NaN;
      const updatedGte = !full && Number.isFinite(parsed) ? parsed : undefined;
      const isVisible = process.env.HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE?.trim() || "all";
      const first = (next: string | null) =>
        next ? { nextPageUrl: next } : { nextPageUrl: null, updatedGte, isVisible };

      for await (const page of pages((next) => options.source.listCalendarEventsPage(first(next)))) {
        await run.page(page);
      }
      const perRental = ["1", "true"].includes(process.env.HOSTHUB_RECONCILE_PER_RENTAL_CALENDAR ?? "");
      if (perRental) {
        for (const rentalId of rentalIds) {
          const fetchPage: PageFetch = (next) =>
            options.source.listRentalCalendarEventsPage({ rentalId, ...first(next) });
          for await (const page of pages(fetchPage)) await run.page(page);
        }
      }

      const cursor = nextCursor({
        previous: state.cursor,
        maxUpdated: run.maxUpdated,
        failedMinUpdated: run.failedMinUpdated,
        failedWithoutUpdated: run.failedWithoutUpdated,
      });
      await finalizeSyncRun(db, run.runId, "completed", run.stats, cursor);
      await db.syncState.update({ where: { id: 1 }, data: { cursor, lastSuccessAt: new Date(), lastError: null } });
      log("info", "hosthub_sync_completed", { trigger: options.trigger, full, ...run.stats });
      return { status: "completed", runId: run.runId, stats: run.stats };
    } catch (e) {
      if (e instanceof HosthubFetchError) {
        await recordImportError(db, run.runId, "SOURCE_CONFLICT", e.message, {
          code: e.code,
          statusCode: e.statusCode ?? null,
        });
      }
      await finalizeSyncRun(db, run.runId, "failed", run.stats, null);
      await db.syncState.update({ where: { id: 1 }, data: { lastError: errorMessage(e).slice(0, 500) } });
      throw e;
    }
  } finally {
    await releaseHosthubReconcileLock(db, holder);
  }
}
