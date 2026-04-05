import { Prisma } from "@prisma/client";

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
 * - **After checkout:** `plannedStart` must be at or after the booking's `checkoutDate` (UTC midnight DATE = start of checkout calendar day; aligns with half-open stay end).
 * - **Before next check-in:** `plannedEnd` must not extend past the next assignment's `startDate` on the same room (other bookings only).
 * - **Blocks:** `[plannedStart, plannedEnd)` must not intersect a manual block `[startDate, endDate)` on the room (DATE half-open).
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

  const checkoutStart = booking.checkoutDate.getTime();
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
    const nextCheckin = nextStay.startDate.getTime();
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
    const b0 = b.startDate.getTime();
    const b1 = b.endDate.getTime();
    if (p0 < b1 && p1 > b0) {
      throw new CleaningWindowInvalidError(CLEANING_WINDOW_INVALID_MESSAGE);
    }
  }
}
