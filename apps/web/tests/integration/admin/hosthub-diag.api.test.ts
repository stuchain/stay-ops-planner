import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const operatorEmail = "hosthub-diag-op@example.com";
const password = "password1234";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
      "integration_secrets",
      "webhook_inbound_events",
      "import_errors",
      "sync_runs",
      "audit_events",
      "assignments",
      "cleaning_tasks",
      "manual_blocks",
      "bookings",
      "source_listings",
      "rooms"
    RESTART IDENTITY CASCADE;
  `);
}

describe("api GET /api/admin/sync/hosthub/diag overlapYear", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_DIAG: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    GET_DIAG = (await import("../../../src/app/api/admin/sync/hosthub/diag/route.ts")).GET;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
    await prisma.user.deleteMany({ where: { email: operatorEmail } });
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: operatorEmail, passwordHash, isActive: true, role: "operator" },
    });
  });

  async function loginJar(): Promise<CookieJar> {
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email: operatorEmail, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    return jar;
  }

  it("includes overlapYearUtc when overlapYear is valid", async () => {
    const listing = await prisma.sourceListing.create({
      data: {
        channel: Channel.airbnb,
        externalListingId: "ext-list-1",
        title: "Test",
      },
    });
    await prisma.booking.createMany({
      data: [
        {
          sourceListingId: listing.id,
          channel: Channel.airbnb,
          externalBookingId: "b-with",
          status: BookingStatus.confirmed,
          checkinDate: new Date(Date.UTC(2026, 5, 1)),
          checkoutDate: new Date(Date.UTC(2026, 5, 5)),
          nights: 4,
        },
        {
          sourceListingId: null,
          channel: Channel.booking,
          externalBookingId: "b-orphan",
          status: BookingStatus.confirmed,
          checkinDate: new Date(Date.UTC(2026, 7, 1)),
          checkoutDate: new Date(Date.UTC(2026, 7, 3)),
          nights: 2,
        },
      ],
    });

    const jar = await loginJar();
    const res = await GET_DIAG(
      new NextRequest("http://localhost/api/admin/sync/hosthub/diag?overlapYear=2026", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        excelListingsBookingCounts: {
          overlapYearUtc?: {
            year: number;
            totalStayRowsOverlapping: number;
            withSourceListing: number;
            withoutSourceListing: number;
          };
        };
      };
    };
    const o = body.data.excelListingsBookingCounts.overlapYearUtc;
    expect(o).toBeDefined();
    expect(o!.year).toBe(2026);
    expect(o!.totalStayRowsOverlapping).toBe(2);
    expect(o!.withSourceListing).toBe(1);
    expect(o!.withoutSourceListing).toBe(1);
  });

  it("omits overlapYearUtc when overlapYear is absent", async () => {
    const jar = await loginJar();
    const res = await GET_DIAG(
      new NextRequest("http://localhost/api/admin/sync/hosthub/diag", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { excelListingsBookingCounts: { overlapYearUtc?: unknown } };
    };
    expect(body.data.excelListingsBookingCounts.overlapYearUtc).toBeUndefined();
  });
});
