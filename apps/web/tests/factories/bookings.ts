import type { PrismaClient, Prisma } from "@stay-ops/db";
import { dateOnly, nightsBetween, uniqueSuffix } from "./ids";
import { createAssignment } from "./assignments";

/** Dates are `YYYY-MM-DD` strings; `nights` is derived unless given. */
export type BookingOverrides = Omit<
  Partial<Prisma.BookingUncheckedCreateInput>,
  "checkinDate" | "checkoutDate"
> & {
  checkinDate?: string;
  checkoutDate?: string;
};

export async function createBooking(prisma: PrismaClient, overrides: BookingOverrides = {}) {
  const { checkinDate = "2030-06-01", checkoutDate = "2030-06-04", ...rest } = overrides;
  return prisma.booking.create({
    data: {
      channel: "direct",
      externalBookingId: `ext-${uniqueSuffix()}`,
      status: "confirmed",
      guestName: "Test Guest",
      nights: nightsBetween(checkinDate, checkoutDate),
      ...rest,
      checkinDate: dateOnly(checkinDate),
      checkoutDate: dateOnly(checkoutDate),
    },
  });
}

/** Creates a booking and an assignment for it in `roomId` covering the booking's stay. */
export async function createPlacedBooking(
  prisma: PrismaClient,
  roomId: string,
  overrides: BookingOverrides = {},
) {
  const booking = await createBooking(prisma, overrides);
  const assignment = await createAssignment(prisma, {
    bookingId: booking.id,
    roomId,
    startDate: booking.checkinDate,
    endDate: booking.checkoutDate,
  });
  return { booking, assignment };
}
