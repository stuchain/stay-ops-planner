import { writeAuditSnapshot } from "@stay-ops/audit";
import {
  computeTurnoverPlannedWindowUTC,
  createServiceCleaningTask,
  Prisma,
  SERVICE_MINUTES,
  validateCleaningSchedule,
  zonedTimeToUtc,
} from "@stay-ops/db";
import { DryRunRollback, isDryRunRollback, PlanRecorder, type DryRunResult } from "@stay-ops/shared";
import { prisma } from "@/lib/prisma";
import {
  CleaningBookingNotFoundError,
  CleaningTaskNotFoundError,
  InvalidStateTransitionError,
  StaleCleaningTaskError,
} from "./errors";

function cleaningTaskSnapshot(t: {
  id: string;
  bookingId: string;
  roomId: string;
  status: string;
  taskType: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  assigneeName: string | null;
  durationMinutes: number | null;
}) {
  return {
    id: t.id,
    bookingId: t.bookingId,
    roomId: t.roomId,
    status: t.status,
    taskType: t.taskType,
    plannedStart: t.plannedStart?.toISOString() ?? null,
    plannedEnd: t.plannedEnd?.toISOString() ?? null,
    assigneeName: t.assigneeName,
    durationMinutes: t.durationMinutes,
  };
}

export type ListCleaningTasksQuery = {
  date?: string | undefined;
  assignee?: string | undefined;
  status?: string | undefined;
  roomId?: string | undefined;
};

