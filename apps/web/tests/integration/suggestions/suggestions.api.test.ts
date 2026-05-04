import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";
import { SUGGESTION_REASON_CODE_LABELS } from "@/modules/suggestions/types";

const email = "suggestions-api@example.com";
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

describe("api booking suggestions", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_SUGGESTIONS: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    GET_SUGGESTIONS = (await import("../../../src/app/api/bookings/[id]/suggestions/route")).GET;
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

  it("returns score, reasonCodes, and breakdown for each suggestion", async () => {
    const jar = await loginJar();
    await prisma.room.createMany({
      data: [{ code: "A1" }, { code: "B1" }, { code: "C1" }],
    });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "api-sg-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-11-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-11-12T00:00:00.000Z"),
        nights: 2,
      },
    });

    const res = await GET_SUGGESTIONS(
      new NextRequest(`http://localhost/api/bookings/${booking.id}/suggestions`, {
        headers: { cookie: jar.getCookieHeader() },
      }),
      { params: Promise.resolve({ id: booking.id }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{
        roomId: string;
        score: number;
        reasonCodes: string[];
        breakdown: { availability: number; cleaningFit: number; tieBreaker: number };
      }>;
      meta: { total: number };
    };
    expect(json.meta.total).toBe(json.data.length);
    expect(json.data.length).toBeGreaterThan(0);

    for (const row of json.data) {
      expect(typeof row.roomId).toBe("string");
      expect(typeof row.score).toBe("number");
      expect(row.breakdown.availability + row.breakdown.cleaningFit + row.breakdown.tieBreaker).toBe(row.score);
      expect(row.reasonCodes.length).toBeGreaterThan(0);
      for (const code of row.reasonCodes) {
        expect(code in SUGGESTION_REASON_CODE_LABELS).toBe(true);
      }
    }
  });
});
