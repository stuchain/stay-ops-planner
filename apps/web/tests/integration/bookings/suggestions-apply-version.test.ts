import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "suggest-apply-version@example.com";
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

describe("api POST suggestions apply expectedVersion", () => {
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
      data: { email, passwordHash, isActive: true, role: "operator" },
    });
  });

  async function loginJar(): Promise<CookieJar> {
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    return jar;
  }

  it("returns STALE_VERSION when expectedVersion does not match booking.version", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "sv-room-stale" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sv-stale",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-10-05T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-07T00:00:00.000Z"),
        nights: 2,
      },
    });
    await prisma.booking.update({ where: { id: booking.id }, data: { version: 4 } });

    const res = await POST_APPLY(
      new NextRequest(`http://localhost/api/bookings/${booking.id}/suggestions/${room.id}/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ id: booking.id, roomId: room.id }) },
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("STALE_VERSION");
  });

  it("succeeds when expectedVersion matches booking.version", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "sv-room-ok" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "sv-ok",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-10-09T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-11T00:00:00.000Z"),
        nights: 2,
        version: 1,
      },
    });

    const res = await POST_APPLY(
      new NextRequest(`http://localhost/api/bookings/${booking.id}/suggestions/${room.id}/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ id: booking.id, roomId: room.id }) },
    );
    expect(res.status).toBe(200);
  });
});
