import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "room-reorder@example.com";
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

describe("api PATCH /api/rooms/reorder", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let PATCH_REORDER: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    PATCH_REORDER = (await import("../../../src/app/api/rooms/reorder/route")).PATCH;
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

  it("reorders active rooms and writes room_calendar_sort.reorder audit", async () => {
    const jar = await loginJar();
    const actor = await prisma.user.findUniqueOrThrow({ where: { email } });

    await prisma.room.createMany({
      data: [
        { displayName: "R0", calendarSortIndex: 0, isActive: true },
        { displayName: "R1", calendarSortIndex: 1, isActive: true },
        { displayName: "R2", calendarSortIndex: 2, isActive: true },
      ],
    });
    const ordered = await prisma.room.findMany({
      where: { isActive: true },
      orderBy: [{ calendarSortIndex: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const ids = ordered.map((r) => r.id);
    const reordered = [ids[2]!, ids[0]!, ids[1]!];

    const res = await PATCH_REORDER(
      new NextRequest("http://localhost/api/rooms/reorder", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ orderedRoomIds: reordered }),
      }),
    );
    expect(res.status).toBe(200);

    const after = await prisma.room.findMany({
      where: { isActive: true },
      orderBy: [{ calendarSortIndex: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect(after.map((r) => r.id)).toEqual(reordered);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "room_calendar_sort.reorder", entityType: "room_calendar_sort" },
    });
    expect(audit).toBeTruthy();
    expect(audit!.userId).toBe(actor.id);
    expect((audit!.beforeJson as { roomIds: string[] }).roomIds).toEqual(ids);
    expect((audit!.afterJson as { roomIds: string[] }).roomIds).toEqual(reordered);
  });
});
