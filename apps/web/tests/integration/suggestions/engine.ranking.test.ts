import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { SUGGESTION_ENGINE_VERSION, rankBookingSuggestions } from "@/modules/suggestions/engine";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

async function truncate(prisma: PrismaClient) {
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

describe("suggestion engine ranking determinism", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
  });

  it("pins engine version and keeps ranking stable for same inputs", async () => {
    expect(SUGGESTION_ENGINE_VERSION).toBe(1);

    const roomA = await prisma.room.create({ data: { code: "A1" } });
    const roomB = await prisma.room.create({ data: { code: "B1" } });
    const roomC = await prisma.room.create({ data: { code: "C1" } });

    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sg-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-10-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-12T00:00:00.000Z"),
        nights: 2,
      },
    });

    await prisma.assignment.create({
      data: {
        bookingId: (
          await prisma.booking.create({
            data: {
              channel: Channel.direct,
              externalBookingId: "existing-overlap",
              status: BookingStatus.confirmed,
              checkinDate: new Date("2026-10-10T00:00:00.000Z"),
              checkoutDate: new Date("2026-10-11T00:00:00.000Z"),
              nights: 1,
            },
          })
        ).id,
        roomId: roomB.id,
        startDate: new Date("2026-10-10T00:00:00.000Z"),
        endDate: new Date("2026-10-11T00:00:00.000Z"),
      },
    });

    await prisma.assignment.create({
      data: {
        bookingId: (
          await prisma.booking.create({
            data: {
              channel: Channel.direct,
              externalBookingId: "tight-cleaning",
              status: BookingStatus.confirmed,
              checkinDate: new Date("2026-10-09T00:00:00.000Z"),
              checkoutDate: new Date("2026-10-10T00:00:00.000Z"),
              nights: 1,
            },
          })
        ).id,
        roomId: roomC.id,
        startDate: new Date("2026-10-09T00:00:00.000Z"),
        endDate: new Date("2026-10-10T00:00:00.000Z"),
      },
    });

    const first = await rankBookingSuggestions(booking.id);
    const second = await rankBookingSuggestions(booking.id);

    expect(first).toEqual(second);
    expect(first.map((row) => row.roomId)).toEqual([roomA.id, roomC.id, roomB.id]);
    expect(first.map((row) => row.score)).toEqual([90, 60, 30]);
    expect(first[0]?.breakdown).toEqual({ availability: 60, cleaningFit: 30, tieBreaker: 0 });
    expect(first[0]?.reasonCodes).toContain("ROOM_AVAILABLE");
    expect(first[0]?.reasonCodes).toContain("CLEANING_WINDOW_FITS");
  });

  it("uses deterministic tie-break ordering when score ties", async () => {
    const roomA = await prisma.room.create({ data: { code: "A1" } });
    const roomB = await prisma.room.create({ data: { code: "B1" } });

    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sg-tie",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-20T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-22T00:00:00.000Z"),
        nights: 2,
      },
    });

    await prisma.manualBlock.create({
      data: {
        roomId: roomA.id,
        startDate: new Date("2026-12-19T00:00:00.000Z"),
        endDate: new Date("2026-12-21T00:00:00.000Z"),
      },
    });
    await prisma.manualBlock.create({
      data: {
        roomId: roomB.id,
        startDate: new Date("2026-12-19T00:00:00.000Z"),
        endDate: new Date("2026-12-21T00:00:00.000Z"),
      },
    });

    const ranked = await rankBookingSuggestions(booking.id);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBe(ranked[1].score);
    expect(ranked[0].roomId).toBe(roomA.id);
    expect(ranked[1].roomId).toBe(roomB.id);
  });
});
