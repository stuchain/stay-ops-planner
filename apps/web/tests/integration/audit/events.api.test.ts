import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "audit-events@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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

describe("api /api/audit/events", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_EVENTS: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    GET_EVENTS = (await import("../../../src/app/api/audit/events/route.ts")).GET;
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

  it("filters by entity and booking/room ids with pagination cursor", async () => {
    const jar = await loginJar();
    const actor = await prisma.user.findUniqueOrThrow({ where: { email } });

    for (let i = 0; i < 3; i += 1) {
      await prisma.auditEvent.create({
        data: {
          userId: actor.id,
          entityType: "assignment",
          entityId: `asg-${i}`,
          action: "assignment.reassign",
          beforeJson: { roomId: "room-1" },
          afterJson: { roomId: i === 2 ? "room-2" : "room-1" },
          metaJson: { bookingId: "bkg-1" },
        },
      });
    }
    await prisma.auditEvent.create({
      data: {
        userId: actor.id,
        entityType: "manual_block",
        entityId: "blk-1",
        action: "manual_block.create",
        beforeJson: null,
        afterJson: { roomId: "room-9" },
        metaJson: {},
      },
    });

    const req1 = new NextRequest(
      `http://localhost/api/audit/events?entityType=assignment&bookingId=bkg-1&roomId=room-1&actorUserId=${actor.id}&from=2020-01-01&to=2030-01-01&limit=2`,
      { headers: { cookie: jar.getCookieHeader() } },
    );
    const res1 = await GET_EVENTS(req1);
    expect(res1.status).toBe(200);
    const json1 = (await res1.json()) as {
      data: Array<{ entityType: string; entityId: string }>;
      page: { nextCursor: string | null };
    };
    expect(json1.data).toHaveLength(2);
    expect(json1.data.every((r) => r.entityType === "assignment")).toBe(true);
    expect(json1.page.nextCursor).toBeTruthy();

    const req2 = new NextRequest(
      `http://localhost/api/audit/events?entityType=assignment&bookingId=bkg-1&roomId=room-1&actorUserId=${actor.id}&from=2020-01-01&to=2030-01-01&limit=2&cursor=${encodeURIComponent(json1.page.nextCursor ?? "")}`,
      { headers: { cookie: jar.getCookieHeader() } },
    );
    const res2 = await GET_EVENTS(req2);
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as { data: Array<{ entityType: string }> };
    expect(json2.data).toHaveLength(1);
  });
});
