import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";

export async function makeBooking(
  prisma: PrismaClient,
  overrides?: {
    externalBookingId?: string;
    checkinDate?: Date;
    checkoutDate?: Date;
    status?: BookingStatus;
    channel?: Channel;
    nights?: number;
  },
) {
  const checkinDate = overrides?.checkinDate ?? new Date("2026-01-01T00:00:00.000Z");
  const checkoutDate = overrides?.checkoutDate ?? new Date("2026-01-05T00:00:00.000Z");
  const msPerDay = 86_400_000;
  const nights =
    overrides?.nights ??
    Math.max(1, Math.round((checkoutDate.getTime() - checkinDate.getTime()) / msPerDay));
  return prisma.booking.create({
    data: {
      channel: overrides?.channel ?? Channel.direct,
      externalBookingId: overrides?.externalBookingId ?? `bk-${crypto.randomUUID().slice(0, 8)}`,
      status: overrides?.status ?? BookingStatus.confirmed,
      checkinDate,
      checkoutDate,
      nights,
    },
  });
}

export async function makeRoom(prisma: PrismaClient, code?: string, isActive = true) {
  return prisma.room.create({
    data: { code: code ?? `R-${crypto.randomUUID().slice(0, 8)}`, isActive },
  });
}

export async function makeAssignment(
  prisma: PrismaClient,
  params: { bookingId: string; roomId: string; startDate: Date; endDate: Date },
) {
  return prisma.assignment.create({
    data: {
      bookingId: params.bookingId,
      roomId: params.roomId,
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
}

export async function makeBlock(
  prisma: PrismaClient,
  params: { roomId: string; startDate: Date; endDate: Date; reason?: string | null },
) {
  return prisma.manualBlock.create({
    data: {
      roomId: params.roomId,
      startDate: params.startDate,
      endDate: params.endDate,
      reason: params.reason ?? null,
    },
  });
}
