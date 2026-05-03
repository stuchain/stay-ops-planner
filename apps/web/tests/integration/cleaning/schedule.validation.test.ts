/**
 * Cleaning schedule window validation (Phase 5.4).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, CLEANING_WINDOW_INVALID_MESSAGE, validateCleaningSchedule } from "@stay-ops/db";
import { makeAssignment, makeBlock, makeBooking, makeRoom } from "../helpers/cleaningFixtures";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
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
    const room = await makeRoom(prisma, "SV1");
    const b1 = await makeBooking(prisma, {
      externalBookingId: "sv-b1",
      checkinDate: new Date("2026-10-01T00:00:00.000Z"),
      checkoutDate: new Date("2026-10-04T00:00:00.000Z"),
      nights: 3,
    });
    const b2 = await makeBooking(prisma, {
      externalBookingId: "sv-b2",
      checkinDate: new Date("2026-10-10T00:00:00.000Z"),
      checkoutDate: new Date("2026-10-14T00:00:00.000Z"),
      nights: 4,
    });
    await makeAssignment(prisma, {
      bookingId: b1.id,
      roomId: room.id,
      startDate: b1.checkinDate,
      endDate: b1.checkoutDate,
    });
    await makeAssignment(prisma, {
      bookingId: b2.id,
      roomId: room.id,
      startDate: b2.checkinDate,
      endDate: b2.checkoutDate,
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

  it("accepts window starting at checkout calendar day (UTC midnight boundary)", async () => {
    const room = await makeRoom(prisma, "SV-EDGE");
    const checkin = new Date("2026-02-01T00:00:00.000Z");
    const checkout = new Date("2026-02-04T00:00:00.000Z");
    const b1 = await makeBooking(prisma, {
      externalBookingId: "sv-edge-b1",
      checkinDate: checkin,
      checkoutDate: checkout,
      nights: 3,
    });
    await makeAssignment(prisma, {
      bookingId: b1.id,
      roomId: room.id,
      startDate: checkin,
      endDate: checkout,
    });

    await prisma.$transaction((tx) =>
      validateCleaningSchedule(tx, {
        roomId: room.id,
        bookingId: b1.id,
        plannedStart: checkout,
        plannedEnd: new Date(checkout.getTime() + 2 * 60 * 60 * 1000),
      }),
    );
    expect(true).toBe(true);
  });

  it("rejects window before checkout", async () => {
    const room = await makeRoom(prisma, "SV2");
    const b1 = await makeBooking(prisma, {
      externalBookingId: "sv2-b1",
      checkinDate: new Date("2026-11-01T00:00:00.000Z"),
      checkoutDate: new Date("2026-11-05T00:00:00.000Z"),
      nights: 4,
    });
    await makeAssignment(prisma, {
      bookingId: b1.id,
      roomId: room.id,
      startDate: b1.checkinDate,
      endDate: b1.checkoutDate,
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
    ).rejects.toMatchObject({
      name: "CleaningWindowInvalidError",
      message: CLEANING_WINDOW_INVALID_MESSAGE,
    });
  });

  it("rejects window overlapping manual block", async () => {
    const room = await makeRoom(prisma, "SV3");
    const b1 = await makeBooking(prisma, {
      externalBookingId: "sv3-b1",
      checkinDate: new Date("2026-12-01T00:00:00.000Z"),
      checkoutDate: new Date("2026-12-05T00:00:00.000Z"),
      nights: 4,
    });
    await makeAssignment(prisma, {
      bookingId: b1.id,
      roomId: room.id,
      startDate: b1.checkinDate,
      endDate: b1.checkoutDate,
    });
    await makeBlock(prisma, {
      roomId: room.id,
      startDate: new Date("2026-12-05T00:00:00.000Z"),
      endDate: new Date("2026-12-08T00:00:00.000Z"),
      reason: "maint",
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
    ).rejects.toMatchObject({
      name: "CleaningWindowInvalidError",
      message: CLEANING_WINDOW_INVALID_MESSAGE,
    });
  });

  it("rejects schedule when room is inactive", async () => {
    const room = await makeRoom(prisma, "SV-IN", false);
    const b1 = await makeBooking(prisma, {
      externalBookingId: "sv-in-b1",
      checkinDate: new Date("2026-07-01T00:00:00.000Z"),
      checkoutDate: new Date("2026-07-05T00:00:00.000Z"),
      nights: 4,
    });
    await makeAssignment(prisma, {
      bookingId: b1.id,
      roomId: room.id,
      startDate: b1.checkinDate,
      endDate: b1.checkoutDate,
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
