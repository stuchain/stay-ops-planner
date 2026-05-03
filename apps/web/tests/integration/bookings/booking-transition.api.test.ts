import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "booking-patch-transition@example.com";
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

describe("api PATCH /api/bookings/[id] transitions and version", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let PATCH_BOOKING: (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    PATCH_BOOKING = (await import("../../../src/app/api/bookings/[id]/route.ts")).PATCH;
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

  it("rejects illegal status transition with INVALID_STATUS_TRANSITION", async () => {
    const jar = await loginJar();
    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "tr-bad",
        status: BookingStatus.cancelled,
        checkinDate: new Date("2026-05-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-05-03T00:00:00.000Z"),
        nights: 2,
      },
    });

    const res = await PATCH_BOOKING(
      new NextRequest(`http://localhost/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ status: BookingStatus.confirmed }),
      }),
      { params: Promise.resolve({ id: b.id }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("increments version on successful PATCH and enforces expectedVersion", async () => {
    const jar = await loginJar();
    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "tr-version",
        status: BookingStatus.pending,
        checkinDate: new Date("2026-06-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-06-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    const r1 = await PATCH_BOOKING(
      new NextRequest(`http://localhost/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ status: BookingStatus.confirmed }),
      }),
      { params: Promise.resolve({ id: b.id }) },
    );
    expect(r1.status).toBe(200);
    const j1 = (await r1.json()) as { data: { booking: { version: number } } };
    expect(j1.data.booking.version).toBe(1);

    const rStale = await PATCH_BOOKING(
      new NextRequest(`http://localhost/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ expectedVersion: 0, editable: { notes: "x" } }),
      }),
      { params: Promise.resolve({ id: b.id }) },
    );
    expect(rStale.status).toBe(409);
    const err = (await rStale.json()) as { error: { code: string } };
    expect(err.error.code).toBe("STALE_VERSION");

    const rOk = await PATCH_BOOKING(
      new NextRequest(`http://localhost/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ expectedVersion: 1, editable: { notes: "y" } }),
      }),
      { params: Promise.resolve({ id: b.id }) },
    );
    expect(rOk.status).toBe(200);
    const j2 = (await rOk.json()) as { data: { booking: { version: number; notes: string | null } } };
    expect(j2.data.booking.version).toBe(2);
    expect(j2.data.booking.notes).toBe("y");
  });
});
