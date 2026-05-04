import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "audit-page@example.com";
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

describe("api /api/audit/events pagination with bookingId filter", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_EVENTS: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    GET_EVENTS = (await import("../../../src/app/api/audit/events/route")).GET;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { email, passwordHash, isActive: true, role: "operator" } });
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

  it("returns full pages when many rows do not match bookingId", async () => {
    const jar = await loginJar();
    const actor = await prisma.user.findUniqueOrThrow({ where: { email } });

    for (let i = 0; i < 35; i += 1) {
      await prisma.auditEvent.create({
        data: {
          userId: actor.id,
          entityType: "assignment",
          entityId: `noise-${i}`,
          action: "assignment.assign",
          beforeJson: Prisma.JsonNull,
          afterJson: { roomId: "r1" },
          metaJson: { bookingId: "OTHER" },
          createdAt: new Date(Date.UTC(2024, 0, 1, 12, 0, i)),
        },
      });
    }
    for (let j = 0; j < 5; j += 1) {
      await prisma.auditEvent.create({
        data: {
          userId: actor.id,
          entityType: "assignment",
          entityId: `hit-${j}`,
          action: "assignment.assign",
          beforeJson: Prisma.JsonNull,
          afterJson: { roomId: "r2" },
          metaJson: { bookingId: "TARGET" },
          createdAt: new Date(Date.UTC(2024, 0, 2, 12, 0, j)),
        },
      });
    }

    const q = `from=2020-01-01&to=2030-01-01&bookingId=TARGET&limit=2`;
    const res1 = await GET_EVENTS(
      new NextRequest(`http://localhost/api/audit/events?${q}`, { headers: { cookie: jar.getCookieHeader() } }),
    );
    expect(res1.status).toBe(200);
    const j1 = (await res1.json()) as { data: Array<{ entityId: string }>; page: { nextCursor: string | null } };
    expect(j1.data).toHaveLength(2);
    expect(j1.page.nextCursor).toBeTruthy();

    const res2 = await GET_EVENTS(
      new NextRequest(`http://localhost/api/audit/events?${q}&cursor=${encodeURIComponent(j1.page.nextCursor!)}`, {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res2.status).toBe(200);
    const j2 = (await res2.json()) as { data: Array<{ entityId: string }>; page: { nextCursor: string | null } };
    expect(j2.data).toHaveLength(2);
    expect(j2.page.nextCursor).toBeTruthy();

    const res3 = await GET_EVENTS(
      new NextRequest(`http://localhost/api/audit/events?${q}&cursor=${encodeURIComponent(j2.page.nextCursor!)}`, {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res3.status).toBe(200);
    const j3 = (await res3.json()) as { data: Array<{ entityId: string }>; page: { nextCursor: string | null } };
    expect(j3.data).toHaveLength(1);
    expect(j3.page.nextCursor).toBeNull();
  });
});
