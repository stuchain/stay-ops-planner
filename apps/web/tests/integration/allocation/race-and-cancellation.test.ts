/**
 * Concurrency and cancellation flows (Phase 4.7).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { applyCancellationSideEffects } from "@stay-ops/sync";
import { AllocationError } from "../../../src/modules/allocation/errors";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

function suffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

async function truncateDomain() {
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

describe("allocation — race and cancellation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateDomain();
  });

  it("parallel overlapping assigns: one succeeds, one CONFLICT_ASSIGNMENT", async () => {
    const { assignBookingToRoom } = await import("../../../src/modules/allocation/service");
    const s = suffix();
    const actor = await prisma.user.create({
      data: { email: `race-${s}@example.com`, passwordHash: "x" },
    });
    const room = await prisma.room.create({ data: { code: `race-${s}` } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `r1-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-04-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-04-05T00:00:00.000Z"),
        nights: 4,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `r2-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-04-03T00:00:00.000Z"),
        checkoutDate: new Date("2026-04-07T00:00:00.000Z"),
        nights: 4,
      },
    });

    const gate = Promise.withResolvers<void>();
    const p1 = (async () => {
      await gate.promise;
      return assignBookingToRoom({
        bookingId: b1.id,
        roomId: room.id,
        actorUserId: actor.id,
      });
    })();
    const p2 = (async () => {
      await gate.promise;
      return assignBookingToRoom({
        bookingId: b2.id,
        roomId: room.id,
        actorUserId: actor.id,
      });
    })();
    gate.resolve();

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(AllocationError);
    expect((reason as AllocationError).code).toBe("CONFLICT_ASSIGNMENT");
  });

  it("parallel assign same booking to two rooms: one BOOKING_ALREADY_ASSIGNED", async () => {
    const { assignBookingToRoom } = await import("../../../src/modules/allocation/service");
    const s = suffix();
    const actor = await prisma.user.create({
      data: { email: `race2-${s}@example.com`, passwordHash: "x" },
    });
    const room1 = await prisma.room.create({ data: { code: `r2a-${s}` } });
    const room2 = await prisma.room.create({ data: { code: `r2b-${s}` } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `sb-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-14T00:00:00.000Z"),
        nights: 4,
      },
    });

    const gate = Promise.withResolvers<void>();
    const p1 = (async () => {
      await gate.promise;
      return assignBookingToRoom({
        bookingId: booking.id,
        roomId: room1.id,
        actorUserId: actor.id,
      });
    })();
    const p2 = (async () => {
      await gate.promise;
      return assignBookingToRoom({
        bookingId: booking.id,
        roomId: room2.id,
        actorUserId: actor.id,
      });
    })();
    gate.resolve();

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(AllocationError);
    expect((reason as AllocationError).code).toBe("BOOKING_ALREADY_ASSIGNED");
  });

  it("applyCancellationSideEffects removes assignment and cancels pending cleaning", async () => {
    const s = suffix();
    const room = await prisma.room.create({ data: { code: `cx-${s}` } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `cx-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-06-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-06-05T00:00:00.000Z"),
        nights: 4,
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
    const task = await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "in_progress",
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.cancelled },
      });
      await applyCancellationSideEffects(tx, booking.id);
    });

    const b = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { assignment: true },
    });
    expect(b.status).toBe(BookingStatus.cancelled);
    expect(b.assignment).toBeNull();

    const t = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(t.status).toBe("cancelled");

    await prisma.$transaction(async (tx) => {
      await applyCancellationSideEffects(tx, booking.id);
    });
  });
});
