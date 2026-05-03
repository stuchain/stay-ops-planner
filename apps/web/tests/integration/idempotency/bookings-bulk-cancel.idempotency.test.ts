import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "idem-bulk-cancel@example.com";
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

describe("idempotency POST /api/bookings/bulk-cancel", () => {
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
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    return jar;
  }

  it("replays identical bulk-cancel under same Idempotency-Key without duplicate audit rows", async () => {
    const jar = await loginJar();
    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "idem-cancel-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-08-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-08-04T00:00:00.000Z"),
        nights: 3,
      },
    });

    const body = JSON.stringify({ bookingIds: [b.id], dryRun: false });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      cookie: jar.getCookieHeader(),
      "Idempotency-Key": "idem-cancel-key-1",
    };

    const auditBefore = await prisma.auditEvent.count();

    const res1 = await POST_BULK_CANCEL(
      new NextRequest("http://localhost/api/bookings/bulk-cancel", { method: "POST", headers, body }),
    );
    expect(res1.status).toBe(200);
    expect(res1.headers.get("idempotency-replayed")).toBeNull();

    const res2 = await POST_BULK_CANCEL(
      new NextRequest("http://localhost/api/bookings/bulk-cancel", { method: "POST", headers, body }),
    );
    expect(res2.status).toBe(200);
    expect(res2.headers.get("idempotency-replayed")).toBe("true");
    const j1 = await res1.json();
    const j2 = await res2.json();
    expect(j2).toEqual(j1);

    const auditAfter = await prisma.auditEvent.count();
    expect(auditAfter).toBe(auditBefore + 1);
  });
});
