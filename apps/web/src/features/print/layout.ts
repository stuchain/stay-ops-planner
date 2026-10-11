import { addDays, compareDates, daysBetween, type IsoDate } from "@stay-ops/domain";
import type { CalendarBlock, CalendarBooking, CalendarRangeData, CalendarRoom } from "@/api/types";
import { addMonths, monthStart } from "@/features/calendar/timeline";

export type PrintView = "week" | "month";

/** Day of the week, 0 = Sunday. */
function weekdayOf(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The Monday on or before `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** The first day a sheet of this kind starts on, for any date inside it. */
export function sheetStart(view: PrintView, date: IsoDate): IsoDate {
  return view === "week" ? mondayOf(date) : monthStart(date);
}

/** The day after the sheet's last day. */
export function sheetEnd(view: PrintView, from: IsoDate): IsoDate {
  return view === "week" ? addDays(from, 7) : addMonths(from, 1);
}

/** The sheet before (-1) or after (+1) this one. */
export function shiftSheet(view: PrintView, from: IsoDate, direction: -1 | 1): IsoDate {
  return view === "week" ? addDays(from, 7 * direction) : addMonths(from, direction);
}

/** A request that is not confirmed yet. */
export const isPending = (booking: Pick<CalendarBooking, "status">) => booking.status === "pending";

export type CellEntry = {
  /** "departure": the guest leaves this morning. "stay": the guest sleeps here tonight. */
  kind: "departure" | "stay";
  booking: CalendarBooking;
  /** Only for a stay: the guest arrives today. */
  arrival: boolean;
};

export type WeekCell = { day: IsoDate; entries: CellEntry[]; closed: boolean };
export type WeekRow = { room: CalendarRoom; cells: WeekCell[] };
export type WeekSheet = { days: IsoDate[]; rows: WeekRow[]; unplaced: CalendarBooking[] };

type Data = Pick<CalendarRangeData, "rooms" | "bookings" | "blocks">;

const byCheckin = (a: CalendarBooking, b: CalendarBooking) =>
  compareDates(a.checkin, b.checkin) || compareDates(a.checkout, b.checkout) || (a.id < b.id ? -1 : 1);

/** Bookings that still need an apartment, in arrival order. */
export function unplacedBookings(bookings: CalendarBooking[]): CalendarBooking[] {
  return bookings.filter((b) => b.assignment === null).sort(byCheckin);
}

const touches = (from: IsoDate, to: IsoDate, start: IsoDate, end: IsoDate) => start < to && end > from;

/** Apartments to list: the active ones, plus a switched-off one that still has something in the range. */
function roomsToShow(data: Data, from: IsoDate, to: IsoDate): CalendarRoom[] {
  return data.rooms.filter(
    (room) =>
      room.isActive ||
      data.bookings.some((b) => b.assignment?.roomId === room.id && touches(from, to, b.checkin, b.checkout)) ||
      data.blocks.some((b) => b.roomId === room.id && touches(from, to, b.start, b.end)),
  );
}

/**
 * Which booking goes in which cell of the week table. A night belongs to the day it starts on, so a guest
 * sleeps in the cell for every day from check-in up to (not including) check-out, and shows as leaving on
 * the check-out day. A same-day turnover therefore has a departure and an arrival in the same cell.
 */
export function buildWeek(data: Data, from: IsoDate): WeekSheet {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const rows = roomsToShow(data, from, addDays(from, 7)).map((room): WeekRow => {
    const mine = data.bookings.filter((b) => b.assignment?.roomId === room.id).sort(byCheckin);
    const blocks = data.blocks.filter((b) => b.roomId === room.id);
    const cells = days.map((day): WeekCell => {
      const departures = mine.filter((b) => b.checkout === day);
      const stays = mine.filter((b) => b.checkin <= day && day < b.checkout);
      return {
        day,
        closed: blocks.some((b) => b.start <= day && day < b.end),
        entries: [
          ...departures.map((booking): CellEntry => ({ kind: "departure", booking, arrival: false })),
          ...stays.map((booking): CellEntry => ({ kind: "stay", booking, arrival: booking.checkin === day })),
        ],
      };
    });
    return { room, cells };
  });
  return { days, rows, unplaced: unplacedBookings(data.bookings) };
}

export type MonthItem =
  | { kind: "stay"; booking: CalendarBooking; start: IsoDate; end: IsoDate; nights: number }
  | { kind: "closed"; block: CalendarBlock; start: IsoDate; end: IsoDate; nights: number };

export type MonthSection = { room: CalendarRoom; items: MonthItem[] };
export type MonthSheet = { sections: MonthSection[]; unplaced: CalendarBooking[] };

/** Each apartment's stays and closed periods that touch the month, in date order. */
export function buildMonth(data: Data, from: IsoDate): MonthSheet {
  const to = addMonths(from, 1);
  const sections = roomsToShow(data, from, to).map((room): MonthSection => {
    const stays = data.bookings
      .filter((b) => b.assignment?.roomId === room.id && touches(from, to, b.checkin, b.checkout))
      .map((booking): MonthItem => ({
        kind: "stay",
        booking,
        start: booking.checkin,
        end: booking.checkout,
        nights: booking.nights,
      }));
    const closed = data.blocks
      .filter((b) => b.roomId === room.id && touches(from, to, b.start, b.end))
      .map((block): MonthItem => ({
        kind: "closed",
        block,
        start: block.start,
        end: block.end,
        nights: daysBetween(block.start, block.end),
      }));
    const items = [...stays, ...closed].sort((a, b) => compareDates(a.start, b.start) || compareDates(a.end, b.end));
    return { room, items };
  });
  return { sections, unplaced: unplacedBookings(data.bookings) };
}
