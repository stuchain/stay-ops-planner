import { createHash } from "node:crypto";
import { BookingStatus, Prisma } from "@prisma/client";

export const TURNOVER_TASK_TYPE = "turnover";
export const TURNOVER_MINUTES = 120;

/**
 * Default local clock hour (UTC placeholder until property timezone settings).
 * Override with `CLEANING_DEFAULT_START_HOUR` (0–23).
 */
function defaultStartHourUtc(): number {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const env = proc?.env;
  const raw = env?.CLEANING_DEFAULT_START_HOUR;
  if (raw === undefined || raw === "") return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 10;
}

/**
 * Half-open stay ends at the start of `checkoutDate` (DATE at UTC midnight).
 * Default turnover starts that same calendar day at `defaultStartHourUtc` (UTC).
 */
export function computeTurnoverPlannedWindowUTC(
  checkoutDate: Date,
  durationMinutes: number = TURNOVER_MINUTES,
): { plannedStart: Date; plannedEnd: Date } {
  const y = checkoutDate.getUTCFullYear();
  const m = checkoutDate.getUTCMonth();
  const d = checkoutDate.getUTCDate();
  const hour = defaultStartHourUtc();
  const plannedStart = new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
  const plannedEnd = new Date(plannedStart.getTime() + durationMinutes * 60_000);
  return { plannedStart, plannedEnd };
}

/**
 * Stable SHA-256 idempotency key for turnover rows (Phase 5: hash of booking + checkout day + room + turnover).
 */
export function turnoverSourceEventId(bookingId: string, checkoutDate: Date, roomId: string): string {
  const day = checkoutDate.toISOString().slice(0, 10);
  const payload = `${bookingId}|${day}|${roomId}|turnover`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Ensures exactly one turnover cleaning task per assigned booking (DB partial unique on booking_id where turnover).
 * Skips cancelled bookings, missing assignment, or terminal task statuses (done / cancelled).
 */
export async function ensureTurnoverCleaningTask(
  tx: Prisma.TransactionClient,
  params: { bookingId: string; roomId: string; checkoutDate: Date },
): Promise<void> {
  const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
  if (!booking || booking.status === BookingStatus.cancelled) {
    return;
  }

  const assignment = await tx.assignment.findUnique({ where: { bookingId: params.bookingId } });
  if (!assignment || assignment.roomId !== params.roomId) {
    return;
  }

  const room = await tx.room.findUnique({
    where: { id: params.roomId },
    select: { isActive: true },
  });
  if (!room?.isActive) {
    return;
  }

  const { plannedStart, plannedEnd } = computeTurnoverPlannedWindowUTC(params.checkoutDate);
  const sourceEventId = turnoverSourceEventId(params.bookingId, params.checkoutDate, params.roomId);

  const existing = await tx.cleaningTask.findFirst({
    where: { bookingId: params.bookingId, taskType: TURNOVER_TASK_TYPE },
  });

  if (existing) {
    if (existing.status === "done" || existing.status === "cancelled") {
      return;
    }
    await tx.cleaningTask.update({
      where: { id: existing.id },
      data: {
        roomId: params.roomId,
        plannedStart,
        plannedEnd,
        durationMinutes: TURNOVER_MINUTES,
        sourceEventId,
      },
    });
    return;
  }

  await tx.cleaningTask.create({
    data: {
      bookingId: params.bookingId,
      roomId: params.roomId,
      status: "todo",
      taskType: TURNOVER_TASK_TYPE,
      sourceEventId,
      plannedStart,
      plannedEnd,
      durationMinutes: TURNOVER_MINUTES,
    },
  });
}
