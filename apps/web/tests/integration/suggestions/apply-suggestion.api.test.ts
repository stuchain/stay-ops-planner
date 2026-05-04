import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "apply-suggestion@example.com";
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

describe("api apply suggestion endpoint", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_APPLY: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string; roomId: string }> },
  ) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    POST_APPLY = (await import("../../../src/app/api/bookings/[id]/suggestions/[roomId]/apply/route")).POST;
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

  it("applies suggestion by delegating to allocation assign service", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "A1" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "apply-ok",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-10-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-03T00:00:00.000Z"),
        nights: 2,
      },
    });

    const res = await POST_APPLY(
      new NextRequest(`http://localhost/api/bookings/${booking.id}/suggestions/${room.id}/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ expectedVersion: 0 }),
      }),
      { params: Promise.resolve({ id: booking.id, roomId: room.id }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { assignment: { bookingId: string; roomId: string } } };
    expect(json.data.assignment.bookingId).toBe(booking.id);
    expect(json.data.assignment.roomId).toBe(room.id);
  });

  it("returns same conflict error as manual assignment path", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "A1" } });
    const bookingA = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "apply-conflict-a",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-10-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-12T00:00:00.000Z"),
        nights: 2,
      },
    });
    const bookingB = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "apply-conflict-b",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-10-11T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-13T00:00:00.000Z"),
        nights: 2,
      },
    });

    const first = await POST_APPLY(
      new NextRequest(`http://localhost/api/bookings/${bookingA.id}/suggestions/${room.id}/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
      }),
      { params: Promise.resolve({ id: bookingA.id, roomId: room.id }) },
    );
    expect(first.status).toBe(200);

    const second = await POST_APPLY(
      new NextRequest(`http://localhost/api/bookings/${bookingB.id}/suggestions/${room.id}/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
      }),
      { params: Promise.resolve({ id: bookingB.id, roomId: room.id }) },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT_ASSIGNMENT");
  });
});
