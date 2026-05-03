import { writeAuditSnapshot } from "@stay-ops/audit";
import type { Prisma } from "@stay-ops/db";
import { BookingStatus } from "@stay-ops/db";
import type { PlanRecorder } from "@stay-ops/shared";

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
export type RevalidateAssignmentOptions = {
  /** When true, skip audit rows (used with dry-run transaction rollback). */
  skipAudit?: boolean;
  /** When set, append planned side effects for dry-run summaries. */
  recorder?: PlanRecorder;
};

export async function revalidateAssignmentIfNeeded(
  tx: Prisma.TransactionClient,
  bookingId: string,
  opts?: RevalidateAssignmentOptions,
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
  const beforeAssignment = {
    id: assignment.id,
    bookingId: assignment.bookingId,
    roomId: assignment.roomId,
    startDate: assignment.startDate.toISOString().slice(0, 10),
    endDate: assignment.endDate.toISOString().slice(0, 10),
    version: assignment.version,
  };

  await tx.assignment.deleteMany({ where: { bookingId } });
  opts?.recorder?.push({
    entityType: "assignment",
    entityId: assignmentId,
    action: "delete",
    before: beforeAssignment,
    after: null,
  });

  await tx.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.needs_reassignment },
  });

  opts?.recorder?.push({
    entityType: "booking",
    entityId: bookingId,
    action: "update",
    before: { status: booking.status },
    after: { status: BookingStatus.needs_reassignment },
  });

  if (!opts?.skipAudit) {
    await writeAuditSnapshot(tx, {
      actorUserId: null,
      action: "assignment.cleared_on_sync_revalidation",
      entityType: "assignment",
      entityId: assignmentId,
      before: beforeAssignment,
      after: null,
      meta: {
        bookingId,
        assignmentStart: assignment.startDate.toISOString().slice(0, 10),
        assignmentEnd: assignment.endDate.toISOString().slice(0, 10),
        bookingCheckin: booking.checkinDate.toISOString().slice(0, 10),
        bookingCheckout: booking.checkoutDate.toISOString().slice(0, 10),
      },
    });
  }
}
