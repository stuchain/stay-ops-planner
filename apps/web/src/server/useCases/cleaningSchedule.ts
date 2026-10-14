import { writeAuditSnapshot } from "@stay-ops/audit";
import {
  BookingStatus,
  CleaningWindowInvalidError,
  DEFAULT_CHECKIN_TIME,
  DEFAULT_CHECKOUT_TIME,
  ensureTurnoverCleaningTask,
  isSameDayChangeover,
  Prisma,
  SERVICE_TASK_TYPE,
  TURNOVER_TASK_TYPE,
  utcToZonedDay,
  validateCleaningSchedule,
  zonedTimeToUtc,
} from "@stay-ops/db";
import { randomUUID } from "node:crypto";
import { addDays, DomainError, type IsoDate, type Party } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { clockTime, dbDateToIso, isoToDbDate, todayIso } from "@/server/time";
import { findCleanerConflicts } from "./cleaningConflicts";
import { bookingSliceSelect, partyOf } from "./bookingSlice";
import { listCalendarRooms, type CalendarRoom } from "./calendarRange";

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

/**
 * Same-day changeovers get their cleaning automatically (Stelios, 2026-10-14); one can be missing when the stays
 * were placed before that rule or written straight to the database. Create the missing ones for departures in
 * `[from, to)`. Idempotent; a booking that has any turnover task (done or cancelled included) is left alone, and
 * a checkout with nobody arriving that day gets nothing.
 */
export async function ensureTurnoversBetween(from: IsoDate, to: IsoDate): Promise<number> {
  const missing = await prisma.assignment.findMany({
    where: {
      endDate: { gte: isoToDbDate(from), lt: isoToDbDate(to) },
      booking: { status: { not: BookingStatus.cancelled }, cleaningTasks: { none: { taskType: TURNOVER_TASK_TYPE } } },
      room: { isActive: true },
    },
    select: { bookingId: true, roomId: true, endDate: true },
  });
  if (missing.length === 0) return 0;
  const arrivals = await prisma.assignment.findMany({
    where: {
      startDate: { in: missing.map((a) => a.endDate) },
      roomId: { in: [...new Set(missing.map((a) => a.roomId))] },
      booking: { status: { not: BookingStatus.cancelled } },
    },
    select: { roomId: true, startDate: true },
  });
  const arriving = new Set(arrivals.map((a) => `${a.roomId}|${a.startDate.getTime()}`));
  const changeovers = missing.filter((a) => arriving.has(`${a.roomId}|${a.endDate.getTime()}`));
  for (const a of changeovers) {
    await prisma.$transaction((tx) =>
      ensureTurnoverCleaningTask(tx, { bookingId: a.bookingId, roomId: a.roomId, checkoutDate: a.endDate }),
    );
  }
  return changeovers.length;
}

/** Cleanings planned from `from` for `days` days, with the guest who leaves and the one who comes next. */
export async function loadTurnovers(
  from: IsoDate,
  days: number,
  opts: { includeCancelled: boolean },
  now = new Date(),
): Promise<TurnoverList> {
  const to = addDays(from, days);
  await ensureTurnoversBetween(from, to);
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
  rule: (task: { status: string; taskType: string }) => void,
  data: () => Prisma.CleaningTaskUpdateManyMutationInput,
  tx: Prisma.TransactionClient,
  validate?: (task: { roomId: string; bookingId: string; taskType: string }) => Promise<void>,
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
      (task) => checkFits(tx, task, plannedStart, plannedEnd),
    );
  });
}

/**
 * A cleaning after a guest leaves must sit between that checkout and the next guest's arrival. A cleaning added
 * by hand can be on any day the apartment is in use.
 */
async function checkFits(
  tx: Prisma.TransactionClient,
  task: { roomId: string; bookingId: string; taskType: string },
  plannedStart: Date,
  plannedEnd: Date,
): Promise<void> {
  if (task.taskType !== TURNOVER_TASK_TYPE) return;
  try {
    await validateCleaningSchedule(tx, { roomId: task.roomId, bookingId: task.bookingId, plannedStart, plannedEnd });
  } catch (err) {
    if (err instanceof CleaningWindowInvalidError) throw new DomainError("CLEANING_DOES_NOT_FIT");
    throw err;
  }
}

