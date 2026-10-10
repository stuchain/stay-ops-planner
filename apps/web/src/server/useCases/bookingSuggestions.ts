import {
  addDays,
  DomainError,
  rankRoomsDetailed,
  type Occupant,
  type RankedRoomDetail,
  type RecommenderConfig,
  type RuleContribution,
} from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso, isoToDbDate } from "@/server/time";
import { partyOf } from "./bookingSlice";
import { listCalendarRooms } from "./calendarRange";
import { loadRecommenderConfig } from "./recommenderConfig";

export type Suggestion = Omit<RankedRoomDetail, "contributions"> & {
  /** Guest in the way, for "Κλεισμένο: Νίκος Π.". */
  blockedByGuest: string | null;
};

/**
 * Every apartment for one booking, best first, with the reasons. Uses the whole stay
 * (never clipped to a month) and the nights either side of it for the single-night-gap rule.
 */
export async function bookingSuggestions(bookingId: string): Promise<Suggestion[]> {
  const ranked = await rankBooking(bookingId);
  return ranked.map((r) => {
    const { contributions, ...suggestion } = r;
    void contributions;
    return suggestion;
  });
}

export type DebugSuggestion = Suggestion & { contributions: readonly RuleContribution[] };

/**
 * The same ranking with what every rule contributed (Dev mode). `config` is a draft to try
 * out; without it the saved rules are used, as in `bookingSuggestions`.
 */
export async function rankBooking(bookingId: string, config?: RecommenderConfig): Promise<DebugSuggestion[]> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      checkinDate: true,
      checkoutDate: true,
      guestTotal: true,
      guestAdults: true,
      guestChildren: true,
      guestInfants: true,
    },
  });
  if (!booking) throw new DomainError("NOT_FOUND");
  const stay = { checkin: dbDateToIso(booking.checkinDate), checkout: dbDateToIso(booking.checkoutDate) };
  const windowStart = isoToDbDate(addDays(stay.checkin, -1));
  const windowEnd = isoToDbDate(addDays(stay.checkout, 1));

  const [rooms, assignments, blocks] = await Promise.all([
    listCalendarRooms(),
    prisma.assignment.findMany({
      where: { startDate: { lt: windowEnd }, endDate: { gt: windowStart } },
      select: {
        roomId: true,
        bookingId: true,
        startDate: true,
        endDate: true,
        booking: { select: { guestName: true } },
      },
    }),
    prisma.manualBlock.findMany({
      where: { startDate: { lt: windowEnd }, endDate: { gt: windowStart } },
      select: { id: true, roomId: true, startDate: true, endDate: true, reason: true },
    }),
  ]);

  const timelines = new Map<string, Occupant[]>();
  const add = (roomId: string, occupant: Occupant) =>
    timelines.set(roomId, [...(timelines.get(roomId) ?? []), occupant]);
  for (const a of assignments) {
    add(a.roomId, {
      kind: "booking",
      id: a.bookingId,
      stay: { checkin: dbDateToIso(a.startDate), checkout: dbDateToIso(a.endDate) },
      guestName: a.booking.guestName ?? undefined,
    });
  }
  for (const b of blocks) {
    add(b.roomId, {
      kind: "block",
      id: b.id,
      stay: { checkin: dbDateToIso(b.startDate), checkout: dbDateToIso(b.endDate) },
      reason: b.reason ?? undefined,
    });
  }

  const rules = config ?? (await loadRecommenderConfig());
  const ranked = rankRoomsDetailed(
    { id: booking.id, stay, party: partyOf(booking) },
    rooms.map((r, index) => ({
      id: r.id,
      sortOrder: index,
      capacity: r.capacity,
      preferredForLargeParty: r.preferredForLargeParty,
      isActive: r.isActive,
    })),
    timelines,
    rules,
  );
  return ranked.map((r) => ({
    ...r,
    blockedByGuest: r.blockedBy?.kind === "booking" ? (r.blockedBy.guestName ?? null) : null,
  }));
}
