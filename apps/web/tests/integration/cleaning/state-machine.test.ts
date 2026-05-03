/**
 * Cleaning state machine (Phase 5.3).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { InvalidStateTransitionError } from "../../../src/modules/cleaning/errors";

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

describe("cleaning — state machine", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
  });

  it("allows todo -> in_progress -> done and writes audits", async () => {
    const { transitionCleaningTaskStatus } = await import("../../../src/modules/cleaning/state-machine.ts");
    const room = await prisma.room.create({ data: { code: "SM1" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sm-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-08-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-08-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const actor = await prisma.user.create({
      data: { email: "sm@example.com", passwordHash: "x" },
    });
    const task = await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "todo",
        taskType: "turnover",
        sourceEventId: "sm-t1",
        plannedStart: new Date("2026-08-04T10:00:00.000Z"),
        plannedEnd: new Date("2026-08-04T12:00:00.000Z"),
        durationMinutes: 120,
      },
    });

    await transitionCleaningTaskStatus({
      taskId: task.id,
      toStatus: "in_progress",
      actorUserId: actor.id,
    });
    await transitionCleaningTaskStatus({
      taskId: task.id,
      toStatus: "done",
      actorUserId: actor.id,
    });

    const updated = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.status).toBe("done");

    const audits = await prisma.auditEvent.findMany({
      where: { entityId: task.id, action: "cleaning_task.status_changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.length).toBe(2);
    expect((audits[0]?.beforeJson as { status?: string } | null)?.status).toBe("todo");
    expect((audits[0]?.afterJson as { status?: string } | null)?.status).toBe("in_progress");
    expect((audits[1]?.beforeJson as { status?: string } | null)?.status).toBe("in_progress");
    expect((audits[1]?.afterJson as { status?: string } | null)?.status).toBe("done");
  });

  it("rejects todo -> done", async () => {
    const { transitionCleaningTaskStatus } = await import("../../../src/modules/cleaning/state-machine.ts");
    const room = await prisma.room.create({ data: { code: "SM2" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sm-2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-09-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-09-03T00:00:00.000Z"),
        nights: 2,
      },
    });
    const actor = await prisma.user.create({
      data: { email: "sm2@example.com", passwordHash: "x" },
    });
    const task = await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "todo",
        taskType: "turnover",
        sourceEventId: "sm-t2",
        plannedStart: new Date("2026-09-03T10:00:00.000Z"),
        plannedEnd: new Date("2026-09-03T12:00:00.000Z"),
        durationMinutes: 120,
      },
    });

    await expect(
      transitionCleaningTaskStatus({
        taskId: task.id,
        toStatus: "done",
        actorUserId: actor.id,
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});
