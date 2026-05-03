/**
 * Assign / reassign / unassign / unassigned queue APIs (Phase 4.6).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "assign-api@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

async function truncate(prisma: PrismaClient) {
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

describe("api assignments + unassigned queue", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_ASSIGN: (request: NextRequest) => Promise<Response>;
  let PATCH_REASSIGN: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;
  let POST_UNASSIGN: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;
  let GET_UNASSIGNED: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    POST_ASSIGN = (await import("../../../src/app/api/assignments/route.ts")).POST;
    PATCH_REASSIGN = (await import("../../../src/app/api/assignments/[id]/reassign/route.ts")).PATCH;
    POST_UNASSIGN = (await import("../../../src/app/api/assignments/[id]/unassign/route.ts")).POST;
    GET_UNASSIGNED = (await import("../../../src/app/api/bookings/unassigned/route.ts")).GET;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
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

  it("lists unassigned then assign, reassign, unassign", async () => {
    const jar = await loginJar();
    const room1 = await prisma.room.create({ data: { code: "A1" } });
    const room2 = await prisma.room.create({ data: { code: "A2" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "asg-ext-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-11-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-11-05T00:00:00.000Z"),
        nights: 4,
      },
    });

    const listRes = await GET_UNASSIGNED(
      new NextRequest("http://localhost/api/bookings/unassigned?from=2026-10-01&to=2026-12-01", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      data: { bookings: { id: string }[] };
      meta: { total: number };
    };
    expect(listJson.meta.total).toBe(listJson.data.bookings.length);
    expect(listJson.data.bookings.some((b) => b.id === booking.id)).toBe(true);

    const assignRes = await POST_ASSIGN(
      new NextRequest("http://localhost/api/assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ bookingId: booking.id, roomId: room1.id }),
      }),
    );
    expect(assignRes.status).toBe(201);
    const assignJson = (await assignRes.json()) as {
      data: { assignment: { id: string; version: number } };
    };
    const assignmentId = assignJson.data.assignment.id;
    expect(assignJson.data.assignment.version).toBe(0);

    const listAfter = await GET_UNASSIGNED(
      new NextRequest("http://localhost/api/bookings/unassigned?from=2026-10-01&to=2026-12-01", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    const listAfterJson = (await listAfter.json()) as {
      data: { bookings: { id: string }[] };
      meta: { total: number };
    };
    expect(listAfterJson.meta.total).toBe(listAfterJson.data.bookings.length);
    expect(listAfterJson.data.bookings.some((b) => b.id === booking.id)).toBe(false);

    const reassignRes = await PATCH_REASSIGN(
      new NextRequest(`http://localhost/api/assignments/${assignmentId}/reassign`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ roomId: room2.id, expectedVersion: 0 }),
      }),
      { params: Promise.resolve({ id: assignmentId }) },
    );
    expect(reassignRes.status).toBe(200);

    const unassignRes = await POST_UNASSIGN(
      new NextRequest(`http://localhost/api/assignments/${assignmentId}/unassign`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ id: assignmentId }) },
    );
    expect(unassignRes.status).toBe(200);
  });

  it("returns 409 CONFLICT_ASSIGNMENT when room is taken", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "C1" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "c1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-05T00:00:00.000Z"),
        nights: 4,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "c2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-02T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-06T00:00:00.000Z"),
        nights: 4,
      },
    });

    await POST_ASSIGN(
      new NextRequest("http://localhost/api/assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ bookingId: b1.id, roomId: room.id }),
      }),
    );

    const res = await POST_ASSIGN(
      new NextRequest("http://localhost/api/assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ bookingId: b2.id, roomId: room.id }),
      }),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("CONFLICT_ASSIGNMENT");
  });

  it("returns 422 ROOM_INACTIVE when assigning to an inactive room", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "IN1", isActive: false } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "in-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-08-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-08-05T00:00:00.000Z"),
        nights: 4,
      },
    });

    const res = await POST_ASSIGN(
      new NextRequest("http://localhost/api/assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ bookingId: booking.id, roomId: room.id }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_INACTIVE");
  });

  it("returns 422 ROOM_INACTIVE when reassigning to an inactive room", async () => {
    const jar = await loginJar();
    const roomActive = await prisma.room.create({ data: { code: "RA1", isActive: true } });
    const roomInactive = await prisma.room.create({ data: { code: "RI1", isActive: false } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "rin-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-09-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-09-05T00:00:00.000Z"),
        nights: 4,
      },
    });

    const assignRes = await POST_ASSIGN(
      new NextRequest("http://localhost/api/assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ bookingId: booking.id, roomId: roomActive.id }),
      }),
    );
    expect(assignRes.status).toBe(201);
    const assignJson = (await assignRes.json()) as { data: { assignment: { id: string } } };
    const assignmentId = assignJson.data.assignment.id;

    const reassignRes = await PATCH_REASSIGN(
      new NextRequest(`http://localhost/api/assignments/${assignmentId}/reassign`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ roomId: roomInactive.id, expectedVersion: 0 }),
      }),
      { params: Promise.resolve({ id: assignmentId }) },
    );
    expect(reassignRes.status).toBe(422);
    const json = (await reassignRes.json()) as { error: { code: string } };
    expect(json.error.code).toBe("ROOM_INACTIVE");
  });
});
