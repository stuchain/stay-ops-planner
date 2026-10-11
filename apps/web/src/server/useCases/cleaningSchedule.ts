import { writeAuditSnapshot } from "@stay-ops/audit";
import {
  BookingStatus,
  CleaningWindowInvalidError,
  DEFAULT_CHECKIN_TIME,
  DEFAULT_CHECKOUT_TIME,
  Prisma,
  utcToZonedDay,
  validateCleaningSchedule,
  zonedTimeToUtc,
} from "@stay-ops/db";
import { addDays, DomainError, type IsoDate, type Party } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { clockTime, todayIso } from "@/server/time";
import { findCleanerConflicts } from "./cleaningConflicts";
import { bookingSliceSelect, partyOf } from "./bookingSlice";

export type TurnoverStatus = "todo" | "in_progress" | "done" | "cancelled";

/** The days one page of the schedule covers. */
export const SCHEDULE_PAGE_DAYS = 7;

/** One cleaning on the schedule. */
export type TurnoverTask = {
  id: string;
  /** The day it is planned for, in the business time zone. */
  day: IsoDate;
  status: TurnoverStatus;
  /** `turnover` (guest left) or `service` (a clean in between). */
  taskType: string;
  room: { id: string; name: string; color: string | null };
  /** The guest who leaves, and when (the standard check-out time). */
  leaving: { guestName: string | null; time: string };
  /** The next guest in the same apartment, or null when nobody comes. */
  next: { checkin: IsoDate; time: string; party: Party | null; sameDay: boolean } | null;
  /** The cleaning window as `HH:MM` in the business time zone. */
  start: string;
  end: string;
  assigneeName: string | null;
  notes: string | null;
  /** Send back with every change; a different value means someone changed the cleaning meanwhile. */
  version: string;
  /** Other open cleanings the same person is booked on at the same time. */
  conflictsWith: string[];
};

export type TurnoverList = {
  today: IsoDate;
  from: IsoDate;
  /** The day after the last day shown. */
  to: IsoDate;
  tasks: TurnoverTask[];
  /** Cancelled cleanings in this range (shown only on request). */
  cancelledCount: number;
};

function asStatus(status: string | null): TurnoverStatus {
  return status === "in_progress" || status === "done" || status === "cancelled" ? status : "todo";
}

function dayStart(day: IsoDate): Date {
  return zonedTimeToUtc(day, "00:00");
}

/** Cleanings planned from `from` for `days` days, with the guest who leaves and the one who comes next. */
export async function loadTurnovers(
  from: IsoDate,
  days: number,
  opts: { includeCancelled: boolean },
  now = new Date(),
): Promise<TurnoverList> {
  const to = addDays(from, days);
  const where: Prisma.CleaningTaskWhereInput = { plannedStart: { gte: dayStart(from), lt: dayStart(to) } };

  const [rows, cancelledCount] = await Promise.all([
    prisma.cleaningTask.findMany({
      where: opts.includeCancelled ? where : { ...where, status: { not: "cancelled" } },
      orderBy: [{ plannedStart: "asc" }, { id: "asc" }],
      include: {
        room: { select: { id: true, displayName: true, code: true, color: true } },
        booking: { select: { guestName: true, checkoutDate: true } },
      },
    }),
    prisma.cleaningTask.count({ where: { ...where, status: "cancelled" } }),
  ]);

  const nexts = await Promise.all(
    rows.map((row) =>
      prisma.assignment.findFirst({
        where: {
          roomId: row.roomId,
          bookingId: { not: row.bookingId },
          startDate: { gte: row.booking.checkoutDate },
          booking: { status: { not: BookingStatus.cancelled } },
        },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        select: { startDate: true, booking: { select: bookingSliceSelect } },
      }),
    ),
  );

  const candidates = rows.flatMap((row) =>
    row.plannedStart && row.plannedEnd
      ? [
          {
            id: row.id,
            status: row.status,
            assigneeName: row.assigneeName,
            start: row.plannedStart,
            end: row.plannedEnd,
          },
        ]
      : [],
  );
  const conflicts = findCleanerConflicts(candidates);

  const tasks: TurnoverTask[] = [];
  rows.forEach((row, i) => {
    if (!row.plannedStart || !row.plannedEnd) return;
    const day = utcToZonedDay(row.plannedStart) as IsoDate;
    const next = nexts[i];
    const checkin = next ? (next.startDate.toISOString().slice(0, 10) as IsoDate) : null;
    tasks.push({
      id: row.id,
      day,
      status: asStatus(row.status),
      taskType: row.taskType,
      room: { id: row.room.id, name: row.room.displayName ?? row.room.code ?? row.room.id, color: row.room.color },
      leaving: { guestName: row.booking.guestName, time: DEFAULT_CHECKOUT_TIME },
      next:
        next && checkin
          ? {
              checkin,
              time: DEFAULT_CHECKIN_TIME,
              party: partyOf(next.booking),
              sameDay: checkin === (row.booking.checkoutDate.toISOString().slice(0, 10) as IsoDate),
            }
          : null,
      start: clockTime(row.plannedStart),
      end: clockTime(row.plannedEnd),
      assigneeName: row.assigneeName,
      notes: row.notes,
      version: row.updatedAt.toISOString(),
      conflictsWith: conflicts.get(row.id) ?? [],
    });
  });

  return { today: todayIso(now), from, to, tasks, cancelledCount };
}

