import { createHash } from "node:crypto";
import { BookingStatus, Prisma } from "@prisma/client";
import { dateOnlyToDay, DEFAULT_CHECKOUT_TIME, zonedTimeToUtc } from "./settings.js";

export const TURNOVER_TASK_TYPE = "turnover";
export const TURNOVER_MINUTES = 120;

/**
 * Key prefix of an automatic cleaning cancelled because its checkout is not a same-day changeover. It only comes
 * back when the day becomes a changeover, not just because the booking is placed again.
 */
export const TURNOVER_SET_ASIDE_PREFIX = "set-aside:";

/**
 * Default turnover window for a checkout day: starts at the checkout time (11:00) on that calendar day in the
 * business time zone (Athens) and lasts `durationMinutes`. Correct across the summer/winter clock change.
 */
export function computeTurnoverPlannedWindowUTC(
  checkoutDate: Date,
  durationMinutes: number = TURNOVER_MINUTES,
): { plannedStart: Date; plannedEnd: Date } {
  const plannedStart = zonedTimeToUtc(dateOnlyToDay(checkoutDate), DEFAULT_CHECKOUT_TIME);
  const plannedEnd = new Date(plannedStart.getTime() + durationMinutes * 60_000);
  return { plannedStart, plannedEnd };
}

/**
 * Stable SHA-256 idempotency key for turnover rows (Phase 5: hash of booking + checkout day + room + turnover).
 */