/**
 * Moves a cleaning to another day, keeping its times. Not into the past, and not once it is done or cancelled.
 * A cleaning after a same-day changeover cannot move: the next guest arrives that afternoon.
 */
export async function moveCleaningDay(input: Change & { day: IsoDate }, now = new Date()): Promise<void> {
  if (input.day < todayIso(now)) throw new DomainError("CLEANING_IN_PAST");
  await run(async (tx) => {
    const current = await tx.cleaningTask.findUnique({
      where: { id: input.id },
      select: { plannedStart: true, plannedEnd: true },
    });
    if (!current) throw new DomainError("NOT_FOUND");
    if (!current.plannedStart || !current.plannedEnd) throw new DomainError("VALIDATION");
    const plannedStart = zonedTimeToUtc(input.day, clockTime(current.plannedStart));
    const plannedEnd = new Date(
      plannedStart.getTime() + (current.plannedEnd.getTime() - current.plannedStart.getTime()),
    );
    await updateTask(
      input,
      "cleaning_task.day_moved",
      (task) => {
        if (task.status === "done" || task.status === "cancelled") throw new DomainError("TASK_CLOSED");
      },
      () => ({ plannedStart, plannedEnd }),
      tx,
      (task) => checkFits(tx, task, plannedStart, plannedEnd),
    );
  });
}

/** How long a cleaning added by hand is planned to take. */
export const ADDED_CLEANING_MINUTES = 120;

/**
 * A cleaning added by hand belongs to the stay it is closest to in that apartment: the guest staying that day,
 * else the one who left last, else the next one coming. Null when the apartment has never had a stay.
 */
async function stayForDay(tx: Prisma.TransactionClient, roomId: string, day: IsoDate): Promise<string | null> {
  const date = isoToDbDate(day);
  const live = { roomId, booking: { status: { not: BookingStatus.cancelled } } };
  const during = await tx.assignment.findFirst({
    where: { ...live, startDate: { lte: date }, endDate: { gt: date } },
    select: { bookingId: true },
  });
  if (during) return during.bookingId;
  const before = await tx.assignment.findFirst({
    where: { ...live, endDate: { lte: date } },
    orderBy: [{ endDate: "desc" }, { id: "asc" }],
    select: { bookingId: true },
  });
  if (before) return before.bookingId;
  const after = await tx.assignment.findFirst({
    where: { ...live, startDate: { gt: date } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { bookingId: true },
  });
  return after?.bookingId ?? null;
}

/** Adds a cleaning on any day from today, in an apartment, at a time, with who cleans and a note if given. */
export async function addCleaning(
  input: {
    roomId: string;
    day: IsoDate;
    start: string;
    assigneeName: string | null;
    notes: string | null;
    actorUserId: string;
  },
  now = new Date(),
): Promise<{ id: string }> {
  if (!CLOCK.test(input.start)) throw new DomainError("VALIDATION");
  if (input.day < todayIso(now)) throw new DomainError("CLEANING_IN_PAST");
  const name = input.assigneeName?.trim() || null;
  const notes = input.notes?.trim() || null;
  if ((name?.length ?? 0) > 80 || (notes?.length ?? 0) > 300) throw new DomainError("VALIDATION");
  const plannedStart = zonedTimeToUtc(input.day, input.start);
  const plannedEnd = new Date(plannedStart.getTime() + ADDED_CLEANING_MINUTES * 60_000);
  let id = "";
  await run(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: input.roomId }, select: { isActive: true } });
    if (!room?.isActive) throw new DomainError("ROOM_INACTIVE");
    const bookingId = await stayForDay(tx, input.roomId, input.day);
    if (!bookingId) throw new DomainError("CLEANING_NO_STAY");
    const row = await tx.cleaningTask.create({
      data: {
        bookingId,
        roomId: input.roomId,
        status: "todo",
        taskType: SERVICE_TASK_TYPE,
        sourceEventId: `manual:${randomUUID()}`,
        plannedStart,
        plannedEnd,
        durationMinutes: ADDED_CLEANING_MINUTES,
        assigneeName: name,
        notes,
      },
    });
    id = row.id;
    await writeAuditSnapshot(tx, {
      actorUserId: input.actorUserId,
      action: "cleaning_task.added",
      entityType: "cleaning_task",
      entityId: row.id,
      before: null,
      after: {
        status: "todo",
        plannedStart: plannedStart.toISOString(),
        plannedEnd: plannedEnd.toISOString(),
        assigneeName: name,
      },
      meta: { bookingId },
    });
  });
  return { id };
}

