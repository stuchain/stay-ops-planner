import {
  BookingStatus,
  Channel,
  ensureTurnoverCleaningTask,
  findStayConflict,
  Prisma,
  TURNOVER_TASK_TYPE,
} from "@stay-ops/db";
import { DryRunRollback, isDryRunRollback, PlanRecorder, type DryRunResult } from "@stay-ops/shared";
import { fireInvalidateCalendarForBookingStay } from "@/lib/calendarMonthCacheInvalidate";
import { prisma } from "@/lib/prisma";
import { AllocationError } from "./errors";
import { throwIfStayConflict } from "./stayConflict";
import { writeAuditSnapshot } from "@stay-ops/audit";

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

async function assertRoomActiveForAllocation(tx: Prisma.TransactionClient, roomId: string): Promise<void> {
  const room = await tx.room.findUnique({
    where: { id: roomId },
    select: { isActive: true },
  });
  if (!room) {
    throw new AllocationError({
      code: "BOOKING_NOT_ASSIGNABLE",
      status: 422,
      message: "Room not found",
      details: { roomId },
    });
  }
  if (!room.isActive) {
    throw new AllocationError({
      code: "ROOM_INACTIVE",
      status: 422,
      message: "Room is not active",
      details: { roomId },
    });
  }
}

export type AssignInput = {
  bookingId: string;
  roomId: string;
  actorUserId: string;
  /** When set, must match `Booking.version` (optimistic concurrency). */
  expectedVersion?: number;
  /** Merged into audit `metaJson` (e.g. `requestId` from headers). */
  auditMeta?: Record<string, unknown>;
};

export type ReassignInput = {
  assignmentId: string;
  roomId: string;
  expectedVersion: number;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
};

export type UnassignInput = {
  assignmentId: string;
  expectedVersion: number;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
};

async function resolveActorUserId(
  tx: Prisma.TransactionClient,
  actorUserId: string | null | undefined,
): Promise<string | null> {
  if (!actorUserId) return null;
  const exists = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true },
  });
  return exists?.id ?? null;
}

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

/**
 * Concurrent assigns can lose the race at the DB layer (exclusion constraint, serializable abort)
 * before application-level conflict checks observe the other transaction. Map those to domain errors.
 */
function mapAssignmentWriteConflict(err: unknown): never {
  if (isDryRunRollback(err)) {
    throw err;
  }
  if (err instanceof AllocationError) {
    throw err;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") {
      throw new AllocationError({
        code: "CONFLICT_ASSIGNMENT",
        status: 409,
        message: "Room overlap detected",
        details: { reason: "transaction_conflict" },
      });
    }
    if (err.code === "P2002") {
      const target = err.meta?.target;
      const t = Array.isArray(target) ? target.join(",") : String(target ?? "");
      if (t.includes("booking_id") || t.includes("bookingId")) {
        throw new AllocationError({
          code: "BOOKING_ALREADY_ASSIGNED",
          status: 409,
          message: "Booking already has an assignment; use reassign",
          details: {},
        });
      }
      throw new AllocationError({
        code: "CONFLICT_ASSIGNMENT",
        status: 409,
        message: "Room overlap detected",
        details: { reason: "unique_constraint", target: t },
      });
    }
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    const m = err.message;
    if (m.includes("assignments_room_stay_excl") || m.includes("23P01")) {
      throw new AllocationError({
        code: "CONFLICT_ASSIGNMENT",
        status: 409,
        message: "Room overlap detected",
        details: { reason: "exclusion_constraint" },
      });
    }
  }
  throw err;
}

export type AssignBookingToRoomTxOptions = {
  recorder?: PlanRecorder;
  itemIndex?: number;
  /** When true, skip audit snapshot (used with dry-run rollback). */
  skipAudit?: boolean;
};

/**
 * Assign within an existing transaction (serializable). Used by {@link assignBookingToRoom} and bulk assign.
 */
