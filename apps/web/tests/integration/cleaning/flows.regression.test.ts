/**
 * Regression: cancellation vs done, REST schedule/status errors (Phase 5.6).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { CLEANING_WINDOW_INVALID_MESSAGE, PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { applyCancellationSideEffects } from "@stay-ops/sync";
import { CookieJar } from "../cookieJar";
import { makeAssignment, makeBooking, makeRoom } from "../helpers/cleaningFixtures";

const email = "cleaning-flows@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

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

describe("cleaning — regression flows", () => {
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let PATCH_SCHEDULE: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;
  let PATCH_STATUS: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    PATCH_SCHEDULE = (await import("../../../src/app/api/cleaning/tasks/[id]/schedule/route.ts")).PATCH;
    PATCH_STATUS = (await import("../../../src/app/api/cleaning/tasks/[id]/status/route.ts")).PATCH;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate();
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email, passwordHash, isActive: true },
    });
  });

  async function loginJar(): Promise<CookieJar> {
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    return jar;
  }

  it("cancellation cancels todo but leaves done tasks unchanged", async () => {
    const room = await makeRoom(prisma, "CF-R");
    const booking = await makeBooking(prisma, {
      externalBookingId: "cf-1",
      checkinDate: new Date("2026-01-01T00:00:00.000Z"),
      checkoutDate: new Date("2026-01-05T00:00:00.000Z"),
      nights: 4,
    });
    const todoTask = await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "todo",
        taskType: "turnover",
        sourceEventId: "cf-todo",
        plannedStart: new Date("2026-01-05T10:00:00.000Z"),
        plannedEnd: new Date("2026-01-05T12:00:00.000Z"),
        durationMinutes: 120,
      },
    });
    const doneTask = await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "done",
        taskType: "service",
        sourceEventId: "cf-done",
        plannedStart: new Date("2026-01-06T10:00:00.000Z"),
        plannedEnd: new Date("2026-01-06T11:00:00.000Z"),
        durationMinutes: 60,
      },
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.cancelled },
    });

    await prisma.$transaction(async (tx) => {
      await applyCancellationSideEffects(tx, booking.id);
    });

    const t1 = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: todoTask.id } });
    const t2 = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: doneTask.id } });
    expect(t1.status).toBe("cancelled");
    expect(t2.status).toBe("done");
  });

  it("PATCH schedule succeeds for a valid window", async () => {
    const jar = await loginJar();
    const room = await makeRoom(prisma, "CF-OK");
    const booking = await makeBooking(prisma, {
      externalBookingId: "cf-ok1",
      checkinDate: new Date("2026-04-01T00:00:00.000Z"),
      checkoutDate: new Date("2026-04-05T00:00:00.000Z"),
      nights: 4,
    });
    await makeAssignment(prisma, {
      bookingId: booking.id,
      roomId: room.id,
      startDate: booking.checkinDate,
      endDate: booking.checkoutDate,
    });
    const task = await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "todo",
        taskType: "turnover",
        sourceEventId: "cf-ok",
        plannedStart: new Date("2026-04-05T10:00:00.000Z"),
        plannedEnd: new Date("2026-04-05T12:00:00.000Z"),
        durationMinutes: 120,
      },
    });

    const res = await PATCH_SCHEDULE(
      new NextRequest(`http://localhost/api/cleaning/tasks/${task.id}/schedule`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          plannedStart: "2026-04-05T14:00:00.000Z",
          plannedEnd: "2026-04-05T16:00:00.000Z",
          assigneeName: "Test",
        }),
      }),
      { params: Promise.resolve({ id: task.id }) },
    );
    expect(res.status).toBe(200);
    const updated = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.assigneeName).toBe("Test");
  });

  it("PATCH schedule returns 409 when window is invalid", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "CF-S" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "cf-s1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-02-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-02-05T00:00:00.000Z"),
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
        status: "todo",
        taskType: "turnover",
        sourceEventId: "cf-sch",
        plannedStart: new Date("2026-02-05T10:00:00.000Z"),
        plannedEnd: new Date("2026-02-05T12:00:00.000Z"),
        durationMinutes: 120,
      },
    });

    const res = await PATCH_SCHEDULE(
      new NextRequest(`http://localhost/api/cleaning/tasks/${task.id}/schedule`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          plannedStart: "2026-02-04T10:00:00.000Z",
          plannedEnd: "2026-02-04T12:00:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: task.id }) },
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("CLEANING_WINDOW_INVALID");
    expect(json.error.message).toBe(CLEANING_WINDOW_INVALID_MESSAGE);
  });

  it("PATCH status returns 422 for todo to done", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "CF-ST" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "cf-st1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-03-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-03-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const task = await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "todo",
        taskType: "turnover",
        sourceEventId: "cf-st",
        plannedStart: new Date("2026-03-04T10:00:00.000Z"),
        plannedEnd: new Date("2026-03-04T12:00:00.000Z"),
        durationMinutes: 120,
      },
    });

    const res = await PATCH_STATUS(
      new NextRequest(`http://localhost/api/cleaning/tasks/${task.id}/status`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ status: "done" }),
      }),
      { params: Promise.resolve({ id: task.id }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
  });
});
