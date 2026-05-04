/**
 * Bulk assign API (Epic 5 dry-run).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "bulk-assign-api@example.com";
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

describe("api POST /api/assignments/bulk", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_BULK: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    POST_BULK = (await import("../../../src/app/api/assignments/bulk/route")).POST;
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

  it("dry run returns summary and does not create assignments", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "bulk-r1" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "bulk-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "bulk-2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-14T00:00:00.000Z"),
        nights: 4,
      },
    });

    const before = await prisma.assignment.count();
    const res = await POST_BULK(
      new NextRequest("http://localhost/api/assignments/bulk?dryRun=true", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          items: [
            { bookingId: b1.id, roomId: room.id },
            { bookingId: b2.id, roomId: room.id },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { dryRun: boolean; summary: { totals: { processed: number } } } };
    expect(json.data.dryRun).toBe(true);
    expect(json.data.summary.totals.processed).toBeGreaterThan(0);
    expect(await prisma.assignment.count()).toBe(before);
  });

  it("happy path assigns all items", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "bulk-r2" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "bulk-h1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-11-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-11-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "bulk-h2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-11-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-11-14T00:00:00.000Z"),
        nights: 4,
      },
    });

    const res = await POST_BULK(
      new NextRequest("http://localhost/api/assignments/bulk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          items: [
            { bookingId: b1.id, roomId: room.id },
            { bookingId: b2.id, roomId: room.id },
          ],
          dryRun: false,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const rows = await prisma.assignment.findMany({ where: { roomId: room.id } });
    expect(rows).toHaveLength(2);
  });

  it("all-or-nothing: overlap fails entire batch", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "bulk-r3" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "bulk-o1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-09-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-09-05T00:00:00.000Z"),
        nights: 4,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "bulk-o2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-09-03T00:00:00.000Z"),
        checkoutDate: new Date("2026-09-08T00:00:00.000Z"),
        nights: 5,
      },
    });

    const res = await POST_BULK(
      new NextRequest("http://localhost/api/assignments/bulk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          items: [
            { bookingId: b1.id, roomId: room.id },
            { bookingId: b2.id, roomId: room.id },
          ],
        }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await prisma.assignment.count()).toBe(0);
  });
});
