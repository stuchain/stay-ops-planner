import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { bookingSliceSelect, toBookingSlice, type BookingSlice } from "./bookingSlice";

export type BookingDetails = BookingSlice & {
  adults: number | null;
  children: number | null;
  infants: number | null;
  totalAmountCents: number | null;
  currency: string | null;
  notes: string | null;
};

/** Everything the booking panel shows besides the apartment buttons. */
export async function getBookingDetails(bookingId: string): Promise<BookingDetails> {
  const row = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { ...bookingSliceSelect, totalAmountCents: true, currency: true, notes: true },
  });
  if (!row) throw new DomainError("NOT_FOUND");
  return {
    ...toBookingSlice(row),
    adults: row.guestAdults,
    children: row.guestChildren,
    infants: row.guestInfants,
    totalAmountCents: row.totalAmountCents,
    currency: row.currency,
    notes: row.notes,
  };
}
