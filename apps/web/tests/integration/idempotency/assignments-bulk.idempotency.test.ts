import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "idem-bulk-assign@example.com";
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

describe("idempotency POST /api/assignments/bulk", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_BULK: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    POST_BULK = (await import("../../../src/app/api/assignments/bulk/route.ts")).POST;
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

  it("replays identical request under same Idempotency-Key without duplicate assignments", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "idem-r1" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "idem-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-04T00:00:00.000Z"),
        nights: 3,
      },
    });
    const b2 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "idem-2",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-12-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-12-14T00:00:00.000Z"),
        nights: 4,
      },
    });

    const body = JSON.stringify({
      items: [
        { bookingId: b1.id, roomId: room.id },
        { bookingId: b2.id, roomId: room.id },
      ],
      dryRun: false,
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      cookie: jar.getCookieHeader(),
      "Idempotency-Key": "idem-bulk-1",
    };

    const res1 = await POST_BULK(
      new NextRequest("http://localhost/api/assignments/bulk", {
        method: "POST",
        headers,
        body,
      }),
    );
    expect(res1.status).toBe(201);
    const json1 = (await res1.json()) as { data: { assignments: unknown[] } };
    expect(json1.data.assignments).toHaveLength(2);
    expect(res1.headers.get("idempotency-replayed")).toBeNull();

    const res2 = await POST_BULK(
      new NextRequest("http://localhost/api/assignments/bulk", {
        method: "POST",
        headers,
        body,
      }),
    );
    expect(res2.status).toBe(201);
    expect(res2.headers.get("idempotency-replayed")).toBe("true");
    const json2 = (await res2.json()) as typeof json1;
    expect(json2).toEqual(json1);

    const rows = await prisma.assignment.findMany({ where: { roomId: room.id } });
    expect(rows).toHaveLength(2);
  });

  it("returns 422 when same key is reused with a different body", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "idem-r2" } });
    const b1 = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "idem-3",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-11-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-11-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    const key = "idem-bulk-conflict";
    const h = {
      "content-type": "application/json",
      cookie: jar.getCookieHeader(),
      "Idempotency-Key": key,
    };

    const res1 = await POST_BULK(
      new NextRequest("http://localhost/api/assignments/bulk", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ items: [{ bookingId: b1.id, roomId: room.id }], dryRun: false }),
      }),
    );
    expect(res1.status).toBe(201);

    const res2 = await POST_BULK(
      new NextRequest("http://localhost/api/assignments/bulk", {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          items: [{ bookingId: b1.id, roomId: room.id }],
          dryRun: true,
        }),
      }),
    );
    expect(res2.status).toBe(422);
    const err = (await res2.json()) as { error: { code: string } };
    expect(err.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });
});
