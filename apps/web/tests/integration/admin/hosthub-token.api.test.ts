import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const operatorEmail = "hosthub-token-op@example.com";
const viewerEmail = "hosthub-token-viewer@example.com";
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

describe("api /api/admin/integrations/hosthub/token", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_HOSTHUB_TOKEN: (request: NextRequest) => Promise<Response>;
  let PUT_HOSTHUB_TOKEN: (request: NextRequest) => Promise<Response>;
  let DELETE_HOSTHUB_TOKEN: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    GET_HOSTHUB_TOKEN = (await import("../../../src/app/api/admin/integrations/hosthub/token/route")).GET;
    PUT_HOSTHUB_TOKEN = (await import("../../../src/app/api/admin/integrations/hosthub/token/route")).PUT;
    DELETE_HOSTHUB_TOKEN = (await import("../../../src/app/api/admin/integrations/hosthub/token/route")).DELETE;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
    await prisma.user.deleteMany({
      where: { email: { in: [operatorEmail, viewerEmail] } },
    });
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: operatorEmail, passwordHash, isActive: true, role: "operator" },
    });
    await prisma.user.create({
      data: { email: viewerEmail, passwordHash, isActive: true, role: "viewer" },
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

  it("operator can PUT then GET token status, then DELETE clears it", async () => {
    const jar = await loginJar(operatorEmail);

    const putRes = await PUT_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ token: "integration-test-hosthub-token", name: "test-label" }),
      }),
    );
    expect(putRes.status).toBe(200);
    const putJson = (await putRes.json()) as { data: { configured: boolean; name: string | null } };
    expect(putJson.data.configured).toBe(true);
    expect(putJson.data.name).toBe("test-label");

    const getRes = await GET_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "GET",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as { data: { configured: boolean; name: string | null } };
    expect(getJson.data.configured).toBe(true);
    expect(getJson.data.name).toBe("test-label");

    const delRes = await DELETE_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "DELETE",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(delRes.status).toBe(200);
    const delJson = (await delRes.json()) as { data: { configured: boolean } };
    expect(delJson.data.configured).toBe(false);

    const getAfter = await GET_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "GET",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(getAfter.status).toBe(200);
    const afterJson = (await getAfter.json()) as { data: { configured: boolean } };
    expect(afterJson.data.configured).toBe(false);
  });

  it("viewer is forbidden on GET, PUT, and DELETE", async () => {
    const jar = await loginJar(viewerEmail);

    const getRes = await GET_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "GET",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(getRes.status).toBe(403);

    const putRes = await PUT_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ token: "should-not-save" }),
      }),
    );
    expect(putRes.status).toBe(403);

    const delRes = await DELETE_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "DELETE",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(delRes.status).toBe(403);
  });
});
