/**
 * Service cleaning generation (Phase 5.2).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, BookingStatus, Channel, SERVICE_MINUTES, createServiceCleaningTask } from "@stay-ops/db";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

function suffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

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

describe("cleaning — service task generation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
  });

  it("creates service task with 60-minute window and dedupes on sourceEventId", async () => {
    const s = suffix();
    const room = await prisma.room.create({ data: { code: `SVC-${s}` } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `svc-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-05T00:00:00.000Z"),
        nights: 4,
      },
    });

    const sid = `svc-op:${booking.id}:1`;

    const a = await prisma.$transaction((tx) =>
      createServiceCleaningTask(tx, {
        bookingId: booking.id,
        roomId: room.id,
        sourceEventId: sid,
      }),
    );
    expect(a.created).toBe(true);

    const b = await prisma.$transaction((tx) =>
      createServiceCleaningTask(tx, {
        bookingId: booking.id,
        roomId: room.id,
        sourceEventId: sid,
      }),
    );
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);

    const row = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.taskType).toBe("service");
    expect(row.durationMinutes).toBe(SERVICE_MINUTES);
    const deltaMs = row.plannedEnd!.getTime() - row.plannedStart!.getTime();
    expect(deltaMs).toBe(SERVICE_MINUTES * 60_000);
  });
});