export async function assignBookingToRoomTx(
  tx: Prisma.TransactionClient,
  input: AssignInput,
  opts?: AssignBookingToRoomTxOptions,
): Promise<AssignmentCommandResult> {
  await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${input.bookingId} FOR UPDATE`;
  const actorUserId = await resolveActorUserId(tx, input.actorUserId);

  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    include: { assignment: true },
  });

  if (!booking) {
    throw new AllocationError({
      code: "BOOKING_NOT_ASSIGNABLE",
      status: 422,
      message: "Booking not found",
      details: { bookingId: input.bookingId, ...(opts?.itemIndex !== undefined ? { failedIndex: opts.itemIndex } : {}) },
    });
  }

  assertAssignable(booking.status);

  if (input.expectedVersion !== undefined && input.expectedVersion !== booking.version) {
    throw new AllocationError({
      code: "STALE_VERSION",
      status: 409,
      message: "Stale booking version",
      details: {
        bookingId: input.bookingId,
        expectedVersion: input.expectedVersion,
        currentVersion: booking.version,
      },
    });
  }

  if (booking.assignment) {
    throw new AllocationError({
      code: "BOOKING_ALREADY_ASSIGNED",
      status: 409,
      message: "Booking already has an assignment; use reassign",
      details: {
        assignmentId: booking.assignment.id,
        ...(opts?.itemIndex !== undefined ? { failedIndex: opts.itemIndex } : {}),
      },
    });
  }

  await assertRoomActiveForAllocation(tx, input.roomId);

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
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });

  opts?.recorder?.push({
    entityType: "assignment",
    entityId: created.id,
    action: "create",
    before: null,
    after: {
      bookingId: created.bookingId,
      roomId: created.roomId,
      startDate: created.startDate.toISOString().slice(0, 10),
      endDate: created.endDate.toISOString().slice(0, 10),
      version: created.version,
    },
  });

  let auditRef = "";
  if (!opts?.skipAudit) {
    auditRef = await writeAuditSnapshot(tx, {
      actorUserId,
      action: "assignment.assign",
      entityType: "assignment",
      entityId: created.id,
      before: null,
      after: {
        bookingId: created.bookingId,
        roomId: created.roomId,
        startDate: created.startDate.toISOString().slice(0, 10),
        endDate: created.endDate.toISOString().slice(0, 10),
        version: created.version,
      },
      meta: { bookingId: input.bookingId, ...(input.auditMeta ?? {}) },
    });
  }

  await ensureTurnoverCleaningTask(tx, {
    bookingId: input.bookingId,
    roomId: created.roomId,
    checkoutDate: booking.checkoutDate,
  });

  if (opts?.recorder) {
    const turnover = await tx.cleaningTask.findFirst({
      where: { bookingId: input.bookingId, taskType: TURNOVER_TASK_TYPE },
    });
    if (turnover) {
      opts.recorder.push({
        entityType: "cleaning_task",
        entityId: turnover.id,
        action: "upsert",
        before: null,
        after: {
          id: turnover.id,
          taskType: turnover.taskType,
          status: turnover.status,
          roomId: turnover.roomId,
          plannedStart: turnover.plannedStart?.toISOString() ?? null,
          plannedEnd: turnover.plannedEnd?.toISOString() ?? null,
        },
      });
    }
  }

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
}

export type BulkAssignBookingsInput = {
  items: Array<{ bookingId: string; roomId: string }>;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
  dryRun?: boolean;
};

export type BulkAssignBookingsResult =
  | { dryRun: true; summary: DryRunResult }
  | { dryRun: false; results: AssignmentCommandResult[] };

const BULK_MAX = 200;

/**
 * All-or-nothing bulk assign. When `dryRun` is true, rolls back after building a {@link DryRunResult}.
 */
export async function bulkAssignBookings(input: BulkAssignBookingsInput): Promise<BulkAssignBookingsResult> {
  const { items, actorUserId, auditMeta, dryRun } = input;
  if (items.length === 0) {
    throw new AllocationError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "At least one assignment item is required",
      details: {},
    });
  }
  if (items.length > BULK_MAX) {
    throw new AllocationError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: `At most ${BULK_MAX} items per request`,
      details: { count: items.length },
    });
  }

  const recorder = dryRun ? new PlanRecorder() : undefined;

  try {
    const results = await prisma.$transaction(
      async (tx) => {
        const out: AssignmentCommandResult[] = [];
        for (let i = 0; i < items.length; i += 1) {
          const it = items[i]!;
          const r = await assignBookingToRoomTx(
            tx,
            { bookingId: it.bookingId, roomId: it.roomId, actorUserId, auditMeta },
            { recorder, itemIndex: i, skipAudit: Boolean(dryRun) },
          );
          out.push(r);
        }
        if (dryRun && recorder) {
          throw new DryRunRollback(recorder.snapshot());
        }
        return out;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    for (const r of results) {
      fireInvalidateCalendarForBookingStay(r.assignment.startDate, r.assignment.endDate);
    }
    return { dryRun: false, results };
  } catch (err) {
    if (isDryRunRollback(err)) {
      return { dryRun: true, summary: err.plan };
    }
    mapAssignmentWriteConflict(err);
  }
}

/**
 * Serializable isolation + row locks on booking prevent lost updates on assignment.version
 * while overlapping stays are blocked by assertNoOverlap and DB exclusion.
 */
export async function assignBookingToRoom(input: AssignInput): Promise<AssignmentCommandResult> {
  try {
    const result = await prisma.$transaction(
      async (tx) => assignBookingToRoomTx(tx, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    fireInvalidateCalendarForBookingStay(result.assignment.startDate, result.assignment.endDate);
    return result;
  } catch (err) {
    mapAssignmentWriteConflict(err);
  }
}

export async function reassignRoom(input: ReassignInput): Promise<AssignmentCommandResult> {
  try {
    const result = await prisma.$transaction(
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
      const actorUserId = await resolveActorUserId(tx, input.actorUserId);

      if (existing.version !== input.expectedVersion) {
        throw new AllocationError({
          code: "STALE_VERSION",
          status: 409,
          message: "Assignment was modified by another operation",
          details: { currentVersion: existing.version, expectedVersion: input.expectedVersion },
        });
      }

      assertAssignable(existing.booking.status);

      await assertRoomActiveForAllocation(tx, input.roomId);

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
          updatedById: actorUserId,
        },
      });

      const auditRef = await writeAuditSnapshot(tx, {
        actorUserId,
        action: "assignment.reassign",
        entityType: "assignment",
        entityId: updated.id,
        before: {
          roomId: existing.roomId,
          version: existing.version,
        },
        after: {
          roomId: updated.roomId,
          version: updated.version,
        },
        meta: { bookingId: existing.bookingId, ...(input.auditMeta ?? {}) },
      });

      await ensureTurnoverCleaningTask(tx, {
        bookingId: existing.bookingId,
        roomId: updated.roomId,
        checkoutDate: existing.booking.checkoutDate,
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
    fireInvalidateCalendarForBookingStay(result.assignment.startDate, result.assignment.endDate);
    return result;
  } catch (err) {
    mapAssignmentWriteConflict(err);
  }
}

export async function unassignBooking(input: UnassignInput): Promise<{ auditRef: string }> {
  const { auditRef, startDate, endDate } = await prisma.$transaction(
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
      const actorUserId = await resolveActorUserId(tx, input.actorUserId);

      if (existing.version !== input.expectedVersion) {
        throw new AllocationError({
          code: "STALE_VERSION",
          status: 409,
          message: "Assignment was modified by another operation",
          details: { currentVersion: existing.version, expectedVersion: input.expectedVersion },
        });
      }

      await tx.cleaningTask.deleteMany({
        where: { bookingId: existing.bookingId, taskType: TURNOVER_TASK_TYPE },
      });

      await tx.assignment.delete({ where: { id: input.assignmentId } });

      const auditRef = await writeAuditSnapshot(tx, {
        actorUserId,
        action: "assignment.unassign",
        entityType: "assignment",
        entityId: input.assignmentId,
        before: {
          bookingId: existing.bookingId,
          roomId: existing.roomId,
          startDate: existing.startDate.toISOString().slice(0, 10),
          endDate: existing.endDate.toISOString().slice(0, 10),
          version: existing.version,
        },
        after: null,
        meta: { bookingId: existing.bookingId, ...(input.auditMeta ?? {}) },
      });

      return { auditRef, startDate: existing.startDate, endDate: existing.endDate };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  fireInvalidateCalendarForBookingStay(startDate, endDate);
  return { auditRef };
}

/** Bookings with no room assignment overlapping `[from, to)` (half-open on dates). */
export type UnassignedListParams = {
  from: Date;
  to: Date;
  channel?: Channel;
  status?: BookingStatus;
};

export async function listUnassignedBookings(params: UnassignedListParams) {
  const overlap = {
    checkinDate: { lt: params.to },
    checkoutDate: { gt: params.from },
  };

  const statusFilter = params.status
    ? { status: params.status }
    : { status: { not: BookingStatus.cancelled } };

  const channelFilter = params.channel ? { channel: params.channel } : {};

  return prisma.booking.findMany({
    where: {
      ...overlap,
      ...statusFilter,
      ...channelFilter,
      assignment: null,
    },
    orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      channel: true,
      externalBookingId: true,
      status: true,
      checkinDate: true,
      checkoutDate: true,
      nights: true,
      guestTotal: true,
      guestAdults: true,
      guestChildren: true,
      guestInfants: true,
    },
  });
}

