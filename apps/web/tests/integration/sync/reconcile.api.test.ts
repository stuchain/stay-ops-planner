import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const operatorEmail = "sync-api@example.com";
const adminEmail = "sync-admin@example.com";
const password = "password1234";

async function truncate(prisma: PrismaClient) {
  // Do not truncate `users` — other integration files share the same DB and rely on seeded accounts.
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
      "rooms"
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
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, operatorEmail, "sync-viewer@example.com"] } },
    });
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: adminEmail, passwordHash, isActive: true, role: "admin" },
    });
    await prisma.user.create({
      data: { email: operatorEmail, passwordHash, isActive: true, role: "operator" },
    });
  });

  async function loginJar(email: string): Promise<CookieJar> {
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

  it("returns 403 for viewer", async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: "sync-viewer@example.com", passwordHash, isActive: true, role: "viewer" },
    });
    const jar = await loginJar("sync-viewer@example.com");
    const res = await POST_RECONCILE(
      new NextRequest("http://localhost/api/sync/hosthub/reconcile", {
        method: "POST",
        headers: { cookie: jar.getCookieHeader(), "x-request-id": "req-reconcile-viewer" },
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string; traceId: string } };
    expect(json.error.code).toBe("FORBIDDEN");
    expect(json.error.traceId).toBeTruthy();
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns 503 when token is not configured", async () => {
    const jar = await loginJar(operatorEmail);
    const res = await POST_RECONCILE(
      new NextRequest("http://localhost/api/sync/hosthub/reconcile", {
        method: "POST",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("returns 202 when a hosthub poll run is already in progress", async () => {
    const adminJar = await loginJar(adminEmail);
    const saveTokenRes = await PUT_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminJar.getCookieHeader(),
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

    const operatorJar = await loginJar(operatorEmail);
    const res = await POST_RECONCILE(
      new NextRequest("http://localhost/api/sync/hosthub/reconcile", {
        method: "POST",
        headers: { cookie: operatorJar.getCookieHeader() },
      }),
    );
    expect(res.status).toBe(202);
  });
});
