/**
 * Structured CONFLICT_ASSIGNMENT / CONFLICT_BLOCK from findStayConflict (Phase 4.2).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { AllocationError } from "../../../src/modules/allocation/errors";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

function suffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

async function truncateAllocationDomain() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_events",
      "assignments",
      "cleaning_tasks",
      "manual_blocks",
      "bookings",
      "source_listings",
      "rooms"
    RESTART IDENTITY CASCADE;
  `);
}

describe("allocation — hard-block conflicts", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAllocationDomain();
  });

  it("assign rejects overlap with existing assignment (CONFLICT_ASSIGNMENT)", async () => {
    const { assignBookingToRoom } = await import("../../../src/modules/allocation/service");
    const s = suffix();
    const actor = await prisma.user.create({
      data: { email: `op-${s}@example.com`, passwordHash: "x" },
    });
    const room = await prisma.room.create({ data: { code: `R-${s}` } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `B1-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `B2-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-03T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-06T00:00:00.000Z"),
        nights: 3,
      },
    });

    await assignBookingToRoom({
      bookingId: b1.id,
      roomId: room.id,
      actorUserId: actor.id,
    });

    let caught: unknown;
    try {
      await assignBookingToRoom({
        bookingId: b2.id,
        roomId: room.id,
        actorUserId: actor.id,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(AllocationError);
    const err = caught as AllocationError;
    expect(err.code).toBe("CONFLICT_ASSIGNMENT");
    expect(err.details).toMatchObject({
      conflictType: "assignment",
      roomId: room.id,
    });
    expect(err.details).toHaveProperty("conflictId");
    expect(err.details).toHaveProperty("startDate");
    expect(err.details).toHaveProperty("endDate");
  });

  it("assign rejects overlap with manual block (CONFLICT_BLOCK)", async () => {
    const { assignBookingToRoom } = await import("../../../src/modules/allocation/service");
    const s = suffix();
    const actor = await prisma.user.create({
      data: { email: `op-${s}@example.com`, passwordHash: "x" },
    });
    const room = await prisma.room.create({ data: { code: `R-${s}` } });
    await prisma.manualBlock.create({
      data: {
        roomId: room.id,
        startDate: new Date("2026-06-10T00:00:00.000Z"),
        endDate: new Date("2026-06-13T00:00:00.000Z"),
        reason: "maint",
      },
    });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `B-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-06-11T00:00:00.000Z"),
        checkoutDate: new Date("2026-06-12T00:00:00.000Z"),
        nights: 1,
      },
    });

    let caught: unknown;
    try {
      await assignBookingToRoom({
        bookingId: booking.id,
        roomId: room.id,
        actorUserId: actor.id,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(AllocationError);
    const err = caught as AllocationError;
    expect(err.code).toBe("CONFLICT_BLOCK");
    expect(err.details).toMatchObject({
      conflictType: "maintenance_block",
      roomId: room.id,
    });
  });

  it("assign allows adjacent stay after existing assignment (half-open)", async () => {
    const { assignBookingToRoom } = await import("../../../src/modules/allocation/service");
    const s = suffix();
    const actor = await prisma.user.create({
      data: { email: `op-${s}@example.com`, passwordHash: "x" },
    });
    const room = await prisma.room.create({ data: { code: `R-${s}` } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `B1-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-08-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-08-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `B2-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-08-04T00:00:00.000Z"),
        checkoutDate: new Date("2026-08-07T00:00:00.000Z"),
        nights: 3,
      },
    });

    await assignBookingToRoom({
      bookingId: b1.id,
      roomId: room.id,
      actorUserId: actor.id,
    });

    const second = await assignBookingToRoom({
      bookingId: b2.id,
      roomId: room.id,
      actorUserId: actor.id,
    });
    expect(second.assignment.roomId).toBe(room.id);
  });
});
