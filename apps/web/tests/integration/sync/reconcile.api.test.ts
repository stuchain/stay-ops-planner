import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const email = "sync-api@example.com";
const password = "password1234";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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
      "rooms",
      "users"
    RESTART IDENTITY CASCADE;
  `);
}

describe("api /api/sync/hosthub/reconcile", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let PUT_HOSTHUB_TOKEN: (request: NextRequest) => Promise<Response>;
  let POST_RECONCILE: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    PUT_HOSTHUB_TOKEN = (await import("../../../src/app/api/admin/integrations/hosthub/token/route.ts")).PUT;
    POST_RECONCILE = (await import("../../../src/app/api/sync/hosthub/reconcile/route.ts")).POST;
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
    const res = await POST_RECONCILE(new NextRequest("http://localhost/api/sync/hosthub/reconcile", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when token is not configured", async () => {
    const jar = await loginJar();
    const res = await POST_RECONCILE(
      new NextRequest("http://localhost/api/sync/hosthub/reconcile", {
        method: "POST",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("returns 202 when a hosthub poll run is already in progress", async () => {
    const jar = await loginJar();

    const saveTokenRes = await PUT_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ token: "dummy-token-for-test" }),
      }),
    );
    expect(saveTokenRes.status).toBe(200);

    await prisma.syncRun.create({
      data: {
        source: "hosthub_poll",
        status: "running",
        startedAt: new Date(),
      },
    });

    const res = await POST_RECONCILE(
      new NextRequest("http://localhost/api/sync/hosthub/reconcile", {
        method: "POST",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(202);
  });
});