/**
 * Takes a cleaning off the schedule. The one for a same-day changeover stays: the next guest arrives that day.
 * A finished cleaning stays as a record.
 */
export async function removeCleaning(input: Change): Promise<void> {
  await run(async (tx) => {
    const task = await tx.cleaningTask.findUnique({
      where: { id: input.id },
      select: { bookingId: true, roomId: true, taskType: true, booking: { select: { checkoutDate: true } } },
    });
    if (!task) throw new DomainError("NOT_FOUND");
    if (
      task.taskType === TURNOVER_TASK_TYPE &&
      (await isSameDayChangeover(tx, { ...task, checkoutDate: task.booking.checkoutDate }))
    ) {
      throw new DomainError("CLEANING_CHANGEOVER");
    }
    await updateTask(
      input,
      "cleaning_task.removed",
      (row) => {
        if (row.status === "done" || row.status === "cancelled") throw new DomainError("TASK_CLOSED");
      },
      () => ({ status: "cancelled" }),
      tx,
    );
  });
}

/** The days the cleaning calendar shows at once. */
export const CALENDAR_DAYS = 21;

/** A stay drawn on the cleaning calendar. */
export type CleaningStay = {
  id: string;
  roomId: string;
  guestName: string | null;
  checkin: IsoDate;
  checkout: IsoDate;
  party: Party | null;
};

export type CleaningCalendar = {
  today: IsoDate;
  from: IsoDate;
  /** The day after the last day shown. */
  to: IsoDate;
  rooms: CalendarRoom[];
  stays: CleaningStay[];
  tasks: TurnoverTask[];
  /** Names already used for who cleans, most recent first, to pick from. */
  cleaners: string[];
};

/** Everything the cleaning calendar shows from `from`: apartments, the stays in them, and the cleanings. */
export async function loadCleaningCalendar(from: IsoDate, now = new Date()): Promise<CleaningCalendar> {
  const to = addDays(from, CALENDAR_DAYS);
  const [rooms, assignments, list, recent] = await Promise.all([
    listCalendarRooms(),
    prisma.assignment.findMany({
      where: {
        startDate: { lt: isoToDbDate(to) },
        endDate: { gt: isoToDbDate(from) },
        booking: { status: { not: BookingStatus.cancelled } },
      },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      select: {
        roomId: true,
        startDate: true,
        endDate: true,
        booking: { select: { id: true, guestName: true, ...partySelect } },
      },
    }),
    loadTurnovers(from, CALENDAR_DAYS, { includeCancelled: false }, now),
    prisma.cleaningTask.findMany({
      where: { assigneeName: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { assigneeName: true },
    }),
  ]);
  const cleaners = [...new Set(recent.map((r) => r.assigneeName!.trim()).filter(Boolean))].slice(0, 6);
  return {
    today: list.today,
    from,
    to,
    rooms: rooms.filter((r) => r.isActive),
    stays: assignments.map((a) => ({
      id: a.booking.id,
      roomId: a.roomId,
      guestName: a.booking.guestName,
      checkin: dbDateToIso(a.startDate),
      checkout: dbDateToIso(a.endDate),
      party: partyOf(a.booking),
    })),
    tasks: list.tasks,
    cleaners,
  };
}

const partySelect = { guestTotal: true, guestAdults: true, guestChildren: true, guestInfants: true } as const;
