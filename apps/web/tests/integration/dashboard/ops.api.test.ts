import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "dashboard-ops@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

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

describe("api /api/dashboard/ops", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_OPS: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    GET_OPS = (await import("../../../src/app/api/dashboard/ops/route.ts")).GET;
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

  it("requires auth", async () => {
    const res = await GET_OPS(new NextRequest("http://localhost/api/dashboard/ops", { headers: new Headers() }));
    expect(res.status).toBe(401);
  });

  it("returns dashboard metrics contract", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "D1" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "db-1",
        status: BookingStatus.needs_reassignment,
        checkinDate: new Date("2026-10-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-10-03T00:00:00.000Z"),
        nights: 2,
      },
    });
    const syncRun = await prisma.syncRun.create({
      data: { status: "completed", source: "test", startedAt: new Date() },
    });
    await prisma.importError.create({
      data: {
        syncRunId: syncRun.id,
        code: "E_IMPORT",
        message: "bad payload",
        resolved: false,
      },
    });
    await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "todo",
        taskType: "turnover",
        sourceEventId: "dash-task-1",
        plannedStart: new Date("2026-10-03T10:00:00.000Z"),
        plannedEnd: new Date("2026-10-03T12:00:00.000Z"),
        durationMinutes: 120,
      },
    });

    const res = await GET_OPS(
      new NextRequest("http://localhost/api/dashboard/ops", { headers: { cookie: jar.getCookieHeader() } }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        sync: { successRatio24h: number };
        importErrors: {
          unresolvedTotal: number;
          oldestUnresolved: { ageMs: number; code: string } | null;
        };
        conflicts: { unresolvedTotal: number };
        cleaning: { backlogByStatus: Array<{ status: string; count: number }> };
      };
    };
    expect(json.data.sync.successRatio24h).toBe(100);
    expect(json.data.sync.successfulRuns24h).toBe(1);
    expect(json.data.importErrors.unresolvedTotal).toBeGreaterThan(0);
    expect(json.data.importErrors.oldestUnresolved).not.toBeNull();
    expect(json.data.importErrors.oldestUnresolved?.ageMs).toBeGreaterThanOrEqual(0);
    expect(json.data.conflicts.unresolvedTotal).toBeGreaterThan(0);
    expect(json.data.cleaning.backlogByStatus.some((r) => r.status === "todo")).toBe(true);
  });
});
