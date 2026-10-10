import type { Prisma } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { describeAuditEvent, type HistoryEvent } from "./bookingHistory";
import { appTimeZone } from "@/server/time";

/** Filters of the Dev mode History screen. Every field is optional; empty means "any". */
export type AuditFilters = {
  /** First day, as YYYY-MM-DD in Athens time. */
  from?: string | undefined;
  /** Last day, inclusive, as YYYY-MM-DD in Athens time. */
  to?: string | undefined;
  entityType?: string | undefined;
  action?: string | undefined;
  userId?: string | undefined;
  /** Shows what happened to one booking, including moves between apartments. */
  bookingId?: string | undefined;
};

export const AUDIT_PAGE_SIZE = 50;
/** One export holds at most this many rows (newest first); `truncated` says when more matched. */
export const AUDIT_EXPORT_LIMIT = 20_000;

/** Start of a calendar day in the business time zone, as an instant. */
export function dayStart(iso: string, timeZone: string = appTimeZone()): Date {
  const guess = Date.parse(`${iso}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return new Date(guess - (local - guess));
}

function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function auditWhere(f: AuditFilters): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [];
  if (f.from) and.push({ createdAt: { gte: dayStart(f.from) } });
  if (f.to) and.push({ createdAt: { lt: dayStart(nextDay(f.to)) } });
  if (f.entityType) and.push({ entityType: f.entityType });
  if (f.action) and.push({ action: f.action });
  if (f.userId) and.push({ userId: f.userId });
  if (f.bookingId) {
    and.push({
      OR: [
        { entityType: "booking", entityId: f.bookingId },
        { entityType: "assignment", metaJson: { path: ["bookingId"], equals: f.bookingId } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export type AuditRow = {
  id: string;
  /** ISO time. */
  at: string;
  /** Who did it; null for the system (a sync, a failed sign-in). */
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** The same description the booking panel uses; `other` when there is no specific one. */
  event: HistoryEvent;
  before: unknown;
  after: unknown;
  meta: unknown;
};

const ORDER = [{ createdAt: "desc" as const }, { id: "desc" as const }];

async function roomNames(rows: Array<{ action: string; beforeJson: unknown; afterJson: unknown }>) {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.action !== "booking.move") continue;
    for (const side of [r.beforeJson, r.afterJson]) {
      const roomId = (side as { roomId?: unknown } | null)?.roomId;
      if (typeof roomId === "string") ids.add(roomId);
    }
  }
  if (ids.size === 0) return new Map<string, string>();
  const rooms = await prisma.room.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, displayName: true, code: true },
  });
  return new Map(rooms.map((r) => [r.id, r.displayName ?? r.code]));
}

/** One page of the audit log, newest first, with how many rows match in all. */
export async function listAuditEvents(filters: AuditFilters, page: number) {
  const where = auditWhere(filters);
  const [total, rows] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: ORDER,
      skip: Math.max(0, page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      include: { user: { select: { email: true } } },
    }),
  ]);
  const names = await roomNames(rows);
  const items: AuditRow[] = rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    userEmail: r.user?.email ?? null,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    event: describeAuditEvent(r, (id) => (typeof id === "string" ? (names.get(id) ?? null) : null)),
    before: r.beforeJson,
    after: r.afterJson,
    meta: r.metaJson,
  }));
  return { items, total, page, pageSize: AUDIT_PAGE_SIZE, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}

/** What the filter pickers offer: the kinds that exist in the log, and the people. */
export async function auditFilterOptions() {
  const [entityTypes, actions, users] = await Promise.all([
    prisma.auditEvent.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
    prisma.auditEvent.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    prisma.user.findMany({ select: { id: true, email: true }, orderBy: { email: "asc" } }),
  ]);
  return {
    entityTypes: entityTypes.map((r) => r.entityType),
    actions: actions.map((r) => r.action),
    users,
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : JSON.stringify(value);
  // A spreadsheet runs a cell that starts with these as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const AUDIT_CSV_HEADER = [
  "time",
  "user",
  "action",
  "entity_type",
  "entity_id",
  "before",
  "after",
  "meta",
] as const;

/** The filtered rows as CSV with a UTF-8 byte order mark, so Excel reads Greek text correctly. */
export async function auditCsv(filters: AuditFilters): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const where = auditWhere(filters);
  const found = await prisma.auditEvent.findMany({
    where,
    orderBy: ORDER,
    take: AUDIT_EXPORT_LIMIT + 1,
    include: { user: { select: { email: true } } },
  });
  const truncated = found.length > AUDIT_EXPORT_LIMIT;
  const rows = truncated ? found.slice(0, AUDIT_EXPORT_LIMIT) : found;
  const lines = [AUDIT_CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.user?.email ?? "",
        r.action,
        r.entityType,
        r.entityId,
        r.beforeJson,
        r.afterJson,
        r.metaJson,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return { csv: `﻿${lines.join("\r\n")}\r\n`, rows: rows.length, truncated };
}
