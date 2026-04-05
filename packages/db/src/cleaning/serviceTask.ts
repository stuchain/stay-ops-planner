import { BookingStatus, Prisma } from "@prisma/client";
import { computeTurnoverPlannedWindowUTC } from "./turnover.js";

export const SERVICE_TASK_TYPE = "service";
export const SERVICE_MINUTES = 60;

/**
 * Default planned start for a service clean when the client omits `plannedStart`:
 * same UTC anchor as turnover (checkout calendar day + default hour), 60-minute window.
 *
 * Explicit triggers: `POST /api/cleaning/tasks` (Phase 5.5), Phase 6 operator UI.
 */
function defaultServicePlannedWindow(checkoutDate: Date): { plannedStart: Date; plannedEnd: Date } {
  return computeTurnoverPlannedWindowUTC(checkoutDate, SERVICE_MINUTES);
}

/**
 * Creates a service cleaning task. Idempotent on `sourceEventId` (unique): returns existing row.
 */
export async function createServiceCleaningTask(
  tx: Prisma.TransactionClient,
  params: {
    bookingId: string;
    roomId: string;
    sourceEventId: string;
    plannedStart?: Date;
  },
): Promise<{ id: string; created: boolean }> {
  const dup = await tx.cleaningTask.findUnique({
    where: { sourceEventId: params.sourceEventId },
  });
  if (dup) {
    return { id: dup.id, created: false };
  }

  const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
  if (!booking || booking.status === BookingStatus.cancelled) {
    throw new Error("Invalid booking for service cleaning task");
  }

  const { plannedStart, plannedEnd } = params.plannedStart
    ? {
        plannedStart: params.plannedStart,
        plannedEnd: new Date(params.plannedStart.getTime() + SERVICE_MINUTES * 60_000),
      }
    : defaultServicePlannedWindow(booking.checkoutDate);

  try {
    const row = await tx.cleaningTask.create({
      data: {
        bookingId: params.bookingId,
        roomId: params.roomId,
        status: "todo",
        taskType: SERVICE_TASK_TYPE,
        sourceEventId: params.sourceEventId,
        plannedStart,
        plannedEnd,
        durationMinutes: SERVICE_MINUTES,
      },
    });
    return { id: row.id, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await tx.cleaningTask.findUnique({
        where: { sourceEventId: params.sourceEventId },
      });
      if (row) return { id: row.id, created: false };
    }
    throw e;
  }
}
