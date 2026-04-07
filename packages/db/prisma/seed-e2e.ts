/**
 * Idempotent fixtures for Playwright E2E (Phase 6.8).
 * Run after normal seed so BOOTSTRAP_ADMIN_* user exists.
 *
 *   pnpm --filter @stay-ops/db seed:e2e
 */
import { PrismaClient, BookingStatus, Channel } from "@prisma/client";

const prisma = new PrismaClient();

const E2E_EXTERNAL = {
  unassigned: "e2e-seed-unassign",
  alpha: "e2e-seed-alpha",
  bravo: "e2e-seed-bravo",
  delta: "e2e-seed-delta",
} as const;

async function wipeE2eBookings() {
  for (const externalBookingId of Object.values(E2E_EXTERNAL)) {
    await prisma.booking.deleteMany({
      where: { channel: Channel.direct, externalBookingId },
    });
  }
}

async function wipeE2eBlocksAndRooms() {
  // When rerunning E2E locally, previous test runs may have created tasks/assignments
  // that reference the E2E rooms. Clean those up before deleting rooms.
  const roomIds = (
    await prisma.room.findMany({
      where: { code: { in: ["E2E-A", "E2E-B"] } },
      select: { id: true },
    })
  ).map((r) => r.id);

  if (roomIds.length > 0) {
    await prisma.cleaningTask.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.assignment.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.manualBlock.deleteMany({ where: { roomId: { in: roomIds } } });
  }

  await prisma.manualBlock.deleteMany({
    where: { reason: "e2e-seed-overlap-block" },
  });
  await prisma.room.deleteMany({
    where: { code: { in: ["E2E-A", "E2E-B"] } },
  });
}

function utcYmd(y: number, monthIndex0: number, day: number): Date {
  return new Date(Date.UTC(y, monthIndex0, day, 0, 0, 0, 0));
}

async function main() {
  /** Match `CalendarClient` default month (local), not UTC, so cards appear in the loaded month. */
  const now = new Date();
  const y = now.getFullYear();
  const m0 = now.getMonth();
  const ym = `${y}-${String(m0 + 1).padStart(2, "0")}`;

  await wipeE2eBookings();
  await wipeE2eBlocksAndRooms();

  const rA = await prisma.room.create({
    data: { code: "E2E-A", displayName: "E2E Room A", isActive: true },
  });
  const rB = await prisma.room.create({
    data: { code: "E2E-B", displayName: "E2E Room B", isActive: true },
  });

  const earlyStart = utcYmd(y, m0, 5);
  const earlyEnd = utcYmd(y, m0, 9);
  const midStart = utcYmd(y, m0, 15);
  const midEnd = utcYmd(y, m0, 19);

  const nightsEarly = Math.max(1, Math.round((earlyEnd.getTime() - earlyStart.getTime()) / 86_400_000));
  const nightsMid = Math.max(1, Math.round((midEnd.getTime() - midStart.getTime()) / 86_400_000));

  const bAlpha = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: E2E_EXTERNAL.alpha,
      status: BookingStatus.confirmed,
      checkinDate: earlyStart,
      checkoutDate: earlyEnd,
      nights: nightsEarly,
      rawPayload: { guest: "E2E Alpha" },
    },
  });

  const bBravo = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: E2E_EXTERNAL.bravo,
      status: BookingStatus.confirmed,
      checkinDate: midStart,
      checkoutDate: midEnd,
      nights: nightsMid,
      rawPayload: { guest: "E2E Bravo" },
    },
  });

  const bUnassign = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: E2E_EXTERNAL.unassigned,
      status: BookingStatus.confirmed,
      checkinDate: midStart,
      checkoutDate: midEnd,
      nights: nightsMid,
      rawPayload: { guest: "E2E Unassigned" },
    },
  });

  const bDelta = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: E2E_EXTERNAL.delta,
      status: BookingStatus.confirmed,
      checkinDate: midStart,
      checkoutDate: midEnd,
      nights: nightsMid,
      rawPayload: { guest: "E2E Delta" },
    },
  });

  await prisma.assignment.create({
    data: {
      bookingId: bAlpha.id,
      roomId: rA.id,
      startDate: earlyStart,
      endDate: earlyEnd,
    },
  });

  await prisma.assignment.create({
    data: {
      bookingId: bBravo.id,
      roomId: rB.id,
      startDate: midStart,
      endDate: midEnd,
    },
  });

  const blockStart = utcYmd(y, m0, 10);
  const blockEnd = utcYmd(y, m0, 13);
  await prisma.manualBlock.create({
    data: {
      roomId: rA.id,
      startDate: blockStart,
      endDate: blockEnd,
      reason: "e2e-seed-overlap-block",
    },
  });

  const cleanStart = utcYmd(y, m0, 20);
  const cleanEnd = new Date(cleanStart.getTime() + 2 * 60 * 60 * 1000);
  await prisma.cleaningTask.create({
    data: {
      bookingId: bUnassign.id,
      roomId: rB.id,
      status: "todo",
      taskType: "turnover",
      sourceEventId: `e2e-clean-${ym}`,
      plannedStart: cleanStart,
      plannedEnd: cleanEnd,
      durationMinutes: 120,
    },
  });

  const clean2Start = utcYmd(y, m0, 22);
  const clean2End = new Date(clean2Start.getTime() + 2 * 60 * 60 * 1000);
  await prisma.cleaningTask.create({
    data: {
      bookingId: bDelta.id,
      roomId: rB.id,
      status: "todo",
      taskType: "turnover",
      sourceEventId: `e2e-clean-delta-${ym}`,
      plannedStart: clean2Start,
      plannedEnd: clean2End,
      durationMinutes: 120,
    },
  });

  console.log(`seed-e2e: upserted rooms + bookings for calendar month ${ym}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
