import type { Prisma } from "@stay-ops/db";
import { PrismaClient } from "@stay-ops/db";
import { normalizeHosthubReservationRecord } from "../hosthub/normalize.js";

type Dict = Record<string, unknown>;

function asObject(value: unknown): Dict | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Dict;
  return null;
}

function toJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function pickCalendarEventRaw(booking: {
  hosthubCalendarEventRaw: Prisma.JsonValue | null;
  rawPayload: Prisma.JsonValue | null;
}): unknown {
  if (booking.hosthubCalendarEventRaw) return booking.hosthubCalendarEventRaw;
  const root = asObject(booking.rawPayload);
  if (!root) return booking.rawPayload;
  for (const key of ["calendar_event", "calendarEvent", "reservation", "data", "payload", "body"] as const) {
    const nested = asObject(root[key]);
    if (nested) return nested;
  }
  return booking.rawPayload;
}

function extractLatestNoteText(raw: Prisma.JsonValue | null): string | null {
  const root = asObject(raw);
  const arr = Array.isArray(root?.data) ? root.data : [];
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const item = asObject(arr[i]);
    const status = typeof item?.status === "string" ? item.status.toLowerCase() : "";
    if (status === "deleted") continue;
    const content = typeof item?.content === "string" ? item.content.trim() : "";
    if (content.length > 0) return content;
  }
  return null;
}

/**
 * Backfills enrichment columns using already persisted raw blobs.
 * This intentionally updates only enrichment fields (never identity/date fields).
 */
export async function runHosthubEnrichmentBackfill(
  prisma: PrismaClient,
  opts?: { limit?: number },
): Promise<{ scanned: number; updated: number; skipped: number }> {
  type BackfillRow = {
    id: string;
    rawPayload: Prisma.JsonValue | null;
    hosthubCalendarEventRaw: Prisma.JsonValue | null;
    hosthubNotesRaw: Prisma.JsonValue | null;
    guestName: string | null;
    guestEmail: string | null;
    guestPhone: string | null;
    guestAdults: number | null;
    guestChildren: number | null;
    guestInfants: number | null;
    guestTotal: number | null;
    totalAmountCents: number | null;
    currency: string | null;
    cleaningFeeCents: number | null;
    taxCents: number | null;
    payoutAmountCents: number | null;
    guestPaidCents: number | null;
    action: string | null;
    notes: string | null;
  };

  const pageSize = 200;
  const maxRows = Math.max(1, opts?.limit ?? 5000);
  let cursorId: string | null = null;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  while (scanned < maxRows) {
    const rows: BackfillRow[] = await prisma.booking.findMany({
      take: Math.min(pageSize, maxRows - scanned),
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        rawPayload: true,
        hosthubCalendarEventRaw: true,
        hosthubNotesRaw: true,
        guestName: true,
        guestEmail: true,
        guestPhone: true,
        guestAdults: true,
        guestChildren: true,
        guestInfants: true,
        guestTotal: true,
        totalAmountCents: true,
        currency: true,
        cleaningFeeCents: true,
        taxCents: true,
        payoutAmountCents: true,
        guestPaidCents: true,
        action: true,
        notes: true,
      },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      cursorId = row.id;
      const normalized = normalizeHosthubReservationRecord(pickCalendarEventRaw(row));
      const latestNote = extractLatestNoteText(row.hosthubNotesRaw);
      if (!normalized) {
        skipped += 1;
        continue;
      }

      const updateData: Prisma.BookingUpdateInput = {};
      const setIfPresent = <K extends keyof Prisma.BookingUpdateInput>(
        key: K,
        value: Prisma.BookingUpdateInput[K] | undefined,
      ) => {
        if (value !== undefined && value !== null) {
          updateData[key] = value;
        }
      };

      setIfPresent("guestName", normalized.guestName);
      setIfPresent("guestEmail", normalized.guestEmail);
      setIfPresent("guestPhone", normalized.guestPhone);
      setIfPresent("guestAdults", normalized.guestAdults);
      setIfPresent("guestChildren", normalized.guestChildren);
      setIfPresent("guestInfants", normalized.guestInfants);
      setIfPresent("guestTotal", normalized.guestTotal);
      setIfPresent("totalAmountCents", normalized.totalAmountCents);
      setIfPresent("currency", normalized.currency);
      setIfPresent("cleaningFeeCents", normalized.cleaningFeeCents);
      setIfPresent("taxCents", normalized.taxCents);
      setIfPresent("payoutAmountCents", normalized.payoutAmountCents);
      setIfPresent("guestPaidCents", normalized.guestPaidCents);
      setIfPresent("action", normalized.action);
      setIfPresent("notes", normalized.notes ?? latestNote ?? undefined);
      if (row.hosthubCalendarEventRaw === null) {
        const inferredRaw = toJson(pickCalendarEventRaw(row));
        if (inferredRaw !== null) {
          updateData.hosthubCalendarEventRaw = inferredRaw;
        }
      }

      if (Object.keys(updateData).length === 0) {
        skipped += 1;
        continue;
      }
      await prisma.booking.update({
        where: { id: row.id },
        data: updateData,
      });
      updated += 1;
    }
  }

  return { scanned, updated, skipped };
}
