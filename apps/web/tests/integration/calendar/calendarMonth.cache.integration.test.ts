/**
 * Epic 12: Redis calendar month cache + invalidation on manual block create.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import Redis from "ioredis";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "cal-cache-api@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/5";
process.env.CALENDAR_MONTH_CACHE_TTL_SEC ??= "600";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
      "import_errors",
      "sync_runs",
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

async function deleteCalendarCacheKeys(redisUrl: string): Promise<void> {
  const r = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  try {
    let cursor = "0";
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", "cal:month:v1:*", "COUNT", "200");
      cursor = next;
      if (keys.length > 0) {
        await r.del(...keys);
      }
    } while (cursor !== "0");
  } finally {
    await r.quit();
  }
}

describe("calendar month Redis cache (Epic 12)", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_MONTH: (request: NextRequest) => Promise<Response>;
  let POST_BLOCKS: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    GET_MONTH = (await import("../../../src/app/api/calendar/month/route")).GET;
    POST_BLOCKS = (await import("../../../src/app/api/blocks/route")).POST;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await deleteCalendarCacheKeys(process.env.REDIS_URL!);
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

  it("invalidates cache after manual block create so the next month fetch includes the block", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "cache-R1", displayName: "Cache room", isActive: true } });
    const listing = await prisma.sourceListing.create({
      data: { channel: Channel.direct, externalListingId: "ext-cache-1", title: "L" },
    });
    await prisma.booking.create({
      data: {
        sourceListingId: listing.id,
        channel: Channel.direct,
        externalBookingId: "bk-cache-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-06-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-06-14T00:00:00.000Z"),
        nights: 4,
      },
    });

    const monthUrl = "http://localhost/api/calendar/month?month=2026-06";
    const res1 = await GET_MONTH(new NextRequest(monthUrl, { headers: { cookie: jar.getCookieHeader() } }));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { data: { items: Array<{ kind: string }> } };
    const blocksBefore = body1.data.items.filter((i) => i.kind === "block").length;
    expect(blocksBefore).toBe(0);

    const res2 = await GET_MONTH(new NextRequest(monthUrl, { headers: { cookie: jar.getCookieHeader() } }));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { data: { items: Array<{ kind: string }> } };
    expect(body2.data.items.filter((i) => i.kind === "block").length).toBe(0);

    const blockRes = await POST_BLOCKS(
      new NextRequest("http://localhost/api/blocks", {
        method: "POST",
        headers: {
          cookie: jar.getCookieHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          roomId: room.id,
          startDate: "2026-06-20",
          endDate: "2026-06-22",
          reason: "cache test",
        }),
      }),
    );
    expect(blockRes.status).toBe(201);

    const res3 = await GET_MONTH(new NextRequest(monthUrl, { headers: { cookie: jar.getCookieHeader() } }));
    expect(res3.status).toBe(200);
    const body3 = (await res3.json()) as { data: { items: Array<{ kind: string }> } };
    expect(body3.data.items.filter((i) => i.kind === "block").length).toBe(1);
  });
});
