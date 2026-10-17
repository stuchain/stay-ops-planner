import { Prisma } from "@stay-ops/db";
import { log } from "@stay-ops/shared";
import { prisma } from "@/lib/prisma";

/**
 * Guests' contact and identity details are kept for 24 months after checkout, then blanked: phone, e-mail,
 * Hosthub's notes, and every phone, e-mail, passport/ID, address or birth date inside the stored Hosthub
 * data. The name, dates, party size, amounts and the team's own guest note stay, for the accounts and for
 * returning guests. The change history and sync log of the same age are deleted (they copy the same fields).
 * Run once a day from the morning cron; a booking Hosthub sends again is blanked again the next morning.
 */
export const GUEST_DATA_RETENTION_MONTHS = 24;
/** Bookings handled per run, so one call stays short on Neon's free compute; the rest follow the next day. */
const BATCH = 300;

/** Object keys holding contact or identity details, at any depth of Hosthub's JSON. */
const PERSONAL_KEY_RE = /(e?mail|phone|mobile|passport|identification|document_number|address|birth)/i;
/** The same keys as they appear in Postgres' text form of the JSON, to find rows still holding one. */
const PERSONAL_KEY_SQL =
  '"[A-Za-z_]*(e?mail|phone|mobile|passport|identification|document_number|address|birth)[A-Za-z_]*":';

export function stripPersonalKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPersonalKeys);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!PERSONAL_KEY_RE.test(k)) out[k] = stripPersonalKeys(v);
  }
  return out;
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (stripPersonalKeys(value) as Prisma.InputJsonValue);
}

export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cutoff.setUTCMonth(cutoff.getUTCMonth() - GUEST_DATA_RETENTION_MONTHS);
  return cutoff;
}

export type GuestDataRetentionResult = { bookings: number; auditEvents: number; syncRuns: number };

/** Never throws: the morning reminder must still go out if this fails. */
export async function runGuestDataRetention(
  now: Date = new Date(),
): Promise<GuestDataRetentionResult | { error: string }> {
  try {
    const cutoff = retentionCutoff(now);
    const due = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM bookings
      WHERE checkout_date < ${cutoff}
        AND (
          guest_phone IS NOT NULL OR guest_email IS NOT NULL OR notes IS NOT NULL OR hosthub_notes_raw IS NOT NULL
          OR raw_payload::text ~* ${PERSONAL_KEY_SQL}
          OR hosthub_calendar_event_raw::text ~* ${PERSONAL_KEY_SQL}
          OR hosthub_gr_taxes_raw::text ~* ${PERSONAL_KEY_SQL}
          OR hosthub_values::text ~* ${PERSONAL_KEY_SQL}
        )
      ORDER BY checkout_date
      LIMIT ${BATCH}
    `;
    for (const { id } of due) {
      const b = await prisma.booking.findUniqueOrThrow({
        where: { id },
        select: { rawPayload: true, hosthubCalendarEventRaw: true, hosthubGrTaxesRaw: true, hosthubValues: true },
      });
      await prisma.booking.update({
        where: { id },
        data: {
          guestPhone: null,
          guestEmail: null,
          notes: null,
          hosthubNotesRaw: Prisma.DbNull,
          rawPayload: jsonOrNull(b.rawPayload),
          hosthubCalendarEventRaw: jsonOrNull(b.hosthubCalendarEventRaw),
          hosthubGrTaxesRaw: jsonOrNull(b.hosthubGrTaxesRaw),
          hosthubValues: jsonOrNull(b.hosthubValues),
        },
      });
    }
    const [auditEvents, syncRuns] = await prisma.$transaction([
      prisma.auditEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      prisma.syncRun.deleteMany({ where: { startedAt: { lt: cutoff } } }),
    ]);
    const result = { bookings: due.length, auditEvents: auditEvents.count, syncRuns: syncRuns.count };
    if (result.bookings || result.auditEvents || result.syncRuns) log("info", "guest_data_retention", result);
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log("warn", "guest_data_retention_failed", { error });
    return { error };
  }
}
