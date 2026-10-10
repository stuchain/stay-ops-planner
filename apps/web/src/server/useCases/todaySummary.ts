import { BookingStatus } from "@stay-ops/db";
import { addDays, type IsoDate } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { appTimeZone, isoToDbDate, todayIso } from "@/server/time";
import { bookingSliceSelect, toBookingSlice } from "./bookingSlice";

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

  const [rows, needsApartment] = await Promise.all([
    prisma.booking.findMany({
      where: { ...notCancelled, OR: [{ checkinDate: { in: days } }, { checkoutDate: { in: days } }] },
      select: {
        ...bookingSliceSelect,
        assignment: { select: { roomId: true, pinned: true, room: roomSelect } },
      },
      orderBy: [{ checkinDate: "asc" }, { guestName: "asc" }, { id: "asc" }],
    }),
    prisma.booking.count({ where: { ...notCancelled, assignment: null, checkoutDate: { gt: isoToDbDate(today) } } }),
  ]);

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
  };
}
