import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const operatorEmail = "audit-export-op@example.com";
const viewerEmail = "audit-export-view@example.com";
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

describe("api GET /api/audit/export", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_EXPORT: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    GET_EXPORT = (await import("../../../src/app/api/audit/export/route")).GET;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: operatorEmail, passwordHash, isActive: true, role: "operator" },
    });
    await prisma.user.create({
      data: { email: viewerEmail, passwordHash, isActive: true, role: "viewer" },
    });
  });

  async function loginJar(emailAddr: string): Promise<CookieJar> {
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email: emailAddr, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    return jar;
  }

  it("returns 401 without session", async () => {
    const res = await GET_EXPORT(
      new NextRequest("http://localhost/api/audit/export?from=2020-01-01&to=2020-01-02&format=ndjson"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for viewer", async () => {
    const jar = await loginJar(viewerEmail);
    const res = await GET_EXPORT(
      new NextRequest("http://localhost/api/audit/export?from=2020-01-01&to=2020-01-02&format=ndjson", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 422 when date span exceeds cap", async () => {
    const jar = await loginJar(operatorEmail);
    const res = await GET_EXPORT(
      new NextRequest("http://localhost/api/audit/export?from=2020-01-01&to=2022-01-01&format=ndjson", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(422);
  });

  it("streams NDJSON header and events for operator", async () => {
    const jar = await loginJar(operatorEmail);
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: operatorEmail } });

    await prisma.auditEvent.create({
      data: {
        userId: actor.id,
        entityType: "assignment",
        entityId: "asg-exp",
        action: "assignment.assign",
        beforeJson: Prisma.JsonNull,
        afterJson: { roomId: "room-x" },
        metaJson: { bookingId: "b-exp" },
        createdAt: new Date("2024-03-01T12:00:00.000Z"),
      },
    });

    const res = await GET_EXPORT(
      new NextRequest("http://localhost/api/audit/export?from=2024-01-01&to=2024-06-30&format=ndjson", {
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("ndjson");

    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const header = JSON.parse(lines[0]!) as { type: string; schemaVersion: number };
    expect(header.type).toBe("audit_export_header");
    expect(header.schemaVersion).toBe(1);
    const ev = JSON.parse(lines[1]!) as { action: string; entityId: string };
    expect(ev.action).toBe("assignment.assign");
    expect(ev.entityId).toBe("asg-exp");
  });
});
