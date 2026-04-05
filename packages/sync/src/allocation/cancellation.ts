import type { Prisma } from "@stay-ops/db";
import { BookingStatus } from "@stay-ops/db";

/** v1 pending cleaning statuses cancelled when the booking is cancelled. */
export const CLEANING_PENDING_STATUSES = ["todo", "in_progress"] as const;

/**
 * When a booking is cancelled, release its assignment and cancel open cleaning work.
 * Safe to call repeatedly (idempotent side effects).
 */
export async function applyCancellationSideEffects(
  tx: Prisma.TransactionClient,
  bookingId: string,
  actorUserId?: string | null,
): Promise<void> {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.status !== BookingStatus.cancelled) {
    return;
  }

  const assignment = await tx.assignment.findUnique({
    where: { bookingId },
  });

  if (assignment) {
    await tx.assignment.delete({ where: { id: assignment.id } });
    await tx.auditEvent.create({
      data: {
        userId: actorUserId ?? null,
        action: "assignment.released_on_cancel",
        entityType: "assignment",
        entityId: assignment.id,
        payload: { bookingId } as Prisma.InputJsonValue,
      },
    });
  }

  const pendingTasks = await tx.cleaningTask.findMany({
    where: {
      bookingId,
      status: { in: [...CLEANING_PENDING_STATUSES] },
    },
    select: { id: true },
  });

  if (pendingTasks.length === 0) {
    return;
  }

  await tx.cleaningTask.updateMany({
    where: {
      id: { in: pendingTasks.map((t) => t.id) },
    },
    data: { status: "cancelled" },
  });

  for (const t of pendingTasks) {
    await tx.auditEvent.create({
      data: {
        userId: actorUserId ?? null,
        action: "cleaning_task.cancelled_on_booking_cancel",
        entityType: "cleaning_task",
        entityId: t.id,
        payload: { bookingId } as Prisma.InputJsonValue,
      },
    });
  }
}
