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
  nextArrivalAfter,
  TURNOVER_MINUTES,
  TURNOVER_REMOVED_PREFIX,
  TURNOVER_SET_ASIDE_PREFIX,
  TURNOVER_TASK_TYPE,
  turnoverSourceEventId,
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

/**
 * The kind of cleaning, shown on the calendar instead of the time (Stelios, 2026-10-14). AA: a guest leaves and the
 * next arrives the same day, fixed to that day. A: a guest leaves, may move to a later day up to the next arrival.
 * S: a service during a stay, on a day of that stay.
 */
export type CleaningKind = "AA" | "A" | "S";

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
  /** `label` is the name with its number in calendar order, "1 - Onar", as the list and the paper show it. */
  room: { id: string; name: string; label: string; color: string | null };
  /** The guest who leaves, and when (the standard check-out time). */
  leaving: { guestName: string | null; time: string };
  /**
   * Who the cleaning is for, shown instead of times (Stelios, 2026-10-14): the guest who comes next for A-A and A
   * (null when nobody is booked), the guest who is staying for S.
   */
  guest: { name: string | null; party: Party | null } | null;
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
  kind: CleaningKind;
  /** The days it may move to (`to` null: any later day), or null when it stays on its day. */
  movable: { from: IsoDate; to: IsoDate | null } | null;
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
 * Every checkout gets its cleaning automatically (Stelios, 2026-10-14); one can be missing when the stay was placed
 * while only same-day changeovers got one, or written straight to the database. Create the missing ones for
 * departures in `[from, to)`, bring back the ones set aside under that rule, and bring back a removed one whose day
 * became a changeover. Idempotent; a cleaning done, or cancelled any other way, is left alone.
 */
export async function ensureTurnoversBetween(from: IsoDate, to: IsoDate): Promise<number> {
  const pieces = await prisma.assignment.findMany({
    where: {
      endDate: { gte: isoToDbDate(from), lt: isoToDbDate(to) },
      booking: {
        status: { not: BookingStatus.cancelled },
        cleaningTasks: {
          none: {
            taskType: TURNOVER_TASK_TYPE,
            NOT: {
              OR: [
                { sourceEventId: { startsWith: TURNOVER_SET_ASIDE_PREFIX } },
                { sourceEventId: { startsWith: TURNOVER_REMOVED_PREFIX } },
              ],
            },
          },
        },
      },
      room: { isActive: true },
    },
    select: { bookingId: true, roomId: true, endDate: true, booking: { select: { checkoutDate: true } } },
  });
  // Only real checkouts: a guest moving apartment mid-stay leaves an earlier piece on a day that is not one.
  const missing = pieces.filter((a) => a.endDate.getTime() === a.booking.checkoutDate.getTime());
  for (const a of missing) {
    await prisma.$transaction((tx) =>
      ensureTurnoverCleaningTask(tx, { bookingId: a.bookingId, roomId: a.roomId, checkoutDate: a.endDate }),
    );
  }
  return missing.length;
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

  const [rows, cancelledCount, rooms] = await Promise.all([
    prisma.cleaningTask.findMany({
      where: opts.includeCancelled ? where : { ...where, status: { not: "cancelled" } },
      orderBy: [{ plannedStart: "asc" }, { id: "asc" }],
      include: {
        room: { select: { id: true, displayName: true, code: true, color: true } },
        booking: {
          select: {
            guestName: true,
            checkoutDate: true,
            ...partySelect,
            assignments: { select: { roomId: true, startDate: true, endDate: true } },
          },
        },
      },
    }),
    prisma.cleaningTask.count({ where: { ...where, status: "cancelled" } }),
    listCalendarRooms(),
  ]);
  const numbers = new Map(rooms.filter((r) => r.isActive).map((r, i) => [r.id, i + 1]));

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
    const checkout = dbDateToIso(row.booking.checkoutDate);
    const sameDay = checkin === checkout;
    const kind: CleaningKind = row.taskType !== TURNOVER_TASK_TYPE ? "S" : sameDay ? "AA" : "A";
    const name = row.room.displayName ?? row.room.code ?? row.room.id;
    const number = numbers.get(row.room.id);
    tasks.push({
      id: row.id,
      day,
      status: asStatus(row.status),
      taskType: row.taskType,
      room: { id: row.room.id, name, label: number ? `${number} - ${name}` : name, color: row.room.color },
      leaving: { guestName: row.booking.guestName, time: DEFAULT_CHECKOUT_TIME },
      guest:
        kind === "S"
          ? { name: row.booking.guestName, party: partyOf(row.booking) }
          : next
            ? { name: next.booking.guestName, party: partyOf(next.booking) }
            : null,
      next:
        next && checkin
          ? {
              checkin,
              time: DEFAULT_CHECKIN_TIME,
              party: partyOf(next.booking),
              sameDay,
            }
          : null,
      start: clockTime(row.plannedStart),
      end: clockTime(row.plannedEnd),
      assigneeName: row.assigneeName,
      notes: row.notes,
      version: row.updatedAt.toISOString(),
      conflictsWith: conflicts.get(row.id) ?? [],
      kind,
      movable:
        kind === "AA"
          ? null
          : kind === "A"
            ? { from: checkout, to: checkin }
            : serviceDays(row.booking.assignments, row.roomId, day),
    });
  });

  return { today: todayIso(now), from, to, tasks, cancelledCount };
}