export async function listCleaningTasks(q: ListCleaningTasksQuery) {
  const where: Prisma.CleaningTaskWhereInput = {};

  if (q.roomId) where.roomId = q.roomId;
  if (q.status) where.status = q.status;
  if (q.assignee !== undefined && q.assignee !== "") {
    where.assigneeName = q.assignee;
  }

  if (q.date) {
    // The day is the Athens calendar day, not the UTC one (E4-2).
    const day = zonedTimeToUtc(q.date, "00:00");
    const next = new Date(`${q.date}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    where.plannedStart = { gte: day, lt: zonedTimeToUtc(next.toISOString().slice(0, 10), "00:00") };
  }

  return prisma.cleaningTask.findMany({
    where,
    orderBy: [{ plannedStart: "asc" }, { id: "asc" }],
  });
}

export async function updateCleaningTaskSchedule(params: {
  taskId: string;
  plannedStart: Date;
  plannedEnd: Date;
  assigneeName?: string | null | undefined;
  /** The `updatedAt` the person was looking at; a different one means the task changed meanwhile. */
  expectedUpdatedAt?: Date | undefined;
  actorUserId: string;
  auditMeta?: Record<string, unknown> | undefined;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const task = await tx.cleaningTask.findUnique({ where: { id: params.taskId } });
    if (!task) {
      throw new CleaningTaskNotFoundError(params.taskId);
    }
    // A finished or cancelled cleaning is history; it cannot be moved (E4-5).
    if (task.status === "done" || task.status === "cancelled") {
      throw new InvalidStateTransitionError(`Cannot reschedule a ${task.status} cleaning task`);
    }
    if (params.expectedUpdatedAt && task.updatedAt.getTime() !== params.expectedUpdatedAt.getTime()) {
      throw new StaleCleaningTaskError();
    }

    await validateCleaningSchedule(tx, {
      roomId: task.roomId,
      bookingId: task.bookingId,
      plannedStart: params.plannedStart,
      plannedEnd: params.plannedEnd,
    });

    const before = cleaningTaskSnapshot(task);

    const updated = await tx.cleaningTask.update({
      where: { id: params.taskId },
      data: {
        plannedStart: params.plannedStart,
        plannedEnd: params.plannedEnd,
        ...(params.assigneeName !== undefined ? { assigneeName: params.assigneeName } : {}),
      },
    });

    await writeAuditSnapshot(tx, {
      actorUserId: params.actorUserId,
      action: "cleaning_task.schedule_update",
      entityType: "cleaning_task",
      entityId: updated.id,
      before,
      after: cleaningTaskSnapshot(updated),
      meta: { bookingId: task.bookingId, ...(params.auditMeta ?? {}) },
    });
  });
}

export type ServiceCleaningTaskApiResult = {
  created: boolean;
  task: {
    id: string;
    bookingId: string;
    roomId: string;
    status: string | null;
    taskType: string;
    plannedStart: Date | null;
    plannedEnd: Date | null;
    assigneeName: string | null;
    durationMinutes: number | null;
  };
};

export type CreateServiceCleaningTaskForApiTxOptions = {
  recorder?: PlanRecorder | undefined;
  itemIndex?: number | undefined;
  skipAudit?: boolean | undefined;
};

export async function createServiceCleaningTaskForApiTx(
  tx: Prisma.TransactionClient,
  params: {
    bookingId: string;
    roomId: string;
    sourceEventId?: string | undefined;
    plannedStart?: Date | undefined;
    actorUserId: string;
    auditMeta?: Record<string, unknown> | undefined;
  },
  opts?: CreateServiceCleaningTaskForApiTxOptions,
): Promise<ServiceCleaningTaskApiResult> {
  const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
  if (!booking) {
    throw new CleaningBookingNotFoundError({
      bookingId: params.bookingId,
      ...(opts?.itemIndex !== undefined ? { failedIndex: opts.itemIndex } : {}),
    });
  }

  const { plannedStart, plannedEnd } = params.plannedStart
    ? {
        plannedStart: params.plannedStart,
        plannedEnd: new Date(params.plannedStart.getTime() + SERVICE_MINUTES * 60_000),
      }
    : computeTurnoverPlannedWindowUTC(booking.checkoutDate, SERVICE_MINUTES);

  await validateCleaningSchedule(tx, {
    roomId: params.roomId,
    bookingId: params.bookingId,
    plannedStart,
    plannedEnd,
  });

  const sourceEventId = params.sourceEventId ?? crypto.randomUUID();
  const r = await createServiceCleaningTask(tx, {
    bookingId: params.bookingId,
    roomId: params.roomId,
    sourceEventId,
    plannedStart,
  });
  const task = await tx.cleaningTask.findUniqueOrThrow({ where: { id: r.id } });
  if (r.created && !opts?.skipAudit) {
    await writeAuditSnapshot(tx, {
      actorUserId: params.actorUserId,
      action: "cleaning_task.service_create",
      entityType: "cleaning_task",
      entityId: task.id,
      before: null,
      after: cleaningTaskSnapshot(task),
      meta: { bookingId: params.bookingId, ...(params.auditMeta ?? {}) },
    });
  }

  opts?.recorder?.push({
    entityType: "cleaning_task",
    entityId: task.id,
    action: r.created ? "create" : "noop",
    before: null,
    after: cleaningTaskSnapshot(task),
  });

  return { created: r.created, task };
}

export async function createServiceCleaningTaskForApi(params: {
  bookingId: string;
  roomId: string;
  sourceEventId?: string | undefined;
  plannedStart?: Date | undefined;
  actorUserId: string;
  auditMeta?: Record<string, unknown> | undefined;
}): Promise<ServiceCleaningTaskApiResult> {
  return prisma.$transaction(async (tx) => createServiceCleaningTaskForApiTx(tx, params));
}

export type BulkCreateServiceCleaningTasksInput = {
  items: Array<{
    bookingId: string;
    roomId: string;
    sourceEventId?: string | undefined;
    /** ISO string; optional (defaults from booking checkout like single create). */
    plannedStart?: string | undefined;
  }>;
  actorUserId: string;
  auditMeta?: Record<string, unknown> | undefined;
  dryRun?: boolean | undefined;
};

export type BulkCreateServiceCleaningTasksResult =
  | { dryRun: true; summary: DryRunResult }
  | { dryRun: false; results: ServiceCleaningTaskApiResult[] };

const BULK_CLEANING_MAX = 200;

/**
 * All-or-nothing bulk create for service cleaning tasks.
 */
export async function bulkCreateServiceCleaningTasks(
  input: BulkCreateServiceCleaningTasksInput,
): Promise<BulkCreateServiceCleaningTasksResult> {
  const { items, actorUserId, auditMeta, dryRun } = input;
  if (items.length === 0) {
    throw new InvalidStateTransitionError("At least one cleaning task item is required");
  }
  if (items.length > BULK_CLEANING_MAX) {
    throw new InvalidStateTransitionError(`At most ${BULK_CLEANING_MAX} cleaning tasks per request`);
  }

  const recorder = dryRun ? new PlanRecorder() : undefined;

  try {
    const results = await prisma.$transaction(
      async (tx) => {
        const out: ServiceCleaningTaskApiResult[] = [];
        for (let i = 0; i < items.length; i += 1) {
          const it = items[i]!;
          let plannedStart: Date | undefined;
          if (it.plannedStart) {
            const d = new Date(it.plannedStart);
            if (Number.isNaN(d.getTime())) {
              throw new InvalidStateTransitionError(`Invalid plannedStart at index ${i}`);
            }
            plannedStart = d;
          }
          const r = await createServiceCleaningTaskForApiTx(
            tx,
            {
              bookingId: it.bookingId,
              roomId: it.roomId,
              sourceEventId: it.sourceEventId,
              plannedStart,
              actorUserId,
              auditMeta,
            },
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
    return { dryRun: false, results };
  } catch (e) {
    if (isDryRunRollback(e)) {
      return { dryRun: true, summary: e.plan };
    }
    throw e;
  }
}
