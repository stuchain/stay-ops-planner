import { BookingStatus } from "@stay-ops/db";
import { overbookedNights, type IsoDate } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso, isoToDbDate, todayIso } from "@/server/time";
import { bookingSliceSelect, toBookingSlice, type BookingSlice } from "./bookingSlice";

export type CalendarRoom = {
  id: string;
  name: string;
  color: string | null;
  capacity: number | null;
  preferredForLargeParty: boolean;
  isActive: boolean;
};

export type CalendarBlock = { id: string; roomId: string; start: IsoDate; end: IsoDate; reason: string | null };

export type CalendarRange = {
  from: IsoDate;
  to: IsoDate;
  /** Today in the business time zone, so the browser's clock never decides it (E1-32). */
  today: IsoDate;
  rooms: CalendarRoom[];
  /** Placed bookings and the unplaced ones, all overlapping `[from, to)`. Cancelled bookings are left out. */
  bookings: BookingSlice[];
  blocks: CalendarBlock[];
  /** Ids of bookings that need an apartment, by arrival. Past stays are left out. */
  unassigned: string[];
  /** Nights with more confirmed stays than apartments in use (E1-6). */
  overbookedNights: IsoDate[];
};

/** Rooms in calendar order: the set order first, then the rest by name. */
export async function listCalendarRooms(): Promise<CalendarRoom[]> {
  const rooms = await prisma.room.findMany({
    select: {
      id: true,
      code: true,
      displayName: true,
      color: true,
      maxGuests: true,
      preferredForLargeParty: true,
      isActive: true,
      calendarSortIndex: true,
    },
    orderBy: [{ calendarSortIndex: { sort: "asc", nulls: "last" } }, { displayName: "asc" }, { id: "asc" }],
  });
  return rooms.map((r) => ({
    id: r.id,
    name: r.displayName ?? r.code ?? r.id,
    color: r.color,
    capacity: r.maxGuests,
    preferredForLargeParty: r.preferredForLargeParty,
    isActive: r.isActive,
  }));
}

/**
 * Everything the calendar shows for `[from, to)` in one round trip: rooms, bookings, closed periods,
 * the "needs an apartment" list and overbooked nights. Queries use the date indexes on bookings and blocks.
 */
export async function getCalendarRange(from: IsoDate, to: IsoDate, now = new Date()): Promise<CalendarRange> {
  const fromDate = isoToDbDate(from);
  const toDate = isoToDbDate(to);
  const today = todayIso(now);

  const [rooms, bookingRows, blockRows] = await Promise.all([
    listCalendarRooms(),
    prisma.booking.findMany({
      where: {
        checkinDate: { lt: toDate },
        checkoutDate: { gt: fromDate },
        status: { not: BookingStatus.cancelled },
      },
      select: bookingSliceSelect,
      orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
    }),
    prisma.manualBlock.findMany({
      where: { startDate: { lt: toDate }, endDate: { gt: fromDate } },
      select: { id: true, roomId: true, startDate: true, endDate: true, reason: true },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    }),
  ]);

  const bookings = bookingRows.map(toBookingSlice);
  const unassigned = bookings.filter((b) => b.assignment === null && b.checkout > today).map((b) => b.id);
  const activeRooms = rooms.filter((r) => r.isActive).length;
  const confirmedStays = bookings
    .filter((b) => b.status === BookingStatus.confirmed || b.status === BookingStatus.needs_reassignment)
    .map((b) => ({ checkin: b.checkin, checkout: b.checkout }));

  return {
    from,
    to,
    today,
    rooms,
    bookings,
    blocks: blockRows.map((b) => ({
      id: b.id,
      roomId: b.roomId,
      start: dbDateToIso(b.startDate),
      end: dbDateToIso(b.endDate),
      reason: b.reason,
    })),
    unassigned,
    overbookedNights: overbookedNights(confirmedStays, activeRooms, from, to),
  };
}
