/**
 * Requires Postgres with migrations applied (`pnpm --filter @stay-ops/db migrate:deploy`).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  Prisma,
  PrismaClient,
  BookingStatus,
  Channel,
  assertNoOverlap,
  OverlapConflictError,
} from "@stay-ops/db";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

async function truncateDomain() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "import_errors",
      "audit_events",
      "assignments",
      "cleaning_tasks",
      "manual_blocks",
      "bookings",
      "sync_runs",
      "source_listings",
      "rooms"
    RESTART IDENTITY CASCADE;
  `);
}

describe("db constraints — overlap", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateDomain();
  });

  it("rejects two overlapping assignments for the same room (DB exclusion)", async () => {
    const room = await prisma.room.create({ data: { code: "R1" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.airbnb,
        externalBookingId: "B1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.airbnb,
        externalBookingId: "B2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-20T00:00:00.000Z"),
        nights: 10,
      },
    });

    await prisma.assignment.create({
      data: {
        bookingId: b1.id,
        roomId: room.id,
        startDate: new Date("2026-05-01T00:00:00.000Z"),
        endDate: new Date("2026-05-04T00:00:00.000Z"),
      },
    });

    try {
      await prisma.assignment.create({
        data: {
          bookingId: b2.id,
          roomId: room.id,
          startDate: new Date("2026-05-03T00:00:00.000Z"),
          endDate: new Date("2026-05-06T00:00:00.000Z"),
        },
      });
      expect.fail("expected exclusion or constraint violation");
    } catch (e) {
      expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const code = (e as Prisma.PrismaClientKnownRequestError).code;
      expect(["P2010", "P2002"]).toContain(code);
    }
  });

  it("allows adjacent assignments (checkout equals next check-in)", async () => {
    const room = await prisma.room.create({ data: { code: "R1" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.airbnb,
        externalBookingId: "B1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.airbnb,
        externalBookingId: "B2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-04T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-07T00:00:00.000Z"),
        nights: 3,
      },
    });

    await prisma.assignment.create({
      data: {
        bookingId: b1.id,
        roomId: room.id,
        startDate: new Date("2026-05-01T00:00:00.000Z"),
        endDate: new Date("2026-05-04T00:00:00.000Z"),
      },
    });

    await expect(
      prisma.assignment.create({
        data: {
          bookingId: b2.id,
          roomId: room.id,
          startDate: new Date("2026-05-04T00:00:00.000Z"),
          endDate: new Date("2026-05-07T00:00:00.000Z"),
        },
      }),
    ).resolves.toBeDefined();
  });

  it("assertNoOverlap rejects interval overlapping a manual block", async () => {
    const room = await prisma.room.create({ data: { code: "R1" } });
    await prisma.manualBlock.create({
      data: {
        roomId: room.id,
        startDate: new Date("2026-06-10T00:00:00.000Z"),
        endDate: new Date("2026-06-13T00:00:00.000Z"),
        reason: "maintenance",
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await assertNoOverlap(tx, {
          roomId: room.id,
          start: new Date("2026-06-11T00:00:00.000Z"),
          end: new Date("2026-06-12T00:00:00.000Z"),
        });
      }),
    ).rejects.toBeInstanceOf(OverlapConflictError);
  });

  it("assertNoOverlap rejects interval overlapping an assignment", async () => {
    const room = await prisma.room.create({ data: { code: "R1" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "D1",
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
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-05T00:00:00.000Z"),
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await assertNoOverlap(tx, {
          roomId: room.id,
          start: new Date("2026-07-03T00:00:00.000Z"),
          end: new Date("2026-07-04T00:00:00.000Z"),
        });
      }),
    ).rejects.toBeInstanceOf(OverlapConflictError);
  });
});
