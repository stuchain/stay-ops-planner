/**
 * Bulk cancel bookings API (Epic 5).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "bulk-cancel-api@example.com";
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

describe("api POST /api/bookings/bulk-cancel", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_BULK_CANCEL: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    POST_BULK_CANCEL = (await import("../../../src/app/api/bookings/bulk-cancel/route.ts")).POST;
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

  it("dry run leaves bookings active", async () => {
    const jar = await loginJar();
    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "bc-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-08-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-08-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    const res = await POST_BULK_CANCEL(
      new NextRequest("http://localhost/api/bookings/bulk-cancel", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ bookingIds: [b.id], dryRun: true }),
      }),
    );
    expect(res.status).toBe(200);
    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(updated.status).toBe(BookingStatus.confirmed);
  });

  it("executes cancel", async () => {
    const jar = await loginJar();
    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "bc-2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    const res = await POST_BULK_CANCEL(
      new NextRequest("http://localhost/api/bookings/bulk-cancel", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ bookingIds: [b.id] }),
      }),
    );
    expect(res.status).toBe(200);
    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(updated.status).toBe(BookingStatus.cancelled);
  });
});
