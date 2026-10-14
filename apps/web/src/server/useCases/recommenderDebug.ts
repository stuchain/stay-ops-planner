import { BookingStatus } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { dbDateToIso, isoToDbDate, todayIso } from "@/server/time";

export type DebugBookingRow = {
  id: string;
  guestName: string | null;
  checkin: string;
  checkout: string;
  partySize: number | null;
  needsApartment: boolean;
};

/**
 * Bookings to pick from: those whose guest name contains `query`, or, with no query, the upcoming
 * ones, the ones that still need an apartment first.
 */
export async function listBookingsForDebug(input: { query?: string; now?: Date }): Promise<DebugBookingRow[]> {
  const query = input.query?.trim() ?? "";
  const today = isoToDbDate(todayIso(input.now));
  const rows = await prisma.booking.findMany({
    where: {
      status: { not: BookingStatus.cancelled },
      ...(query ? { guestName: { contains: query, mode: "insensitive" as const } } : { checkoutDate: { gte: today } }),
    },
    select: {
      id: true,
      guestName: true,
      checkinDate: true,
      checkoutDate: true,
      guestTotal: true,
      guestAdults: true,
      guestChildren: true,
      _count: { select: { assignments: true } },
    },
    orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
    take: 200,
  });
  const mapped = rows.map((r) => ({
    id: r.id,
    guestName: r.guestName,
    checkin: dbDateToIso(r.checkinDate),
    checkout: dbDateToIso(r.checkoutDate),
    partySize: r.guestTotal ?? (r.guestAdults !== null ? r.guestAdults + (r.guestChildren ?? 0) : null),
    needsApartment: r._count.assignments === 0,
  }));
  return query
    ? mapped.slice(0, 30)
    : [...mapped.filter((r) => r.needsApartment), ...mapped.filter((r) => !r.needsApartment)].slice(0, 30);
}
