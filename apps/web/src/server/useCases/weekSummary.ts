import { BookingStatus } from "@stay-ops/db";
import { addDays, type IsoDate } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { appTimeZone, isoToDbDate, todayIso } from "@/server/time";
import { piecesArgs } from "./stayPieces";
import { bookingSliceSelect, toBookingSlice } from "./bookingSlice";
import { byCalendarOrder } from "./calendarRange";
import { loadTurnovers, type TurnoverTask } from "./cleaningSchedule";
import type { TodayStay } from "./todaySummary";

/** One day of the week: who arrives, who leaves and which apartments are cleaned. */
export type WeekDay = {
  date: IsoDate;
  arrivals: TodayStay[];
  departures: TodayStay[];
  cleanings: TurnoverTask[];
};

export type WeekSummary = {
  today: IsoDate;
  /** The first day: the Monday, or the requested day when asked to start there. */
  from: IsoDate;
  days: WeekDay[];
};

/** The Monday on or before `day`. */
export function mondayOn(day: IsoDate): IsoDate {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

const roomSelect = {
  select: { id: true, displayName: true, code: true, color: true, calendarSortIndex: true },
} as const;

/**
 * The weekly summary (Monday to Sunday): arrivals, departures and cleanings per day. Cancelled bookings and
 * cancelled cleanings are left out.
 */
export async function getWeekSummary(
  day: IsoDate | undefined,
  now = new Date(),
  timeZone: string = appTimeZone(),
  /** "day": the 7 days starting on `day` (or today) instead of on its Monday; Today's "next days" uses it. */
  start: "monday" | "day" = "monday",
): Promise<WeekSummary> {
  const today = todayIso(now, timeZone);
  const from = start === "day" ? (day ?? today) : mondayOn(day ?? today);
  const to = addDays(from, 7);
  const range = { gte: isoToDbDate(from), lt: isoToDbDate(to) };

  const [rows, turnovers] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: { not: BookingStatus.cancelled },
        OR: [{ checkinDate: range }, { checkoutDate: range }],
      },
      select: {
        ...bookingSliceSelect,
        guestNote: true,
        assignments: { ...piecesArgs, select: { ...piecesArgs.select, room: roomSelect } },
      },
      orderBy: [{ checkinDate: "asc" }, { guestName: "asc" }, { id: "asc" }],
    }),
    loadTurnovers(from, 7, { includeCancelled: false }, now),
  ]);

  // Arrivals show the apartment the guest arrives in, departures the one they leave from (the last piece).
  const stayOf = (row: (typeof rows)[number], piece: (typeof row.assignments)[number] | undefined): TodayStay => {
    const slice = toBookingSlice(row);
    const room = piece?.room;
    return {
      id: slice.id,
      guestName: slice.guestName,
      partySize: slice.partySize,
      nights: slice.nights,
      checkin: slice.checkin,
      checkout: slice.checkout,
      status: slice.status as TodayStay["status"],
      room: room ? { id: room.id, name: room.displayName ?? room.code ?? room.id, color: room.color } : null,
      // Only this booking's own note; Today adds the ones from earlier stays.
      guestNotes: row.guestNote ? [row.guestNote] : [],
    };
  };
  const stays = rows.map((row) => stayOf(row, row.assignments[0]));
  const leaving = rows.map((row) => stayOf(row, row.assignments[row.assignments.length - 1]));
  const roomById = new Map(rows.flatMap((r) => r.assignments.map((a) => [a.room.id, a.room] as const)));
  const byRoom = (a: TodayStay, b: TodayStay) => byCalendarOrder(roomById, a.room?.id, b.room?.id);

  const days = Array.from({ length: 7 }, (_, i): WeekDay => {
    const date = addDays(from, i);
    return {
      date,
      arrivals: stays.filter((s) => s.checkin === date).sort(byRoom),
      departures: leaving.filter((s) => s.checkout === date).sort(byRoom),
      cleanings: turnovers.tasks.filter((task) => task.day === date),
    };
  });
  return { today, from, days };
}
