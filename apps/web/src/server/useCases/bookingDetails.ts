import { DomainError, incomeFor, type IncomeKind } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { editSelect, localEdits, type EditableField } from "./bookingEdit";
import { bookingSliceSelect, toBookingSlice, type BookingSlice } from "./bookingSlice";

/** The money of a booking in plain words, from the synced columns. Null when Hosthub sent none. */
export type BookingPrice = {
  kind: IncomeKind;
  /** What the guest pays (Σύνολο). */
  totalCents: number;
  /** What reaches the owner (Καθαρά για εσάς). */
  netCents: number;
  /** The platform's cut, when both figures are known. */
  channelFeeCents: number | null;
  cleaningFeeCents: number | null;
  taxCents: number | null;
  guestPaidCents: number | null;
  /** True when the amounts are not in euros. */
  foreignCurrency: boolean;
  currency: string | null;
};

export type BookingDetails = BookingSlice & {
  adults: number | null;
  children: number | null;
  infants: number | null;
  notes: string | null;
  price: BookingPrice | null;
  /** For each field the person changed: what Hosthub says. Null when the field is not changed. */
  local: Record<EditableField, { hosthub: string | number | null } | null>;
};

/** Everything the booking panel shows besides the apartment buttons. */
export async function getBookingDetails(bookingId: string): Promise<BookingDetails> {
  const row = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      ...bookingSliceSelect,
      ...editSelect,
      totalAmountCents: true,
      totalValueCents: true,
      payoutAmountCents: true,
      cleaningFeeCents: true,
      taxCents: true,
      guestPaidCents: true,
      currency: true,
    },
  });
  if (!row) throw new DomainError("NOT_FOUND");
  const hasMoney = [row.totalAmountCents, row.totalValueCents, row.payoutAmountCents].some((v) => v != null);
  const income = incomeFor({
    channel: row.channel,
    status: row.status,
    totalValueCents: row.totalValueCents,
    bookingValueCents: row.totalAmountCents,
    payoutCents: row.payoutAmountCents,
    cleaningFeeCents: row.cleaningFeeCents,
    currency: row.currency,
  });
  return {
    ...toBookingSlice(row),
    adults: row.guestAdults,
    children: row.guestChildren,
    infants: row.guestInfants,
    notes: row.notes,
    price: hasMoney
      ? {
          kind: income.kind,
          totalCents: income.grossCents,
          netCents: income.payoutCents,
          channelFeeCents: income.channelFeeCents,
          cleaningFeeCents: income.cleaningFeeCents,
          taxCents: row.taxCents,
          guestPaidCents: row.guestPaidCents,
          foreignCurrency: income.foreignCurrency,
          currency: row.currency,
        }
      : null,
    local: localEdits(row),
  };
}
