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

  await tx.assignment.deleteMany({ where: { bookingId } });
  await tx.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.needs_reassignment },
  });
}
