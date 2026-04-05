/**
 * Cleaning schedule window validation (Phase 5.4).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  PrismaClient,
  BookingStatus,
  Channel,
  CLEANING_WINDOW_INVALID_MESSAGE,
  CleaningWindowInvalidError,
  validateCleaningSchedule,
} from "@stay-ops/db";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_events",
      "assignments",
      "cleaning_tasks",
      "manual_blocks",
      "bookings",
      "source_listings",
      "rooms",
      "users"
    RESTART IDENTITY CASCADE;
  `);
}

describe("cleaning — schedule validation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
  });

  it("accepts a window after checkout and before next assignment", async () => {
    const room = await prisma.room.create({ data: { code: "SV1" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sv-b1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-10-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sv-b2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-10-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-14T00:00:00.000Z"),
        nights: 4,
      },
    });
    await prisma.assignment.create({
      data: {
        bookingId: b1.id,
        roomId: room.id,
        startDate: b1.checkinDate,
        endDate: b1.checkoutDate,
      },
    });
    await prisma.assignment.create({
      data: {
        bookingId: b2.id,
        roomId: room.id,
        startDate: b2.checkinDate,
        endDate: b2.checkoutDate,
      },
    });

    const start = new Date("2026-10-04T12:00:00.000Z");
    const end = new Date("2026-10-04T14:00:00.000Z");

    await prisma.$transaction((tx) =>
      validateCleaningSchedule(tx, {
        roomId: room.id,
        bookingId: b1.id,
        plannedStart: start,
        plannedEnd: end,
      }),
    );
    expect(true).toBe(true);
  });

  it("rejects window before checkout", async () => {
    const room = await prisma.room.create({ data: { code: "SV2" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sv2-b1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-11-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-11-05T00:00:00.000Z"),
        nights: 4,
      },
    });
    await prisma.assignment.create({
      data: {
        bookingId: b1.id,
        roomId: room.id,
        startDate: b1.checkinDate,
        endDate: b1.checkoutDate,
      },
    });

    await expect(
      prisma.$transaction((tx) =>
        validateCleaningSchedule(tx, {
          roomId: room.id,
          bookingId: b1.id,
          plannedStart: new Date("2026-11-04T12:00:00.000Z"),
          plannedEnd: new Date("2026-11-04T14:00:00.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(CleaningWindowInvalidError);
  });

  it("rejects window overlapping manual block", async () => {
    const room = await prisma.room.create({ data: { code: "SV3" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sv3-b1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-05T00:00:00.000Z"),
        nights: 4,
      },
    });
    await prisma.assignment.create({
      data: {
        bookingId: b1.id,
        roomId: room.id,
        startDate: b1.checkinDate,
        endDate: b1.checkoutDate,
      },
    });
    await prisma.manualBlock.create({
      data: {
        roomId: room.id,
        startDate: new Date("2026-12-05T00:00:00.000Z"),
        endDate: new Date("2026-12-08T00:00:00.000Z"),
        reason: "maint",
      },
    });

    await expect(
      prisma.$transaction((tx) =>
        validateCleaningSchedule(tx, {
          roomId: room.id,
          bookingId: b1.id,
          plannedStart: new Date("2026-12-06T10:00:00.000Z"),
          plannedEnd: new Date("2026-12-06T12:00:00.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(CleaningWindowInvalidError);
  });

  it("rejects schedule when room is inactive", async () => {
    const room = await prisma.room.create({ data: { code: "SV-IN", isActive: false } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sv-in-b1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-05T00:00:00.000Z"),
        nights: 4,
      },
    });
    await prisma.assignment.create({
      data: {
        bookingId: b1.id,
        roomId: room.id,
        startDate: b1.checkinDate,
        endDate: b1.checkoutDate,
      },
    });

    await expect(
      prisma.$transaction((tx) =>
        validateCleaningSchedule(tx, {
          roomId: room.id,
          bookingId: b1.id,
          plannedStart: new Date("2026-07-05T10:00:00.000Z"),
          plannedEnd: new Date("2026-07-05T12:00:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({
      name: "CleaningWindowInvalidError",
      message: CLEANING_WINDOW_INVALID_MESSAGE,
    });
  });
});
