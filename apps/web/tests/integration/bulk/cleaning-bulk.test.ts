/**
 * Bulk cleaning tasks API (Epic 5).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "bulk-clean-api@example.com";
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

describe("api POST /api/cleaning/tasks/bulk", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_BULK: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    POST_BULK = (await import("../../../src/app/api/cleaning/tasks/bulk/route")).POST;
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

  it("dry run does not create cleaning tasks", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "clean-bulk-r1" } });
    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "cb-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-05-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    const before = await prisma.cleaningTask.count();
    const res = await POST_BULK(
      new NextRequest("http://localhost/api/cleaning/tasks/bulk?dryRun=true", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          items: [{ bookingId: b.id, roomId: room.id, sourceEventId: "evt-bulk-dry-1" }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await prisma.cleaningTask.count()).toBe(before);
  });

  it("creates service tasks", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "clean-bulk-r2" } });
    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "cb-2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-04-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-04-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    const res = await POST_BULK(
      new NextRequest("http://localhost/api/cleaning/tasks/bulk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          items: [{ bookingId: b.id, roomId: room.id, sourceEventId: "evt-bulk-ex-1" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const tasks = await prisma.cleaningTask.findMany({ where: { bookingId: b.id } });
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });
});
