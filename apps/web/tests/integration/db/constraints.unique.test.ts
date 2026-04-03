/**
 * Requires Postgres with migrations applied (`pnpm --filter @stay-ops/db migrate:deploy`).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma, BookingStatus, Channel } from "@stay-ops/db";

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

describe("db constraints — uniqueness and FK", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateDomain();
  });

  it("rejects duplicate (channel, external_booking_id)", async () => {
    await prisma.booking.create({
      data: {
        channel: Channel.airbnb,
        externalBookingId: "EXT-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    await expect(
      prisma.booking.create({
        data: {
          channel: Channel.airbnb,
          externalBookingId: "EXT-1",
          status: BookingStatus.confirmed,
          checkinDate: new Date("2026-06-01T00:00:00.000Z"),
          checkoutDate: new Date("2026-06-03T00:00:00.000Z"),
          nights: 2,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects assignment with non-existent booking_id", async () => {
    const room = await prisma.room.create({
      data: { code: "R1", displayName: "Room 1" },
    });

    try {
      await prisma.assignment.create({
        data: {
          bookingId: "nonexistent_booking",
          roomId: room.id,
          startDate: new Date("2026-05-01T00:00:00.000Z"),
          endDate: new Date("2026-05-04T00:00:00.000Z"),
        },
      });
      expect.fail("expected FK violation");
    } catch (e) {
      expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((e as Prisma.PrismaClientKnownRequestError).code).toBe("P2003");
    }
  });
});
