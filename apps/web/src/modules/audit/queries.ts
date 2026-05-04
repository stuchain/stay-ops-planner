import { prisma } from "@/lib/prisma";

const PAGE_SIZE_MAX = 50;

/** Maximum events returned by a single export (see docs/AUDIT_EXPORT.md). */
export const AUDIT_EXPORT_MAX_EVENTS = 50_000;

/** Maximum inclusive span between `from` and `to` for export (days). */
export const AUDIT_EXPORT_MAX_SPAN_DAYS = 366;

const SCAN_FETCH_BATCH = 250;

type AuditEventRow = {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  metaJson: unknown;
  payload: unknown;
  createdAt: Date;
};

export type AuditEventListItem = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  metaJson: unknown;
  createdAt: string;
  redacted: boolean;
};

export type AuditEventFilters = {
  entityType?: string;
  bookingId?: string;
  roomId?: string;
  actorUserId?: string;
  from: Date;
  to: Date;
  cursor?: string;
  limit?: number;
  /** Defaults to 50 (UI list). Export uses a higher cap. */
  limitCap?: number;
};

function toCursor(input: { id: string; createdAt: Date }): string {
  return Buffer.from(JSON.stringify({ id: input.id, createdAt: input.createdAt.toISOString() }), "utf8").toString(
    "base64url",
  );
}

function fromCursor(cursor?: string): { id: string; createdAt: Date } | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      id: string;
      createdAt: string;
    };
    if (!decoded.id || !decoded.createdAt) return null;
    return { id: decoded.id, createdAt: new Date(decoded.createdAt) };
  } catch {
    return null;
  }
}

function jsonIncludes(value: unknown, needle: string): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value === needle;
  if (Array.isArray(value)) return value.some((item) => jsonIncludes(item, needle));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some((v) => jsonIncludes(v, needle));
  return false;
}

function hasRedactions(value: unknown): boolean {
  return jsonIncludes(value, "[REDACTED]");
}

function rowMatchesJsonFilters(row: AuditEventRow, filters: Pick<AuditEventFilters, "bookingId" | "roomId">): boolean {
  if (filters.bookingId) {
    const matchBooking =
      jsonIncludes(row.metaJson, filters.bookingId) ||
      jsonIncludes(row.beforeJson, filters.bookingId) ||
      jsonIncludes(row.afterJson, filters.bookingId) ||
      jsonIncludes(row.payload, filters.bookingId);
    if (!matchBooking) return false;
  }
  if (filters.roomId) {
    const matchRoom =
      jsonIncludes(row.beforeJson, filters.roomId) ||
      jsonIncludes(row.afterJson, filters.roomId) ||
      jsonIncludes(row.metaJson, filters.roomId) ||
      jsonIncludes(row.payload, filters.roomId);
    if (!matchRoom) return false;
  }
  return true;
}

function rowToDto(row: AuditEventRow): AuditEventListItem {
  return {
    id: row.id,
    actorUserId: row.userId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    beforeJson: row.beforeJson,
    afterJson: row.afterJson,
    metaJson: row.metaJson,
    createdAt: row.createdAt.toISOString(),
    redacted:
      hasRedactions(row.beforeJson) ||
      hasRedactions(row.afterJson) ||
      hasRedactions(row.metaJson) ||
      hasRedactions(row.payload),
  };
}

function spanDaysInclusive(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

/** Returns an error message if the range is invalid for export, otherwise null. */
export function auditExportRangeError(from: Date, to: Date): string | null {
  if (from > to) return "from must be <= to";
  if (spanDaysInclusive(from, to) > AUDIT_EXPORT_MAX_SPAN_DAYS) {
    return `Date span must be at most ${AUDIT_EXPORT_MAX_SPAN_DAYS} days`;
  }
  return null;
}

/**
 * Keyset pagination over audit_events with correct bookingId/roomId filtering:
 * scans DB in `createdAt`/`id` descending order until the page is full, then optionally
 * one more matching row to set `nextCursor`.
 */
export async function listAuditEvents(filters: AuditEventFilters): Promise<{
  data: AuditEventListItem[];
  nextCursor: string | null;
}> {
  const limitCap = filters.limitCap ?? PAGE_SIZE_MAX;
  const pageSize = Math.max(1, Math.min(filters.limit ?? 20, limitCap));
  const decodedCursor = fromCursor(filters.cursor);

  const baseWhere = {
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.actorUserId ? { userId: filters.actorUserId } : {}),
    createdAt: {
      gte: filters.from,
      lte: filters.to,
    },
  } as const;

  const matches: AuditEventRow[] = [];
  let scanCursor: { id: string; createdAt: Date } | null = decodedCursor;
  let foundNextAfterPage = false;

  for (;;) {
    const rows = await prisma.auditEvent.findMany({
      where: {
        ...baseWhere,
        ...(scanCursor
          ? {
              OR: [
                { createdAt: { lt: scanCursor.createdAt } },
                { createdAt: scanCursor.createdAt, id: { lt: scanCursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SCAN_FETCH_BATCH,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (!rowMatchesJsonFilters(row, filters)) {
        continue;
      }
      if (matches.length < pageSize) {
        matches.push(row);
        continue;
      }
      foundNextAfterPage = true;
      break;
    }

    if (foundNextAfterPage) {
      const lastInBatch = rows[rows.length - 1]!;
      scanCursor = { id: lastInBatch.id, createdAt: lastInBatch.createdAt };
      break;
    }

    const lastInBatch = rows[rows.length - 1]!;
    scanCursor = { id: lastInBatch.id, createdAt: lastInBatch.createdAt };

    if (matches.length >= pageSize) {
      break;
    }
    if (rows.length < SCAN_FETCH_BATCH) {
      break;
    }
  }


  const nextCursor =
    matches.length === pageSize && foundNextAfterPage ? toCursor({ id: matches[pageSize - 1]!.id, createdAt: matches[pageSize - 1]!.createdAt }) : null;

  return {
    data: matches.map(rowToDto),
    nextCursor,
  };
}

/**
 * Iterate audit events for export (same filter semantics as {@link listAuditEvents}).
 * Yields DTO batches of at most `batchSize` until `maxEvents` or end of data.
 */
export async function* iterateAuditEventsForExport(
  filters: Omit<AuditEventFilters, "cursor" | "limit">,
  options: { maxEvents: number; batchSize?: number },
): AsyncGenerator<AuditEventListItem[]> {
  const exportPageCap = 500;
  const batchSize = Math.min(exportPageCap, Math.max(1, options.batchSize ?? 500));
  let cursor: string | undefined;
  let emitted = 0;

  while (emitted < options.maxEvents) {
    const remaining = options.maxEvents - emitted;
    const limit = Math.min(batchSize, remaining);
    const { data, nextCursor } = await listAuditEvents({
      ...filters,
      cursor,
      limit,
      limitCap: exportPageCap,
    });

    if (data.length === 0) {
      break;
    }

    yield data;
    emitted += data.length;

    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }
}
