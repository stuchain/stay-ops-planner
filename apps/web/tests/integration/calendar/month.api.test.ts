/**
 * GET /api/calendar/month (Phase 6.1).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "cal-month-api@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";
process.env.APP_TIMEZONE ??= "Etc/UTC";

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

describe("api GET /api/calendar/month", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_MONTH: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    GET_MONTH = (await import("../../../src/app/api/calendar/month/route")).GET;
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

  it("returns 401 without session", async () => {
    const res = await GET_MONTH(
      new NextRequest("http://localhost/api/calendar/month?month=2026-07", { headers: new Headers() }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid month query", async () => {
    const jar = await loginJar();
    const res = await GET_MONTH(
      new NextRequest("http://localhost/api/calendar/month?month=bad", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns empty items for empty database", async () => {
    const jar = await loginJar();
    const res = await GET_MONTH(
      new NextRequest("http://localhost/api/calendar/month?month=2026-07", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        month: string;
        timezone: string;
        rooms: unknown[];
        items: unknown[];
        markers: unknown[];
        dailyRatesByRoomDay: unknown;
      };
    };
    expect(json.data.month).toBe("2026-07");
    expect(json.data.timezone).toBe("Etc/UTC");
    expect(json.data.rooms).toEqual([]);
    expect(json.data.items).toEqual([]);
    expect(json.data.markers).toEqual([]);
  });

  it("returns sorted rooms, booking and block items, and markers", async () => {
    const jar = await loginJar();
    const roomB = await prisma.room.create({ data: { code: "B", displayName: "Room B" } });
    const roomA = await prisma.room.create({ data: { code: "A", displayName: "Room A" } });

    const bookingEarly = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "ext-early",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-02T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-05T00:00:00.000Z"),
        nights: 3,
        rawPayload: { guest: "Ada" },
      },
    });

    const bookingLate = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "ext-late",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-20T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-25T00:00:00.000Z"),
        nights: 5,
      },
    });

    await prisma.assignment.create({
      data: {
        bookingId: bookingEarly.id,
        roomId: roomB.id,
        startDate: new Date("2026-07-02T00:00:00.000Z"),
        endDate: new Date("2026-07-05T00:00:00.000Z"),
      },
    });

    const block = await prisma.manualBlock.create({
      data: {
        roomId: roomA.id,
        startDate: new Date("2026-07-10T00:00:00.000Z"),
        endDate: new Date("2026-07-12T00:00:00.000Z"),
        reason: "Paint",
      },
    });

    const syncRun = await prisma.syncRun.create({
      data: { status: "done", source: "test" },
    });

    await prisma.importError.create({
      data: {
        syncRunId: syncRun.id,
        message: "bad row",
        code: "E1",
        payload: { bookingId: bookingLate.id },
        resolved: false,
        createdAt: new Date("2026-07-15T12:00:00.000Z"),
      },
    });

    const res = await GET_MONTH(
      new NextRequest("http://localhost/api/calendar/month?month=2026-07", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        rooms: { id: string; code: string | null; name: string | null; isActive: boolean }[];
        items: (
          | { kind: "booking"; id: string; roomId: string | null; flags: string[]; guestName: string }
          | { kind: "block"; id: string; roomId: string; startDate: string }
        )[];
        markers: { kind: string; bookingId: string | null; message: string }[];
      };
    };

    expect(json.data.rooms.map((r) => r.code)).toEqual(["A", "B"]);

    expect(json.data.items).toHaveLength(3);
    const row0 = json.data.items[0]!;
    const row1 = json.data.items[1]!;
    const row2 = json.data.items[2]!;
    expect(row0.kind).toBe("booking");
    if (row0.kind === "booking") {
      expect(row0.id).toBe(bookingEarly.id);
      expect(row0.roomId).toBe(roomB.id);
      expect(row0.flags).not.toContain("unassigned");
      expect(row0.guestName).toBe("Ada");
    }
    expect(row1.kind).toBe("block");
    if (row1.kind === "block") {
      expect(row1.id).toBe(block.id);
    }
    expect(row2.kind).toBe("booking");
    if (row2.kind === "booking") {
      expect(row2.flags).toContain("unassigned");
    }

    expect(json.data.markers).toHaveLength(1);
    expect(json.data.markers[0]?.bookingId).toBe(bookingLate.id);
  });

  it("includes booking overlapping month boundary (checkin before month)", async () => {
    const jar = await loginJar();
    await prisma.room.create({ data: { code: "R1" } });

    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "ext-boundary",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-06-28T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-03T00:00:00.000Z"),
        nights: 5,
      },
    });

    const res = await GET_MONTH(
      new NextRequest("http://localhost/api/calendar/month?month=2026-07", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: { kind: string; id: string }[] } };
    expect(json.data.items.some((i) => i.kind === "booking" && i.id === b.id)).toBe(true);
  });
});
