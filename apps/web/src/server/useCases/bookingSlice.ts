import type { BookingStatus, Channel, Prisma } from "@stay-ops/db";
import type { IsoDate, Party, StayPiece } from "@stay-ops/domain";
import { dbDateToIso } from "@/server/time";
import { piecesArgs, toPieces } from "./stayPieces";

/** The few booking fields the calendar needs, in one shape for the range query and the move result. */
export type BookingSlice = {
  id: string;
  checkin: IsoDate;
  checkout: IsoDate;
  nights: number;
  guestName: string | null;
  /** Adults + children (infants do not count); null when Hosthub did not say. */
  partySize: number | null;
  channel: Channel;
  status: BookingStatus;
  /** Send back as `expectedVersion` when moving; it changes with every move. */
  version: number;
  /** The apartment the guest arrives in, or null when the booking has none yet. */
  assignment: { roomId: string; pinned: boolean } | null;
  /** Every apartment of the stay in date order; more than one when the guest moved mid-stay. Empty when unplaced. */
  pieces: StayPiece[];
};

export const bookingSliceSelect = {
  id: true,
  checkinDate: true,
  checkoutDate: true,
  guestName: true,
  guestTotal: true,
  guestAdults: true,
  guestChildren: true,
  guestInfants: true,
  channel: true,
  status: true,
  version: true,
  assignments: piecesArgs,
} satisfies Prisma.BookingSelect;

export type BookingSliceRow = Prisma.BookingGetPayload<{ select: typeof bookingSliceSelect }>;

/** Who is coming, from the guest counts Hosthub sent. Null when unknown. */
export function partyOf(
  row: Pick<BookingSliceRow, "guestTotal" | "guestAdults" | "guestChildren" | "guestInfants">,
): Party | null {
  const adults = row.guestAdults ?? 0;
  const children = row.guestChildren ?? 0;
  const infants = row.guestInfants ?? 0;
  if (adults + children > 0) return { adults, children, infants };
  if (row.guestTotal != null && row.guestTotal > infants)
    return { adults: row.guestTotal - infants, children: 0, infants };
  return null;
}

export function toBookingSlice(row: BookingSliceRow): BookingSlice {
  const checkin = dbDateToIso(row.checkinDate);
  const checkout = dbDateToIso(row.checkoutDate);
  const party = partyOf(row);
  const first = row.assignments[0];
  return {
    id: row.id,
    checkin,
    checkout,
    nights: Math.round((row.checkoutDate.getTime() - row.checkinDate.getTime()) / 86_400_000),
    guestName: row.guestName,
    partySize: party === null ? null : party.adults + party.children,
    channel: row.channel,
    status: row.status,
    version: row.version,
    assignment: first ? { roomId: first.roomId, pinned: row.assignments.some((a) => a.pinned) } : null,
    pieces: toPieces(row.assignments),
  };
}
