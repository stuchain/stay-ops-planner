import { BookingStatus } from "@stay-ops/db";
import { incomeFor, occupancyByRoom, type OccupancyStay, type RoomOccupancy } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso } from "@/server/time";
import { listCalendarRooms } from "./calendarRange";

export interface OccupancyApartment {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

export interface OccupancyYear {
  readonly year: number;
  /** Apartments in calendar order. */
  readonly apartments: readonly OccupancyApartment[];
  readonly thisYear: readonly RoomOccupancy[];
  readonly lastYear: readonly RoomOccupancy[];
}

/**
 * Occupancy and price per night by apartment and month, for a year and the one before.
 * Only confirmed stays that sit in an apartment count; cancelled and pending ones do not.
 * The price per night is the booking's gross (what the guest paid) shared over its nights.
 */
export async function buildOccupancy(year: number, db: typeof prisma = prisma): Promise<OccupancyYear> {
  const bookings = await db.booking.findMany({
    where: {
      status: BookingStatus.confirmed,
      assignments: { some: {} },
      checkinDate: { lt: new Date(Date.UTC(year + 1, 0, 1)) },
      checkoutDate: { gt: new Date(Date.UTC(year - 1, 0, 1)) },
    },
    select: {
      channel: true,
      status: true,
      totalValueCents: true,
      totalAmountCents: true,
      payoutAmountCents: true,
      cleaningFeeCents: true,
      currency: true,
      checkinDate: true,
      checkoutDate: true,
      assignments: { select: { roomId: true, startDate: true, endDate: true } },
    },
  });
  // One entry per apartment the guest slept in, each with its nights' share of the gross, so a guest who moved
  // mid-stay is counted once in total.
  const stays: OccupancyStay[] = bookings.flatMap((b) => {
    const grossCents = incomeFor({
      channel: b.channel,
      status: b.status,
      totalValueCents: b.totalValueCents,
      bookingValueCents: b.totalAmountCents,
      payoutCents: b.payoutAmountCents,
      cleaningFeeCents: b.cleaningFeeCents,
      currency: b.currency,
    }).grossCents;
    const nights = (b.checkoutDate.getTime() - b.checkinDate.getTime()) / 86_400_000;
    return b.assignments.map((a) => ({
      roomId: a.roomId,
      checkin: dbDateToIso(a.startDate),
      checkout: dbDateToIso(a.endDate),
      grossCents:
        nights > 0 ? (grossCents * (a.endDate.getTime() - a.startDate.getTime())) / 86_400_000 / nights : grossCents,
    }));
  });
  const rooms = await listCalendarRooms();
  const compute = (y: number, ids: readonly string[]) => occupancyByRoom(stays, y, ids);
  // Inactive apartments only show when they still had stays in one of the two years.
  const allIds = rooms.map((r) => r.id);
  const used = new Set(
    [...compute(year, allIds), ...compute(year - 1, allIds)]
      .filter((r) => r.months.some((m) => m.nights > 0))
      .map((r) => r.roomId),
  );
  const shown = rooms.filter((r) => r.isActive || used.has(r.id));
  const ids = shown.map((r) => r.id);
  return {
    year,
    apartments: shown.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    thisYear: compute(year, ids),
    lastYear: compute(year - 1, ids),
  };
}