/**
 * The days a service may be on: the full days of the stay in that apartment, after the arrival day and before the
 * leaving day. Null when there are none (a one-night stay).
 */
function serviceDays(
  pieces: Array<{ roomId: string; startDate: Date; endDate: Date }>,
  roomId: string,
  day: IsoDate,
): { from: IsoDate; to: IsoDate } | null {
  const inRoom = pieces.filter((p) => p.roomId === roomId);
  const piece = inRoom.find((p) => dbDateToIso(p.startDate) < day && day < dbDateToIso(p.endDate)) ?? inRoom[0];
  if (!piece) return null;
  const from = addDays(dbDateToIso(piece.startDate), 1);
  const to = addDays(dbDateToIso(piece.endDate), -1);
  return from <= to ? { from, to } : null;
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
): Promise<string> {
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
  return after.updatedAt.toISOString();
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

async function run(work: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<void> {
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
 * A cleaning after a guest leaves must sit between that checkout and the next guest's arrival. A service stays
 * within its stay, on a day the guest is there all day.
 */
async function checkFits(
  tx: Prisma.TransactionClient,
  task: { roomId: string; bookingId: string; taskType: string },
  plannedStart: Date,
  plannedEnd: Date,
): Promise<void> {
  if (task.taskType !== TURNOVER_TASK_TYPE) {
    const date = isoToDbDate(utcToZonedDay(plannedStart) as IsoDate);
    const piece = await tx.assignment.findFirst({
      where: { bookingId: task.bookingId, roomId: task.roomId, startDate: { lt: date }, endDate: { gt: date } },
      select: { id: true },
    });
    if (!piece) throw new DomainError("CLEANING_NOT_IN_STAY");
    return;
  }
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

const live = { status: { not: BookingStatus.cancelled } };

/** The stay in the apartment the guest is there all day on `day` (not the arrival or leaving day), or null. */
async function stayAllDay(tx: Prisma.TransactionClient, roomId: string, day: IsoDate) {
  const date = isoToDbDate(day);
  return tx.assignment.findFirst({
    where: { roomId, booking: live, startDate: { lt: date }, endDate: { gt: date } },
    select: { bookingId: true },
  });
}

/**
 * The checkout an A on `day` belongs to: the last guest who left the apartment on or before that day, with nobody
 * staying in between. Null when the day is inside a stay or nobody has left yet.
 */
async function checkoutBefore(tx: Prisma.TransactionClient, roomId: string, day: IsoDate) {
  const date = isoToDbDate(day);
  if (await stayAllDay(tx, roomId, day)) return null;
  const last = await tx.assignment.findFirst({
    where: { roomId, booking: live, endDate: { lte: date } },
    orderBy: [{ endDate: "desc" }, { id: "asc" }],
    select: { bookingId: true, roomId: true, endDate: true, booking: { select: { checkoutDate: true } } },
  });
  // A guest who moved to another apartment mid-stay did not check out here.
  if (!last || last.endDate.getTime() !== last.booking.checkoutDate.getTime()) return null;
  const between = await tx.assignment.findFirst({
    where: { roomId, booking: live, bookingId: { not: last.bookingId }, startDate: { gte: last.endDate, lt: date } },
    select: { id: true },
  });
  return between ? null : last;
}

/**
 * Adds a cleaning by hand on a day from today, with a note if given.
 * - S: a service during a stay, on a day the guest is there all day.
 * - A: after the last guest who left, from their checkout up to the next arrival. It is that checkout's cleaning,
 *   so it is refused while that one is still on the schedule (removed or never made, it comes back on this day).
 * - AA: the same, on the day itself of a same-day changeover.
 */
export async function addCleaning(
  input: { roomId: string; day: IsoDate; kind: CleaningKind; notes: string | null; actorUserId: string },
  now = new Date(),
): Promise<{ id: string }> {
  if (input.day < todayIso(now)) throw new DomainError("CLEANING_IN_PAST");
  const notes = input.notes?.trim() || null;
  if ((notes?.length ?? 0) > 300) throw new DomainError("VALIDATION");
  let id = "";
  await run(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: input.roomId }, select: { isActive: true } });
    if (!room?.isActive) throw new DomainError("ROOM_INACTIVE");
    if (input.kind === "S") {
      const stay = await stayAllDay(tx, input.roomId, input.day);
      if (!stay) throw new DomainError("CLEANING_NOT_IN_STAY");
      const plannedStart = zonedTimeToUtc(input.day, DEFAULT_CHECKOUT_TIME);
      const plannedEnd = new Date(plannedStart.getTime() + ADDED_CLEANING_MINUTES * 60_000);
      const row = await tx.cleaningTask.create({
        data: {
          bookingId: stay.bookingId,
          roomId: input.roomId,
          status: "todo",
          taskType: SERVICE_TASK_TYPE,
          sourceEventId: `manual:${randomUUID()}`,
          plannedStart,
          plannedEnd,
          durationMinutes: ADDED_CLEANING_MINUTES,
          notes,
        },
      });
      id = row.id;
      await audit(tx, input.actorUserId, row.id, stay.bookingId, plannedStart, plannedEnd);
      return;
    }
    const checkout = await checkoutBefore(tx, input.roomId, input.day);
    if (!checkout) throw new DomainError("CLEANING_NO_CHECKOUT");
    const next = await nextArrivalAfter(tx, {
      bookingId: checkout.bookingId,
      roomId: checkout.roomId,
      checkoutDate: checkout.endDate,
    });
    const changeover = next !== null && next.getTime() === checkout.endDate.getTime();
    // A changeover's cleaning is always on the checkout day; picking A-A means exactly that day.
    if (input.kind === "AA" && (!changeover || dbDateToIso(checkout.endDate) !== input.day)) {
      throw new DomainError("CLEANING_NO_CHANGEOVER");
    }
    const day = changeover ? dbDateToIso(checkout.endDate) : input.day;
    const plannedStart = zonedTimeToUtc(day, DEFAULT_CHECKOUT_TIME);
    const plannedEnd = new Date(plannedStart.getTime() + TURNOVER_MINUTES * 60_000);
    const sourceEventId = turnoverSourceEventId(checkout.bookingId, checkout.endDate, checkout.roomId);
    const existing = await tx.cleaningTask.findFirst({
      where: { bookingId: checkout.bookingId, taskType: TURNOVER_TASK_TYPE },
    });
    if (existing && existing.status !== "cancelled") throw new DomainError("CLEANING_ALREADY_THERE");
    const data = {
      roomId: checkout.roomId,
      status: "todo",
      sourceEventId,
      plannedStart,
      plannedEnd,
      durationMinutes: TURNOVER_MINUTES,
      notes,
    };
    const row = existing
      ? await tx.cleaningTask.update({ where: { id: existing.id }, data })
      : await tx.cleaningTask.create({
          data: { ...data, bookingId: checkout.bookingId, taskType: TURNOVER_TASK_TYPE },
        });
    id = row.id;
    await audit(tx, input.actorUserId, row.id, checkout.bookingId, plannedStart, plannedEnd);
  });
  return { id };
}

