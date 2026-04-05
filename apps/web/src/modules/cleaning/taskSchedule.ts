import {
  computeTurnoverPlannedWindowUTC,
  createServiceCleaningTask,
  Prisma,
  PrismaClient,
  SERVICE_MINUTES,
  validateCleaningSchedule,
} from "@stay-ops/db";
import { CleaningBookingNotFoundError, CleaningTaskNotFoundError } from "./errors";

const prisma = new PrismaClient();

export type ListCleaningTasksQuery = {
  date?: string;
  assignee?: string;
  status?: string;
  roomId?: string;
};

export async function listCleaningTasks(q: ListCleaningTasksQuery) {
  const where: Prisma.CleaningTaskWhereInput = {};

  if (q.roomId) where.roomId = q.roomId;
  if (q.status) where.status = q.status;
  if (q.assignee !== undefined && q.assignee !== "") {
    where.assigneeName = q.assignee;
  }

  if (q.date) {
    const day = new Date(`${q.date}T00:00:00.000Z`);
    const next = new Date(day);
    next.setUTCDate(next.getUTCDate() + 1);
    where.plannedStart = { gte: day, lt: next };
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
  assigneeName?: string | null;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const task = await tx.cleaningTask.findUnique({ where: { id: params.taskId } });
    if (!task) {
      throw new CleaningTaskNotFoundError(params.taskId);
    }

    await validateCleaningSchedule(tx, {
      roomId: task.roomId,
      bookingId: task.bookingId,
      plannedStart: params.plannedStart,
      plannedEnd: params.plannedEnd,
    });

    await tx.cleaningTask.update({
      where: { id: params.taskId },
      data: {
        plannedStart: params.plannedStart,
        plannedEnd: params.plannedEnd,
        ...(params.assigneeName !== undefined ? { assigneeName: params.assigneeName } : {}),
      },
    });
  });
}

export async function createServiceCleaningTaskForApi(params: {
  bookingId: string;
  roomId: string;
  sourceEventId?: string;
  plannedStart?: Date;
}): Promise<{
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
}> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
    if (!booking) {
      throw new CleaningBookingNotFoundError();
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
    return { created: r.created, task };
  });
}
