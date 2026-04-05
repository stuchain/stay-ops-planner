import type { Prisma } from "@stay-ops/db";
import { BookingStatus } from "@stay-ops/db";

function stayMatchesBooking(
  startDate: Date,
  endDate: Date,
  checkinDate: Date,
  checkoutDate: Date,
): boolean {
  return (
    startDate.getTime() === checkinDate.getTime() && endDate.getTime() === checkoutDate.getTime()
  );
}

/**
 * After a booking upsert from sync, drop invalid assignments and flag the booking.
 * Idempotent when repeated with the same canonical dates.
 */
export async function revalidateAssignmentIfNeeded(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: { assignment: true },
  });

  if (!booking) return;
  if (booking.status === BookingStatus.cancelled) return;

  const assignment = booking.assignment;
  if (!assignment) return;

  if (
    stayMatchesBooking(
      assignment.startDate,
      assignment.endDate,
      booking.checkinDate,
      booking.checkoutDate,
    )
  ) {
    return;
  }

  const assignmentId = assignment.id;
  const payload: Prisma.InputJsonValue = {
    bookingId,
    assignmentId,
    assignmentStart: assignment.startDate.toISOString().slice(0, 10),
    assignmentEnd: assignment.endDate.toISOString().slice(0, 10),
    bookingCheckin: booking.checkinDate.toISOString().slice(0, 10),
    bookingCheckout: booking.checkoutDate.toISOString().slice(0, 10),
  };

  await tx.assignment.deleteMany({ where: { bookingId } });
  await tx.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.needs_reassignment },
  });

  await tx.auditEvent.create({
    data: {
      userId: null,
      action: "assignment.cleared_on_sync_revalidation",
      entityType: "assignment",
      entityId: assignmentId,
      payload,
    },
  });
}
