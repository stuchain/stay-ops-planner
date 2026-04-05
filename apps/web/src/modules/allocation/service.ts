import { BookingStatus, findStayConflict, Prisma, PrismaClient } from "@stay-ops/db";
import { AllocationError } from "./errors";
import { throwIfStayConflict } from "./stayConflict";

const prisma = new PrismaClient();

const ASSIGNABLE: BookingStatus[] = [BookingStatus.confirmed, BookingStatus.needs_reassignment];

function assertAssignable(status: BookingStatus): void {
  if (!ASSIGNABLE.includes(status)) {
    throw new AllocationError({
      code: "BOOKING_NOT_ASSIGNABLE",
      status: 422,
      message: "Booking cannot be assigned in its current status",
      details: { status },
    });
  }
}

export type AssignInput = {
  bookingId: string;
  roomId: string;
  actorUserId: string;
};

export type ReassignInput = {
  assignmentId: string;
  roomId: string;
  expectedVersion: number;
  actorUserId: string;
};

export type UnassignInput = {
  assignmentId: string;
  expectedVersion: number;
  actorUserId: string;
};

export type AssignmentCommandResult = {
  assignment: {
    id: string;
    bookingId: string;
    roomId: string;
    startDate: Date;
    endDate: Date;
    version: number;
  };
  auditRef: string;
};

async function appendAudit(
  tx: Prisma.TransactionClient,
  args: { userId: string; action: string; entityType: string; entityId: string; payload?: Prisma.InputJsonValue },
): Promise<string> {
  const row = await tx.auditEvent.create({
    data: {
      userId: args.userId,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      payload: args.payload ?? Prisma.JsonNull,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Serializable isolation + row locks on booking prevent lost updates on assignment.version
 * while overlapping stays are blocked by assertNoOverlap and DB exclusion.
 */
export async function assignBookingToRoom(input: AssignInput): Promise<AssignmentCommandResult> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${input.bookingId} FOR UPDATE`;

      const booking = await tx.booking.findUnique({
        where: { id: input.bookingId },
        include: { assignment: true },
      });

      if (!booking) {
        throw new AllocationError({
          code: "BOOKING_NOT_ASSIGNABLE",
          status: 422,
          message: "Booking not found",
          details: { bookingId: input.bookingId },
        });
      }

      assertAssignable(booking.status);

      if (booking.assignment) {
        throw new AllocationError({
          code: "BOOKING_ALREADY_ASSIGNED",
          status: 409,
          message: "Booking already has an assignment; use reassign",
          details: { assignmentId: booking.assignment.id },
        });
      }

      throwIfStayConflict(
        await findStayConflict(tx, {
          roomId: input.roomId,
          start: booking.checkinDate,
          end: booking.checkoutDate,
        }),
      );

      const created = await tx.assignment.create({
        data: {
          bookingId: input.bookingId,
          roomId: input.roomId,
          startDate: booking.checkinDate,
          endDate: booking.checkoutDate,
          version: 0,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
      });

      const auditRef = await appendAudit(tx, {
        userId: input.actorUserId,
        action: "assignment.assign",
        entityType: "assignment",
        entityId: created.id,
        payload: { bookingId: input.bookingId, roomId: input.roomId },
      });

      return {
        assignment: {
          id: created.id,
          bookingId: created.bookingId,
          roomId: created.roomId,
          startDate: created.startDate,
          endDate: created.endDate,
          version: created.version,
        },
        auditRef,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function reassignRoom(input: ReassignInput): Promise<AssignmentCommandResult> {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.assignment.findUnique({
        where: { id: input.assignmentId },
        include: { booking: true },
      });

      if (!existing) {
        throw new AllocationError({
          code: "ASSIGNMENT_NOT_FOUND",
          status: 404,
          message: "Assignment not found",
          details: { assignmentId: input.assignmentId },
        });
      }

      await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${existing.bookingId} FOR UPDATE`;

      if (existing.version !== input.expectedVersion) {
        throw new AllocationError({
          code: "STALE_VERSION",
          status: 409,
          message: "Assignment was modified by another operation",
          details: { currentVersion: existing.version, expectedVersion: input.expectedVersion },
        });
      }

      assertAssignable(existing.booking.status);

      throwIfStayConflict(
        await findStayConflict(tx, {
          roomId: input.roomId,
          start: existing.startDate,
          end: existing.endDate,
          excludeAssignmentId: existing.id,
        }),
      );

      const updated = await tx.assignment.update({
        where: { id: input.assignmentId },
        data: {
          roomId: input.roomId,
          version: { increment: 1 },
          updatedById: input.actorUserId,
        },
      });

      const auditRef = await appendAudit(tx, {
        userId: input.actorUserId,
        action: "assignment.reassign",
        entityType: "assignment",
        entityId: updated.id,
        payload: { roomId: input.roomId, version: updated.version },
      });

      return {
        assignment: {
          id: updated.id,
          bookingId: updated.bookingId,
          roomId: updated.roomId,
          startDate: updated.startDate,
          endDate: updated.endDate,
          version: updated.version,
        },
        auditRef,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function unassignBooking(input: UnassignInput): Promise<{ auditRef: string }> {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.assignment.findUnique({
        where: { id: input.assignmentId },
        include: { booking: true },
      });

      if (!existing) {
        throw new AllocationError({
          code: "ASSIGNMENT_NOT_FOUND",
          status: 404,
          message: "Assignment not found",
          details: { assignmentId: input.assignmentId },
        });
      }

      await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${existing.bookingId} FOR UPDATE`;

      if (existing.version !== input.expectedVersion) {
        throw new AllocationError({
          code: "STALE_VERSION",
          status: 409,
          message: "Assignment was modified by another operation",
          details: { currentVersion: existing.version, expectedVersion: input.expectedVersion },
        });
      }

      await tx.assignment.delete({ where: { id: input.assignmentId } });

      const auditRef = await appendAudit(tx, {
        userId: input.actorUserId,
        action: "assignment.unassign",
        entityType: "assignment",
        entityId: input.assignmentId,
        payload: { bookingId: existing.bookingId },
      });

      return { auditRef };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

