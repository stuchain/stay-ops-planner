import { BookingStatus } from "@stay-ops/db";
import { addDays, GAP_LOOKAHEAD_DAYS, GAP_MAX_NIGHTS, shortGaps, type IsoDate, type Occupied } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { appTimeZone, dbDateToIso, isoToDbDate, todayIso } from "@/server/time";
import { bookingSliceSelect, toBookingSlice } from "./bookingSlice";
import { byCalendarOrder } from "./calendarRange";
import { previousStaysForMany } from "./previousStays";

/** One arrival or departure on the Today screen. */
export type TodayStay = {
  id: string;
  guestName: string | null;
  /** Adults + children; null when Hosthub did not say. */
  partySize: number | null;
  nights: number;
  checkin: IsoDate;
  checkout: IsoDate;
  /** Pending bookings are shown greyed and labelled. Cancelled ones never appear. */
  status: "confirmed" | "pending" | "needs_reassignment";
  /** The apartment the stay is in, or null while it still needs one. */
  room: { id: string; name: string; color: string | null } | null;
  /** The team's notes about this guest: this booking's own first, then ones from earlier stays (same phone or e-mail). */
  guestNotes: string[];
};

/** A single empty night between stays in an apartment, which the 2-night minimum stay leaves unsellable. */
export type TodayGap = {
  room: { id: string; name: string; color: string | null };
  /** First empty night. */
  start: IsoDate;
  /** The next arrival (the night after the last empty one). */
  end: IsoDate;
  nights: number;
  /** A booking next to the gap (the next arrival, else the last departure) to open the calendar on. */
  bookingId: string | null;
};

export type TodaySummary = {
  /** Today in the business time zone, so the browser's clock never decides it. */
  today: IsoDate;
  tomorrow: IsoDate;
  arrivals: TodayStay[];
  departures: TodayStay[];
  tomorrowArrivals: TodayStay[];
  tomorrowDepartures: TodayStay[];
  /** Bookings without an apartment whose stay has not ended (same rule as the calendar tray). */
  needsApartment: number;
  /** Short empty gaps in the next GAP_LOOKAHEAD_DAYS days, soonest first. */
  gaps: TodayGap[];
};

const roomSelect = { select: { id: true, displayName: true, code: true, color: true } } as const;

/**
 * Everything the Today screen shows in one round trip: arrivals and departures for today and tomorrow, and how many
 * bookings still need an apartment. Cancelled bookings are left out.
 */
export async function getTodaySummary(now = new Date(), timeZone: string = appTimeZone()): Promise<TodaySummary> {
  const today = todayIso(now, timeZone);
  const tomorrow = addDays(today, 1);
  const days = [isoToDbDate(today), isoToDbDate(tomorrow)];
  const notCancelled = { status: { not: BookingStatus.cancelled } };

  const horizon = isoToDbDate(addDays(today, GAP_LOOKAHEAD_DAYS));
  const [rows, needsApartment, placed, blocks, rooms] = await Promise.all([
    prisma.booking.findMany({
      where: { ...notCancelled, OR: [{ checkinDate: { in: days } }, { checkoutDate: { in: days } }] },
      select: {
        ...bookingSliceSelect,
        guestNote: true,
        assignment: { select: { roomId: true, pinned: true, room: roomSelect } },
      },
      orderBy: [{ checkinDate: "asc" }, { guestName: "asc" }, { id: "asc" }],
    }),
    prisma.booking.count({ where: { ...notCancelled, assignment: null, checkoutDate: { gt: isoToDbDate(today) } } }),
    prisma.booking.findMany({
      where: {
        ...notCancelled,
        assignment: { isNot: null },
        checkinDate: { lt: horizon },
        checkoutDate: { gte: isoToDbDate(addDays(today, -GAP_MAX_NIGHTS)) },
      },
      select: { id: true, checkinDate: true, checkoutDate: true, assignment: { select: { roomId: true } } },
    }),
    prisma.manualBlock.findMany({
      where: { startDate: { lt: horizon }, endDate: { gte: isoToDbDate(addDays(today, -GAP_MAX_NIGHTS)) } },
      select: { id: true, roomId: true, startDate: true, endDate: true },
    }),
    prisma.room.findMany({
      where: { isActive: true },
      select: { id: true, displayName: true, code: true, color: true, calendarSortIndex: true },
    }),
  ]);

  const BLOCK = "block:";
  const occupied: Occupied[] = [
    ...placed.map((b) => ({
      id: b.id,
      roomId: b.assignment!.roomId,
      start: dbDateToIso(b.checkinDate),
      end: dbDateToIso(b.checkoutDate),
    })),
    ...blocks.map((b) => ({
      id: `${BLOCK}${b.id}`,
      roomId: b.roomId,
      start: dbDateToIso(b.startDate),
      end: dbDateToIso(b.endDate),
    })),
  ];
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const gaps = shortGaps(occupied, { after: today })
    .flatMap((g): TodayGap[] => {
      const room = roomById.get(g.roomId);
      if (!room) return [];
      const bookingId = [g.afterId, g.beforeId].find((id) => !id.startsWith(BLOCK)) ?? null;
      return [
        {
          room: { id: room.id, name: room.displayName ?? room.code ?? room.id, color: room.color },
          start: g.start,
          end: g.end,
          nights: g.nights,
          bookingId,
        },
      ];
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : byCalendarOrder(roomById, a.room.id, b.room.id)));

  const arriving = rows.filter((r) => days.some((d) => d.getTime() === r.checkinDate.getTime()));
  const previous = await previousStaysForMany(arriving.map((r) => r.id));

  const stays = rows.map((row): TodayStay => {
    const slice = toBookingSlice(row);
    const room = row.assignment?.room;
    return {
      id: slice.id,
      guestName: slice.guestName,
      partySize: slice.partySize,
      nights: slice.nights,
      checkin: slice.checkin,
      checkout: slice.checkout,
      status: slice.status as TodayStay["status"],
      room: room ? { id: room.id, name: room.displayName ?? room.code ?? room.id, color: room.color } : null,
      guestNotes: [
        ...(row.guestNote ? [row.guestNote] : []),
        ...(previous.get(row.id)?.sure ?? []).flatMap((s) => (s.note ? [s.note] : [])),
      ],
    };
  });

  return {
    today,
    tomorrow,
    arrivals: stays.filter((s) => s.checkin === today),
    departures: stays.filter((s) => s.checkout === today),
    tomorrowArrivals: stays.filter((s) => s.checkin === tomorrow),
    tomorrowDepartures: stays.filter((s) => s.checkout === tomorrow),
    needsApartment,
    gaps,
  };
}
