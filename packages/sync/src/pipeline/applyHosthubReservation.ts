import type { Prisma } from "@stay-ops/db";
import { PrismaClient } from "@stay-ops/db";
import type { HosthubReservationDto } from "../hosthub/types.dto.js";
import { revalidateAssignmentIfNeeded } from "../allocation/revalidateAssignment.js";
import { mapHosthubBookingStatus } from "./bookingStatus.js";
import { mapHosthubListingChannel } from "./mapChannel.js";
import { nightsBetweenCheckinCheckout, parseDateOnlyUtc } from "./dates.js";

async function upsertListingAndBooking(
  tx: Prisma.TransactionClient,
  dto: HosthubReservationDto,
  rawPayload: Prisma.InputJsonValue,
) {
  const channel = mapHosthubListingChannel(dto.listingChannel);
  const checkinDate = parseDateOnlyUtc(dto.checkIn);
  const checkoutDate = parseDateOnlyUtc(dto.checkOut);
  const nights = nightsBetweenCheckinCheckout(checkinDate, checkoutDate);
  const status = mapHosthubBookingStatus(dto.status);

  const listing = await tx.sourceListing.upsert({
    where: {
      channel_externalListingId: {
        channel,
        externalListingId: dto.listingId,
      },
    },
    create: {
      channel,
      externalListingId: dto.listingId,
      title: null,
    },
    update: {},
  });

  const booking = await tx.booking.upsert({
    where: {
      channel_externalBookingId: {
        channel,
        externalBookingId: dto.reservationId,
      },
    },
    create: {
      sourceListingId: listing.id,
      channel,
      externalBookingId: dto.reservationId,
      status,
      checkinDate,
      checkoutDate,
      nights,
      rawPayload,
    },
    update: {
      sourceListingId: listing.id,
      status,
      checkinDate,
      checkoutDate,
      nights,
      rawPayload,
    },
  });

  await revalidateAssignmentIfNeeded(tx, booking.id);
}

/**
 * Upsert source listing + canonical booking from a normalized Hosthub reservation DTO.
 */
export async function applyHosthubReservation(
  prisma: PrismaClient,
  dto: HosthubReservationDto,
  rawPayload: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await upsertListingAndBooking(tx, dto, rawPayload);
  });
}