export function turnoverSourceEventId(bookingId: string, checkoutDate: Date, roomId: string): string {
  const day = checkoutDate.toISOString().slice(0, 10);
  const payload = `${bookingId}|${day}|${roomId}|turnover`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Takes a booking out of its apartment: open turnover cleanings (to do, in progress) are cancelled,
 * finished ones are kept (E4-4). Placing the booking again brings the cancelled task back.
 */
export async function cancelOpenTurnoverTasks(tx: Prisma.TransactionClient, bookingId: string): Promise<number> {
  const result = await tx.cleaningTask.updateMany({
    where: { bookingId, taskType: TURNOVER_TASK_TYPE, status: { in: ["todo", "in_progress"] } },
    data: { status: "cancelled" },
  });
  return result.count;
}

/**
 * Keeps the automatic cleanings in step after a booking is placed or changed. Cleanings are added automatically
 * only for a same-day changeover: the guest leaves and the next one arrives the same day in the same apartment
 * (Stelios, 2026-10-14). Every other cleaning is added by hand. So this looks after the booking's own checkout and
 * after the stay that ends on its arrival day, which may have just become a changeover.
 */
export async function ensureTurnoverCleaningTask(
  tx: Prisma.TransactionClient,
  params: { bookingId: string; roomId: string; checkoutDate: Date },
): Promise<void> {
  const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
  if (!booking || booking.status === BookingStatus.cancelled) {
    return;
  }
  await ensureOwnTurnover(tx, params, booking.status);
  // Every apartment this guest walks into (on arrival, or when moving mid-stay) may have just become a changeover.
  const pieces = await tx.assignment.findMany({
    where: { bookingId: params.bookingId },
    select: { roomId: true, startDate: true },
  });
  const arrivals = pieces.length > 0 ? pieces : [{ roomId: params.roomId, startDate: booking.checkinDate }];
  for (const arrival of arrivals) {
    const before = await tx.assignment.findFirst({
      where: {
        roomId: arrival.roomId,
        bookingId: { not: params.bookingId },
        endDate: arrival.startDate,
        booking: { status: { not: BookingStatus.cancelled } },
      },
      select: { bookingId: true, roomId: true, endDate: true },
    });
    if (before) {
      await ensureOwnTurnover(tx, { bookingId: before.bookingId, roomId: before.roomId, checkoutDate: before.endDate });
    }
  }
}

/** True when another guest arrives in the apartment on this checkout day. */
export async function isSameDayChangeover(
  tx: Prisma.TransactionClient,
  params: { bookingId: string; roomId: string; checkoutDate: Date },
): Promise<boolean> {
  const next = await tx.assignment.findFirst({
    where: {
      roomId: params.roomId,
      bookingId: { not: params.bookingId },
      startDate: params.checkoutDate,
      booking: { status: { not: BookingStatus.cancelled } },
    },
    select: { id: true },
  });
  return next !== null;
}

/**
 * At most one turnover cleaning task per assigned booking (DB partial unique on booking_id where turnover).
 * Skips cancelled bookings, a missing assignment, or a finished task; a cancelled task comes back when the booking
 * is placed again. Times set by hand are kept while the checkout day is the same. A new task is only made for a
 * same-day changeover.
 */
async function ensureOwnTurnover(
  tx: Prisma.TransactionClient,
  params: { bookingId: string; roomId: string; checkoutDate: Date },
  knownStatus?: BookingStatus,
): Promise<void> {
  const status = knownStatus ?? (await tx.booking.findUnique({ where: { id: params.bookingId } }))?.status;
  if (!status || status === BookingStatus.cancelled) {
    return;
  }

  // Only the real checkout gets a cleaning: the last piece of the stay, ending on the booking's check-out day.
  // A guest moving apartment mid-stay leaves an earlier piece on a day that is not a checkout.
  const booking = await tx.booking.findUnique({ where: { id: params.bookingId }, select: { checkoutDate: true } });
  const assignment = await tx.assignment.findFirst({
    where: { bookingId: params.bookingId },
    orderBy: { startDate: "desc" },
  });
  if (
    !booking ||
    !assignment ||
    assignment.roomId !== params.roomId ||
    booking.checkoutDate.getTime() !== params.checkoutDate.getTime()
  ) {
    return;
  }

  const room = await tx.room.findUnique({
    where: { id: params.roomId },
    select: { isActive: true },
  });
  if (!room?.isActive) {
    return;
  }

  const { plannedStart, plannedEnd } = computeTurnoverPlannedWindowUTC(params.checkoutDate);
  const sourceEventId = turnoverSourceEventId(params.bookingId, params.checkoutDate, params.roomId);

  const existing = await tx.cleaningTask.findFirst({
    where: { bookingId: params.bookingId, taskType: TURNOVER_TASK_TYPE },
  });

  if (existing) {
    if (existing.status === "done") {
      return;
    }
    if (
      existing.status === "cancelled" &&
      existing.sourceEventId?.startsWith(TURNOVER_SET_ASIDE_PREFIX) &&
      !(await isSameDayChangeover(tx, params))
    ) {
      return;
    }
    // A manual reschedule stays unless the checkout moved. The key carries the checkout day, so it tells
    // whether the stored times were made for this checkout.
    const sameCheckout =
      existing.sourceEventId === turnoverSourceEventId(params.bookingId, params.checkoutDate, existing.roomId);
    const keepTimes = sameCheckout && existing.plannedStart !== null && existing.plannedEnd !== null;
    await tx.cleaningTask.update({
      where: { id: existing.id },
      data: {
        roomId: params.roomId,
        // Put back when an earlier unassign cancelled it and the booking is placed again.
        ...(existing.status === "cancelled" ? { status: "todo" } : {}),
        ...(keepTimes ? {} : { plannedStart, plannedEnd, durationMinutes: TURNOVER_MINUTES }),
        sourceEventId,
      },
    });
    return;
  }

  if (!(await isSameDayChangeover(tx, params))) {
    return;
  }

  await tx.cleaningTask.create({
    data: {
      bookingId: params.bookingId,
      roomId: params.roomId,
      status: "todo",
      taskType: TURNOVER_TASK_TYPE,
      sourceEventId,
      plannedStart,
      plannedEnd,
      durationMinutes: TURNOVER_MINUTES,
    },
  });
}
