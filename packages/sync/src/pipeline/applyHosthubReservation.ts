import { writeAuditSnapshot } from "@stay-ops/audit";
import type { Prisma } from "@stay-ops/db";
import { BookingStatus, ensureTurnoverCleaningTask, PrismaClient } from "@stay-ops/db";
import type { HosthubReservationDto } from "../hosthub/types.dto.js";
import { applyCancellationSideEffects } from "../allocation/cancellation.js";
import { revalidateAssignmentIfNeeded } from "../allocation/revalidateAssignment.js";
import { mapHosthubBookingStatus } from "./bookingStatus.js";
import { mapHosthubListingChannel } from "./mapChannel.js";
import { nightsBetweenCheckinCheckout, parseDateOnlyUtc } from "./dates.js";

function bookingAuditShape(b: {
  id: string;
  status: string;
  checkinDate: Date;
  checkoutDate: Date;
  nights: number;
  channel: string;
  externalBookingId: string;
}) {
  return {
    id: b.id,
    status: b.status,
    checkinDate: b.checkinDate.toISOString().slice(0, 10),
    checkoutDate: b.checkoutDate.toISOString().slice(0, 10),
    nights: b.nights,
    channel: b.channel,
    externalBookingId: b.externalBookingId,
  };
}

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
  const listingName = dto.listingName?.trim() ? dto.listingName.trim() : null;

  const existingBooking = await tx.booking.findUnique({
    where: {
      channel_externalBookingId: {
        channel,
        externalBookingId: dto.reservationId,
      },
    },
  });

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
      title: listingName,
    },
    update: { title: listingName },
  });

  await tx.room.upsert({
    where: { code: listing.externalListingId },
    create: {
      code: listing.externalListingId,
      displayName: listing.title ?? listing.externalListingId,
      isActive: true,
    },
    update: {
      displayName: listing.title ?? listing.externalListingId,
      isActive: true,
    },
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

  const afterRevalidate = await tx.booking.findUnique({
    where: { id: booking.id },
    include: { assignment: true },
  });
  if (
    afterRevalidate &&
    afterRevalidate.status !== BookingStatus.cancelled &&
    afterRevalidate.assignment
  ) {
    await ensureTurnoverCleaningTask(tx, {
      bookingId: afterRevalidate.id,
      roomId: afterRevalidate.assignment.roomId,
      checkoutDate: afterRevalidate.checkoutDate,
    });
  }

  if (booking.status === BookingStatus.cancelled) {
    await applyCancellationSideEffects(tx, booking.id);
  }

  const finalBooking = await tx.booking.findUnique({ where: { id: booking.id } });
  if (finalBooking) {
    await writeAuditSnapshot(tx, {
      actorUserId: null,
      entityType: "booking",
      entityId: finalBooking.id,
      action: "booking.sync_upsert",
      before: existingBooking ? bookingAuditShape(existingBooking) : null,
      after: bookingAuditShape(finalBooking),
      meta: { bookingId: finalBooking.id, source: "sync" },
    });
  }
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