async function audit(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  taskId: string,
  bookingId: string,
  plannedStart: Date,
  plannedEnd: Date,
) {
  await writeAuditSnapshot(tx, {
    actorUserId,
    action: "cleaning_task.added",
    entityType: "cleaning_task",
    entityId: taskId,
    before: null,
    after: { status: "todo", plannedStart: plannedStart.toISOString(), plannedEnd: plannedEnd.toISOString() },
    meta: { bookingId },
  });
}

/**
 * Takes a cleaning off the schedule. The one for a same-day changeover stays: the next guest arrives that day.
 * A finished cleaning stays as a record. A removed A is marked so it does not come back by itself.
 */
export async function removeCleaning(input: Change): Promise<{ version: string }> {
  let version = "";
  await run(async (tx) => {
    const task = await tx.cleaningTask.findUnique({
      where: { id: input.id },
      select: {
        bookingId: true,
        roomId: true,
        taskType: true,
        sourceEventId: true,
        booking: { select: { checkoutDate: true } },
      },
    });
    if (!task) throw new DomainError("NOT_FOUND");
    if (
      task.taskType === TURNOVER_TASK_TYPE &&
      (await isSameDayChangeover(tx, { ...task, checkoutDate: task.booking.checkoutDate }))
    ) {
      throw new DomainError("CLEANING_CHANGEOVER");
    }
    version = await updateTask(
      input,
      "cleaning_task.removed",
      (row) => {
        if (row.status === "done" || row.status === "cancelled") throw new DomainError("TASK_CLOSED");
      },
      () => ({
        status: "cancelled",
        ...(task.taskType === TURNOVER_TASK_TYPE && task.sourceEventId
          ? { sourceEventId: `${TURNOVER_REMOVED_PREFIX}${task.sourceEventId}` }
          : {}),
      }),
      tx,
    );
  });
  return { version };
}

/** Puts back a cleaning just removed (the Undo after removing). */
export async function restoreCleaning(input: Change): Promise<void> {
  await run(async (tx) => {
    const task = await tx.cleaningTask.findUnique({ where: { id: input.id }, select: { sourceEventId: true } });
    if (!task) throw new DomainError("NOT_FOUND");
    const key = task.sourceEventId?.startsWith(TURNOVER_REMOVED_PREFIX)
      ? task.sourceEventId.slice(TURNOVER_REMOVED_PREFIX.length)
      : task.sourceEventId;
    await updateTask(
      input,
      "cleaning_task.restored",
      (row) => {
        if (row.status !== "cancelled") throw new DomainError("TASK_CLOSED");
      },
      () => ({ status: "todo", sourceEventId: key }),
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
