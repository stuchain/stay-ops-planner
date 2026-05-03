import { writeAuditSnapshot } from "@stay-ops/audit";
import type { Prisma } from "@stay-ops/db";
import { BookingStatus } from "@stay-ops/db";
import type { PlanRecorder } from "@stay-ops/shared";

/** v1 pending cleaning statuses cancelled when the booking is cancelled. */
export const CLEANING_PENDING_STATUSES = ["todo", "in_progress"] as const;

/**
 * When a booking is cancelled, release its assignment and cancel open cleaning work.
 * Safe to call repeatedly (idempotent side effects).
 */
export type ApplyCancellationSideEffectsOptions = {
  skipAudit?: boolean;
  recorder?: PlanRecorder;
};

export async function applyCancellationSideEffects(
  tx: Prisma.TransactionClient,
  bookingId: string,
  actorUserId?: string | null,
  opts?: ApplyCancellationSideEffectsOptions,
): Promise<void> {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.status !== BookingStatus.cancelled) {
    return;
  }

  const assignment = await tx.assignment.findUnique({
    where: { bookingId },
  });

  if (assignment) {
    const beforeAssignment = {
      id: assignment.id,
      bookingId: assignment.bookingId,
      roomId: assignment.roomId,
      startDate: assignment.startDate.toISOString().slice(0, 10),
      endDate: assignment.endDate.toISOString().slice(0, 10),
      version: assignment.version,
    };
    await tx.assignment.delete({ where: { id: assignment.id } });
    opts?.recorder?.push({
      entityType: "assignment",
      entityId: assignment.id,
      action: "delete",
      before: beforeAssignment,
      after: null,
    });
    if (!opts?.skipAudit) {
      await writeAuditSnapshot(tx, {
        actorUserId: actorUserId ?? null,
        action: "assignment.released_on_cancel",
        entityType: "assignment",
        entityId: assignment.id,
        before: beforeAssignment,
        after: null,
        meta: { bookingId },
      });
    }
  }

  const pendingTasks = await tx.cleaningTask.findMany({
    where: {
      bookingId,
      status: { in: [...CLEANING_PENDING_STATUSES] },
    },
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
    const beforeTask = {
      id: t.id,
      bookingId: t.bookingId,
      roomId: t.roomId,
      status: t.status,
      taskType: t.taskType,
      plannedStart: t.plannedStart?.toISOString() ?? null,
      plannedEnd: t.plannedEnd?.toISOString() ?? null,
    };
    opts?.recorder?.push({
      entityType: "cleaning_task",
      entityId: t.id,
      action: "update",
      before: beforeTask,
      after: { ...beforeTask, status: "cancelled" },
    });
    if (!opts?.skipAudit) {
      await writeAuditSnapshot(tx, {
        actorUserId: actorUserId ?? null,
        action: "cleaning_task.cancelled_on_booking_cancel",
        entityType: "cleaning_task",
        entityId: t.id,
        before: beforeTask,
        after: { ...beforeTask, status: "cancelled" },
        meta: { bookingId },
      });
    }
  }
}
