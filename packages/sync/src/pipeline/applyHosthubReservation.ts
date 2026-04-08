import { writeAuditSnapshot } from "@stay-ops/audit";
import type { Prisma } from "@stay-ops/db";
import { BookingStatus, ensureTurnoverCleaningTask, PrismaClient } from "@stay-ops/db";
import type { HosthubReservationDto } from "../hosthub/types.dto.js";
import { applyCancellationSideEffects } from "../allocation/cancellation.js";
import { revalidateAssignmentIfNeeded } from "../allocation/revalidateAssignment.js";
import { mapHosthubBookingStatus } from "./bookingStatus.js";
import { mapHosthubListingChannel } from "./mapChannel.js";
import { nightsBetweenCheckinCheckout, parseDateOnlyUtc } from "./dates.js";

type Dict = Record<string, unknown>;

function asObject(value: unknown): Dict | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Dict;
  return null;
}

function toJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function pickCalendarEventRaw(rawPayload: Prisma.InputJsonValue): Prisma.InputJsonValue | null {
  const root = asObject(rawPayload as unknown);
  if (!root) return null;
  const type = root.type;
  if (typeof type === "string") return toJson(root);
  for (const key of ["calendar_event", "calendarEvent", "reservation", "data", "payload", "body"] as const) {
    const nested = asObject(root[key]);
    if (nested && typeof nested.type === "string") {
      return toJson(nested);
    }
  }
  return toJson(root);
}

function centsToAmount(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

function bookingAuditShape(b: {
  id: string;
  status: string;
  checkinDate: Date;
  checkoutDate: Date;
  nights: number;
  channel: string;
  externalBookingId: string;
  guestName?: string | null;
  totalAmountCents?: number | null;
}) {
  return {
    id: b.id,
    status: b.status,
    checkinDate: b.checkinDate.toISOString().slice(0, 10),
    checkoutDate: b.checkoutDate.toISOString().slice(0, 10),
    nights: b.nights,
    channel: b.channel,
    externalBookingId: b.externalBookingId,
    guestName: b.guestName ?? null,
    totalAmount: centsToAmount(b.totalAmountCents ?? null),
  };
}

async function upsertListingAndBooking(
  tx: Prisma.TransactionClient,
  dto: HosthubReservationDto,
  rawPayload: Prisma.InputJsonValue,
  extra?: {
    hosthubNotesRaw?: Prisma.InputJsonValue | null;
    hosthubGrTaxesRaw?: Prisma.InputJsonValue | null;
  },
) {
  const channel = mapHosthubListingChannel(dto.listingChannel);
  const checkinDate = parseDateOnlyUtc(dto.checkIn);
  const checkoutDate = parseDateOnlyUtc(dto.checkOut);
  const nights = nightsBetweenCheckinCheckout(checkinDate, checkoutDate);
  const status = mapHosthubBookingStatus(dto.status);
  const listingName = dto.listingName?.trim() ? dto.listingName.trim() : null;
  const calendarEventRaw = pickCalendarEventRaw(rawPayload);

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
      guestName: dto.guestName ?? null,
      guestEmail: dto.guestEmail ?? null,
      guestPhone: dto.guestPhone ?? null,
      guestAdults: dto.guestAdults ?? null,
      guestChildren: dto.guestChildren ?? null,
      guestInfants: dto.guestInfants ?? null,
      guestTotal: dto.guestTotal ?? null,
      totalAmountCents: dto.totalAmountCents ?? null,
      currency: dto.currency ?? null,
      cleaningFeeCents: dto.cleaningFeeCents ?? null,
      taxCents: dto.taxCents ?? null,
      payoutAmountCents: dto.payoutAmountCents ?? null,
      guestPaidCents: dto.guestPaidCents ?? null,
      action: dto.action ?? null,
      notes: dto.notes ?? null,
      ...(calendarEventRaw !== null ? { hosthubCalendarEventRaw: calendarEventRaw } : {}),
      ...(extra?.hosthubNotesRaw !== undefined && extra.hosthubNotesRaw !== null
        ? { hosthubNotesRaw: extra.hosthubNotesRaw }
        : {}),
      ...(extra?.hosthubGrTaxesRaw !== undefined && extra.hosthubGrTaxesRaw !== null
        ? { hosthubGrTaxesRaw: extra.hosthubGrTaxesRaw }
        : {}),
      rawPayload,
    },
    update: {
      sourceListingId: listing.id,
      status,
      checkinDate,
      checkoutDate,
      nights,
      guestName: dto.guestName ?? null,
      guestEmail: dto.guestEmail ?? null,
      guestPhone: dto.guestPhone ?? null,
      guestAdults: dto.guestAdults ?? null,
      guestChildren: dto.guestChildren ?? null,
      guestInfants: dto.guestInfants ?? null,
      guestTotal: dto.guestTotal ?? null,
      totalAmountCents: dto.totalAmountCents ?? null,
      currency: dto.currency ?? null,
      cleaningFeeCents: dto.cleaningFeeCents ?? null,
      taxCents: dto.taxCents ?? null,
      payoutAmountCents: dto.payoutAmountCents ?? null,
      guestPaidCents: dto.guestPaidCents ?? null,
      action: dto.action ?? null,
      notes: dto.notes ?? null,
      ...(calendarEventRaw !== null ? { hosthubCalendarEventRaw: calendarEventRaw } : {}),
      ...(extra?.hosthubNotesRaw !== undefined && extra.hosthubNotesRaw !== null
        ? { hosthubNotesRaw: extra.hosthubNotesRaw }
        : {}),
      ...(extra?.hosthubGrTaxesRaw !== undefined && extra.hosthubGrTaxesRaw !== null
        ? { hosthubGrTaxesRaw: extra.hosthubGrTaxesRaw }
        : {}),
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
  extra?: {
    hosthubNotesRaw?: Prisma.InputJsonValue | null;
    hosthubGrTaxesRaw?: Prisma.InputJsonValue | null;
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await upsertListingAndBooking(tx, dto, rawPayload, extra);
  });
}
