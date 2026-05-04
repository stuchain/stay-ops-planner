/**
 * Allocation command service — version and happy-path behavior (Phase 4.1).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

function suffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

async function truncateAllocationDomain() {
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
      "rooms"
    RESTART IDENTITY CASCADE;
  `);
}

describe("allocation service — commands", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAllocationDomain();
  });

  it("assign creates assignment version 0 and audit", async () => {
    const { assignBookingToRoom } = await import(
      "../../../src/modules/allocation/service"
    );
    const s = suffix();
    const actor = await prisma.user.create({
      data: {
        email: `op-${s}@example.com`,
        passwordHash: "x",
      },
    });
    const room = await prisma.room.create({ data: { code: `R-${s}` } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `B-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    const result = await assignBookingToRoom({
      bookingId: booking.id,
      roomId: room.id,
      actorUserId: actor.id,
    });

    expect(result.assignment.version).toBe(0);
    expect(result.assignment.roomId).toBe(room.id);

    const row = await prisma.assignment.findUnique({ where: { id: result.assignment.id } });
    expect(row).not.toBeNull();

    const audits = await prisma.auditEvent.findMany({
      where: { entityId: result.assignment.id, action: "assignment.assign" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.id).toBe(result.auditRef);
    expect(audits[0]?.beforeJson).toBeNull();
    expect((audits[0]?.afterJson as { roomId?: string } | null)?.roomId).toBe(room.id);
  });

  it("reassign increments version when expectedVersion matches", async () => {
    const { assignBookingToRoom, reassignRoom } = await import(
      "../../../src/modules/allocation/service"
    );
    const s = suffix();
    const actor = await prisma.user.create({
      data: {
        email: `op-${s}@example.com`,
        passwordHash: "x",
      },
    });
    const room1 = await prisma.room.create({ data: { code: `R1-${s}` } });
    const room2 = await prisma.room.create({ data: { code: `R2-${s}` } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `B-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-06-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-06-05T00:00:00.000Z"),
        nights: 4,
      },
    });

    const a = await assignBookingToRoom({
      bookingId: booking.id,
      roomId: room1.id,
      actorUserId: actor.id,
    });

    const r = await reassignRoom({
      assignmentId: a.assignment.id,
      roomId: room2.id,
      expectedVersion: 0,
      actorUserId: actor.id,
    });

    expect(r.assignment.version).toBe(1);
    expect(r.assignment.roomId).toBe(room2.id);
  });

  it("reassign rejects stale expectedVersion", async () => {
    const { assignBookingToRoom, reassignRoom } = await import(
      "../../../src/modules/allocation/service"
    );
    const { AllocationError } = await import("../../../src/modules/allocation/errors");

    const s = suffix();
    const actor = await prisma.user.create({
      data: {
        email: `op-${s}@example.com`,
        passwordHash: "x",
      },
    });
    const room1 = await prisma.room.create({ data: { code: `R1-${s}` } });
    const room2 = await prisma.room.create({ data: { code: `R2-${s}` } });
    const room3 = await prisma.room.create({ data: { code: `R3-${s}` } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: `B-${s}`,
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-05T00:00:00.000Z"),
        nights: 4,
      },
    });

    const a = await assignBookingToRoom({
      bookingId: booking.id,
      roomId: room1.id,
      actorUserId: actor.id,
    });

    await reassignRoom({
      assignmentId: a.assignment.id,
      roomId: room2.id,
      expectedVersion: 0,
      actorUserId: actor.id,
    });

    let caught: unknown;
    try {
      await reassignRoom({
        assignmentId: a.assignment.id,
        roomId: room3.id,
        expectedVersion: 0,
        actorUserId: actor.id,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AllocationError);
    const err = caught as InstanceType<typeof AllocationError>;
    expect(err.code).toBe("STALE_VERSION");
    expect(err.details).toEqual({ currentVersion: 1, expectedVersion: 0 });
  });
});
