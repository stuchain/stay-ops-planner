import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "bookings-overview-api@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";
process.env.APP_TIMEZONE ??= "Etc/UTC";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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

describe("api GET /api/bookings/overview", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_OVERVIEW: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    GET_OVERVIEW = (await import("../../../src/app/api/bookings/overview/route.ts")).GET;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { email, passwordHash, isActive: true } });
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

  it("returns 401 without session", async () => {
    const res = await GET_OVERVIEW(
      new NextRequest("http://localhost/api/bookings/overview?month=2026-07", { headers: new Headers() }),
    );
    expect(res.status).toBe(401);
  });

  it("returns all rooms plus grouped unassigned and assigned bookings", async () => {
    const jar = await loginJar();
    const roomA = await prisma.room.create({ data: { code: "E2E-A", displayName: "Apartment A", isActive: true } });
    const roomB = await prisma.room.create({ data: { code: "E2E-B", displayName: "Apartment B", isActive: false } });

    const assigned = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "assigned-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-02T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-04T00:00:00.000Z"),
        nights: 2,
        rawPayload: { guest: "Assigned Guest" },
      },
    });
    await prisma.assignment.create({
      data: {
        bookingId: assigned.id,
        roomId: roomA.id,
        startDate: assigned.checkinDate,
        endDate: assigned.checkoutDate,
      },
    });

    await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "unassigned-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-10T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-12T00:00:00.000Z"),
        nights: 2,
        rawPayload: { guest: "Unassigned Guest" },
      },
    });

    const res = await GET_OVERVIEW(
      new NextRequest("http://localhost/api/bookings/overview?month=2026-07", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        rooms: Array<{ id: string; label: string; maxGuests: number | null }>;
        unassigned: Array<{ guestName: string }>;
        assigned: Array<{ guestName: string; roomLabel: string }>;
      };
    };
    expect(json.data.rooms).toEqual([
      { id: roomA.id, label: "Apartment A", maxGuests: null },
      { id: roomB.id, label: "Apartment B", maxGuests: null },
    ]);
    expect(json.data.unassigned.map((b) => b.guestName)).toContain("Unassigned Guest");
    expect(json.data.assigned).toEqual(
      expect.arrayContaining([expect.objectContaining({ guestName: "Assigned Guest", roomLabel: "Apartment A" })]),
    );
  });

  it("includes bookings overlapping the month boundary", async () => {
    const jar = await loginJar();
    await prisma.room.create({ data: { code: "E2E-A", displayName: "Apartment A", isActive: true } });
    await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "boundary-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-06-29T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-02T00:00:00.000Z"),
        nights: 3,
        rawPayload: { guest: "Boundary Guest" },
      },
    });

    const res = await GET_OVERVIEW(
      new NextRequest("http://localhost/api/bookings/overview?month=2026-07", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { unassigned: Array<{ guestName: string }> } };
    expect(json.data.unassigned.map((b) => b.guestName)).toContain("Boundary Guest");
  });
});
