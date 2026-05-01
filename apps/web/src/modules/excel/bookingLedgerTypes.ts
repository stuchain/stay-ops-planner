import type { Prisma } from "@stay-ops/db";

/** Booking row as loaded for tax ledger APIs (listing title + assigned room). */
export type BookingWithLedgerRelations = Prisma.BookingGetPayload<{
  include: {
    sourceListing: { select: { title: true; rentalIndex: true } };
    assignment: { include: { room: { select: { displayName: true } } } };
  };
}>;
