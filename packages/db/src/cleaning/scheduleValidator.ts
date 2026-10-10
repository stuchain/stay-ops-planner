import { Prisma } from "@prisma/client";
import { dateOnlyToDay, DEFAULT_CHECKIN_TIME, zonedTimeToUtc } from "./settings.js";

/** User-facing copy aligned with Phase 5 API appendix (`CLEANING_WINDOW_INVALID`). */
export const CLEANING_WINDOW_INVALID_MESSAGE = "Cleaning does not fit available room window";

export class CleaningWindowInvalidError extends Error {
  readonly code = "CLEANING_WINDOW_INVALID" as const;
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "CleaningWindowInvalidError";
  }
}

/**
 * Validates a proposed cleaning window against checkout, next room occupancy, and maintenance blocks.
 *
 * All day boundaries are read in the business time zone (Athens), not UTC.
 * - **After checkout:** `plannedStart` must be at or after the start of the booking's checkout day.
 * - **Before next check-in:** `plannedEnd` must not extend past the next guest's check-in *time* (15:00) on the next
 *   assignment's start day, so a same-day turnover fits (E4-1).
 * - **Blocks:** `[plannedStart, plannedEnd)` must not intersect a manual block on the room; a block starts at the
 *   check-in time of its first day, like a stay, and ends at the start of its end day.
 * - **Room active:** room must exist and `Room.isActive`.
 */
export async function validateCleaningSchedule(
  tx: Prisma.TransactionClient,
  params: {
    roomId: string;
    bookingId: string;
    plannedStart: Date;
    plannedEnd: Date;
  },
): Promise<void> {
  if (params.plannedEnd.getTime() <= params.plannedStart.getTime()) {
    throw new CleaningWindowInvalidError(CLEANING_WINDOW_INVALID_MESSAGE);
  }

  const room = await tx.room.findUnique({
    where: { id: params.roomId },
    select: { isActive: true },
  });
  if (!room || !room.isActive) {
    throw new CleaningWindowInvalidError(CLEANING_WINDOW_INVALID_MESSAGE);
  }

  const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
  if (!booking) {
    throw new CleaningWindowInvalidError(CLEANING_WINDOW_INVALID_MESSAGE);
  }

  const checkoutStart = zonedTimeToUtc(dateOnlyToDay(booking.checkoutDate), "00:00").getTime();
  if (params.plannedStart.getTime() < checkoutStart) {
    throw new CleaningWindowInvalidError(CLEANING_WINDOW_INVALID_MESSAGE);
  }

  const nextStay = await tx.assignment.findFirst({
    where: {
      roomId: params.roomId,
      bookingId: { not: params.bookingId },
      startDate: { gte: booking.checkoutDate },
    },
    orderBy: { startDate: "asc" },
  });

  if (nextStay) {
    const nextCheckin = zonedTimeToUtc(dateOnlyToDay(nextStay.startDate), DEFAULT_CHECKIN_TIME).getTime();
    if (params.plannedEnd.getTime() > nextCheckin) {
      throw new CleaningWindowInvalidError(CLEANING_WINDOW_INVALID_MESSAGE);
    }
  }

  const blocks = await tx.manualBlock.findMany({
    where: { roomId: params.roomId },
  });

  const p0 = params.plannedStart.getTime();
  const p1 = params.plannedEnd.getTime();

  for (const b of blocks) {
    const b0 = zonedTimeToUtc(dateOnlyToDay(b.startDate), DEFAULT_CHECKIN_TIME).getTime();
    const b1 = zonedTimeToUtc(dateOnlyToDay(b.endDate), "00:00").getTime();
    if (p0 < b1 && p1 > b0) {
      throw new CleaningWindowInvalidError(CLEANING_WINDOW_INVALID_MESSAGE);
    }
  }
}
