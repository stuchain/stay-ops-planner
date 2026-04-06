import { PrismaClient } from "@stay-ops/db";

const prisma = new PrismaClient();
const PAGE_SIZE_MAX = 50;

type AuditEventRow = {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  metaJson: unknown;
  createdAt: Date;
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

export async function listAuditEvents(filters: AuditEventFilters) {
  const pageSize = Math.max(1, Math.min(filters.limit ?? 20, PAGE_SIZE_MAX));
  const decodedCursor = fromCursor(filters.cursor);

  const rows = await prisma.auditEvent.findMany({
    where: {
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.actorUserId ? { userId: filters.actorUserId } : {}),
      createdAt: {
        gte: filters.from,
        lte: filters.to,
      },
      ...(decodedCursor
        ? {
            OR: [
              { createdAt: { lt: decodedCursor.createdAt } },
              { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize * 3,
    select: {
      id: true,
      userId: true,
      action: true,
      entityType: true,
      entityId: true,
      beforeJson: true,
      afterJson: true,
      metaJson: true,
      createdAt: true,
    },
  });

  const filtered = rows.filter((row) => {
    if (filters.bookingId) {
      const matchBooking =
        jsonIncludes(row.metaJson, filters.bookingId) ||
        jsonIncludes(row.beforeJson, filters.bookingId) ||
        jsonIncludes(row.afterJson, filters.bookingId);
      if (!matchBooking) return false;
    }
    if (filters.roomId) {
      const matchRoom = jsonIncludes(row.beforeJson, filters.roomId) || jsonIncludes(row.afterJson, filters.roomId);
      if (!matchRoom) return false;
    }
    return true;
  });

  const page = filtered.slice(0, pageSize);
  const next = filtered.length > page.length ? page[page.length - 1] : undefined;

  return {
    data: page.map((row: AuditEventRow) => ({
      id: row.id,
      actorUserId: row.userId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      beforeJson: row.beforeJson,
      afterJson: row.afterJson,
      metaJson: row.metaJson,
      createdAt: row.createdAt.toISOString(),
      redacted: hasRedactions(row.beforeJson) || hasRedactions(row.afterJson) || hasRedactions(row.metaJson),
    })),
    nextCursor: next ? toCursor({ id: next.id, createdAt: next.createdAt }) : null,
  };
}