type Change = { id: string; expectedVersion: string; actorUserId: string };

function parseVersion(version: string): Date {
  const date = new Date(version);
  if (Number.isNaN(date.getTime())) throw new DomainError("VALIDATION");
  return date;
}

/**
 * Changes one cleaning if it is still the one the person was looking at. The check is part of the update, so two
 * people saving at once cannot both win (E4-5).
 */
async function updateTask(
  change: Change,
  action: string,
  rule: (task: { status: string }) => void,
  data: () => Prisma.CleaningTaskUpdateManyMutationInput,
  tx: Prisma.TransactionClient,
  validate?: (task: { roomId: string; bookingId: string }) => Promise<void>,
): Promise<void> {
  const task = await tx.cleaningTask.findUnique({ where: { id: change.id } });
  if (!task) throw new DomainError("NOT_FOUND");
  rule(task);
  if (task.updatedAt.getTime() !== parseVersion(change.expectedVersion).getTime()) {
    throw new DomainError("CHANGED_MEANWHILE");
  }
  if (validate) await validate(task);
  const result = await tx.cleaningTask.updateMany({
    where: { id: task.id, updatedAt: task.updatedAt },
    data: data(),
  });
  if (result.count !== 1) throw new DomainError("CHANGED_MEANWHILE");
  const after = await tx.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
  const snapshot = (t: {
    status: string;
    plannedStart: Date | null;
    plannedEnd: Date | null;
    assigneeName: string | null;
  }) => ({
    status: t.status,
    plannedStart: t.plannedStart?.toISOString() ?? null,
    plannedEnd: t.plannedEnd?.toISOString() ?? null,
    assigneeName: t.assigneeName,
  });
  await writeAuditSnapshot(tx, {
    actorUserId: change.actorUserId,
    action,
    entityType: "cleaning_task",
    entityId: task.id,
    before: snapshot(task),
    after: snapshot(after),
    meta: { bookingId: task.bookingId },
  });
}

const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

function mapRace(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2002")) {
    throw new DomainError("CHANGED_MEANWHILE");
  }
  if (err instanceof Error && (err.message.includes("40001") || err.message.includes("could not serialize"))) {
    throw new DomainError("CHANGED_MEANWHILE");
  }
  throw err;
}

async function run(work: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(work, serializable);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    mapRace(err);
  }
}

/** Marks a cleaning to do, started or done. A cancelled one stays cancelled. */
export async function setTurnoverStatus(input: Change & { status: "todo" | "in_progress" | "done" }): Promise<void> {
  await run((tx) =>
    updateTask(
      input,
      "cleaning_task.status_changed",
      (task) => {
        if (task.status === "cancelled") throw new DomainError("TASK_CLOSED");
      },
      () => ({ status: input.status }),
      tx,
    ),
  );
}

/** Sets who cleans. An empty name clears it. */
export async function setTurnoverAssignee(input: Change & { assigneeName: string | null }): Promise<void> {
  const name = input.assigneeName?.trim() ?? "";
  if (name.length > 80) throw new DomainError("VALIDATION");
  await run((tx) =>
    updateTask(
      input,
      "cleaning_task.assignee_changed",
      (task) => {
        if (task.status === "cancelled") throw new DomainError("TASK_CLOSED");
      },
      () => ({ assigneeName: name === "" ? null : name }),
      tx,
    ),
  );
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Moves the cleaning to other times on its own day. A finished or cancelled cleaning cannot be moved. */
export async function rescheduleTurnover(input: Change & { start: string; end: string }): Promise<void> {
  if (!CLOCK.test(input.start) || !CLOCK.test(input.end) || input.end <= input.start) {
    throw new DomainError("VALIDATION");
  }
  await run(async (tx) => {
    const current = await tx.cleaningTask.findUnique({ where: { id: input.id }, select: { plannedStart: true } });
    if (!current) throw new DomainError("NOT_FOUND");
    const day = current.plannedStart ? utcToZonedDay(current.plannedStart) : null;
    if (!day) throw new DomainError("VALIDATION");
    const plannedStart = zonedTimeToUtc(day, input.start);
    const plannedEnd = zonedTimeToUtc(day, input.end);
    await updateTask(
      input,
      "cleaning_task.schedule_update",
      (task) => {
        if (task.status === "done" || task.status === "cancelled") throw new DomainError("TASK_CLOSED");
      },
      () => ({
        plannedStart,
        plannedEnd,
        durationMinutes: Math.round((plannedEnd.getTime() - plannedStart.getTime()) / 60_000),
      }),
      tx,
      async (task) => {
        try {
          await validateCleaningSchedule(tx, { ...task, plannedStart, plannedEnd });
        } catch (err) {
          if (err instanceof CleaningWindowInvalidError) throw new DomainError("CLEANING_DOES_NOT_FIT");
          throw err;
        }
      },
    );
  });
}
