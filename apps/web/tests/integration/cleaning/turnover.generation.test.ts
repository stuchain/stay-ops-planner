/**
 * Turnover cleaning generation at assign (Phase 5.1).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, BookingStatus, Channel, TURNOVER_MINUTES, turnoverSourceEventId } from "@stay-ops/db";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

function suffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

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

describe("cleaning — turnover generation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
  });

  it("creates a 120-minute turnover task on assign and upserts idempotently", async () => {
    const { assignBookingToRoom } = await import("../../../src/modules/allocation/service");
    const s = suffix();
    const actor = await prisma.user.create({
      data: { email: `cln-${s}@example.com`, passwordHash: "x" },
    });
    const room = await prisma.room.create({ data: { code: `CLN-${s}` } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `bk-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    await assignBookingToRoom({
      bookingId: booking.id,
      roomId: room.id,
      actorUserId: actor.id,
    });

    const tasks = await prisma.cleaningTask.findMany({
      where: { bookingId: booking.id, taskType: "turnover" },
    });
    expect(tasks).toHaveLength(1);
    const t = tasks[0]!;
    expect(t.roomId).toBe(room.id);
    expect(t.sourceEventId).toBe(turnoverSourceEventId(booking.id, booking.checkoutDate, room.id));
    expect(t.sourceEventId).toMatch(/^[a-f0-9]{64}$/);
    expect(t.durationMinutes).toBe(TURNOVER_MINUTES);
    expect(t.plannedStart).toBeDefined();
    expect(t.plannedEnd).toBeDefined();
    const deltaMs = t.plannedEnd!.getTime() - t.plannedStart!.getTime();
    expect(deltaMs).toBe(TURNOVER_MINUTES * 60_000);

    const { ensureTurnoverCleaningTask } = await import("@stay-ops/db");
    await prisma.$transaction(async (tx) => {
      await ensureTurnoverCleaningTask(tx, {
        bookingId: booking.id,
        roomId: room.id,
        checkoutDate: booking.checkoutDate,
      });
    });

    const again = await prisma.cleaningTask.findMany({
      where: { bookingId: booking.id, taskType: "turnover" },
    });
    expect(again).toHaveLength(1);
    expect(again[0]!.id).toBe(t.id);
  });

  it("does not create turnover when room is inactive (direct DB assignment)", async () => {
    const { ensureTurnoverCleaningTask } = await import("@stay-ops/db");
    const s = suffix();
    const room = await prisma.room.create({ data: { code: `CLN-IN-${s}`, isActive: false } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `bk-in-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-06-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-06-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    await prisma.assignment.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        startDate: booking.checkinDate,
        endDate: booking.checkoutDate,
      },
    });

    await prisma.$transaction(async (tx) => {
      await ensureTurnoverCleaningTask(tx, {
        bookingId: booking.id,
        roomId: room.id,
        checkoutDate: booking.checkoutDate,
      });
    });

    const tasks = await prisma.cleaningTask.findMany({
      where: { bookingId: booking.id, taskType: "turnover" },
    });
    expect(tasks).toHaveLength(0);
  });
});
