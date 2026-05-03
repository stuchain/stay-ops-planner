import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "./cookieJar";

const email = "rate-limit-bulk@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://stayops:stayops@localhost:5432/stayops_test";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "rate_limit_counters",
      "login_attempts",
      "idempotency_keys",
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

describe("api rate limit assignments bulk", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_BULK: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../src/app/api/auth/login/route.ts")).POST;
    POST_BULK = (await import("../../src/app/api/assignments/bulk/route.ts")).POST;
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

  it("returns 429 when per-user counter exceeds limit for the window", async () => {
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
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await prisma.rateLimitCounter.create({
      data: {
        scope: "POST:/api/assignments/bulk",
        bucketKey: `user:${user.id}`,
        windowStart,
        count: 60,
      },
    });

    const room = await prisma.room.create({ data: { code: "rl-r1" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "rl-b1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-04T00:00:00.000Z"),
        nights: 3,
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
          items: [{ bookingId: booking.id, roomId: room.id }],
          dryRun: true,
        }),
      }),
    );
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
