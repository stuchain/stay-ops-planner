import { addDays, rankRoomsDetailed, type IsoDate, type ReasonCode } from "@stay-ops/domain";
import { BookingStatus } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { isoToDbDate } from "@/server/time";
import { listCalendarRooms } from "./calendarRange";
import { loadRecommenderConfig } from "./recommenderConfig";
import { loadTimelines } from "./roomTimelines";

export type AvailabilityRoom = {
  roomId: string;
  name: string;
  color: string | null;
  capacity: number | null;
  isActive: boolean;
  available: boolean;
  recommended: boolean;
  reasons: ReasonCode[];
  warnings: "OVER_CAPACITY"[];
  /** Guest in the way, for "Κλεισμένο: Νίκος Π.". */
  blockedByGuest: string | null;
};

export type AvailabilityResult = {
  checkin: IsoDate;
  checkout: IsoDate;
  guests: number | null;
  /** Best first: free apartments (recommended one first), then the busy ones. */
  rooms: AvailabilityRoom[];
  /**
   * Confirmed bookings overlapping these dates that have no apartment yet. They do not occupy
   * anything here, so "free" may be optimistic.
   */
  unassignedBookings: number;
};

/**
 * Which apartments are free for a phone enquiry. Read-only: ranks a pretend booking with the
 * saved recommender rules, against assignments and closed periods only.
 */
export async function checkAvailability(
  checkin: IsoDate,
  checkout: IsoDate,
  guests: number | null,
): Promise<AvailabilityResult> {
  const windowStart = isoToDbDate(addDays(checkin, -1));
  const windowEnd = isoToDbDate(addDays(checkout, 1));
  const [rooms, timelines, config, unassignedBookings] = await Promise.all([
    listCalendarRooms(),
    loadTimelines(windowStart, windowEnd),
    loadRecommenderConfig(),
    prisma.booking.count({
      where: {
        status: { in: [BookingStatus.confirmed, BookingStatus.needs_reassignment] },
        assignment: null,
        checkinDate: { lt: isoToDbDate(checkout) },
        checkoutDate: { gt: isoToDbDate(checkin) },
      },
    }),
  ]);
  const ranked = rankRoomsDetailed(
    {
      id: "enquiry",
      stay: { checkin, checkout },
      party: guests === null ? null : { adults: guests, children: 0, infants: 0 },
    },
    rooms.map((r, index) => ({
      id: r.id,
      sortOrder: index,
      capacity: r.capacity,
      preferredForLargeParty: r.preferredForLargeParty,
      isActive: r.isActive,
    })),
    timelines,
    config,
  );
  const byId = new Map(rooms.map((r) => [r.id, r]));
  return {
    checkin,
    checkout,
    guests,
    unassignedBookings,
    rooms: ranked.flatMap((r) => {
      const room = byId.get(r.roomId);
      if (!room) return [];
      return [
        {
          roomId: r.roomId,
          name: room.name,
          color: room.color,
          capacity: room.capacity,
          isActive: room.isActive,
          available: r.available,
          recommended: r.recommended,
          reasons: [...r.reasons],
          warnings: [...r.warnings],
          blockedByGuest: r.blockedBy?.kind === "booking" ? (r.blockedBy.guestName ?? null) : null,
        },
      ];
    }),
  };
}
