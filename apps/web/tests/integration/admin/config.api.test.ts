import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const email = "admin-config@example.com";
const password = "password1234";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
      "audit_events",
      "alert_template_configs",
      "operational_threshold_configs",
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

describe("api /api/admin/config", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_TEMPLATES: (request: NextRequest) => Promise<Response>;
  let POST_TEMPLATES: (request: NextRequest) => Promise<Response>;
  let PATCH_TEMPLATE: (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  let GET_THRESHOLDS: (request: NextRequest) => Promise<Response>;
  let POST_THRESHOLDS: (request: NextRequest) => Promise<Response>;
  let PATCH_THRESHOLD: (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    GET_TEMPLATES = (await import("../../../src/app/api/admin/config/templates/route")).GET;
    POST_TEMPLATES = (await import("../../../src/app/api/admin/config/templates/route")).POST;
    PATCH_TEMPLATE = (await import("../../../src/app/api/admin/config/templates/[id]/route")).PATCH;
    GET_THRESHOLDS = (await import("../../../src/app/api/admin/config/thresholds/route")).GET;
    POST_THRESHOLDS = (await import("../../../src/app/api/admin/config/thresholds/route")).POST;
    PATCH_THRESHOLD = (await import("../../../src/app/api/admin/config/thresholds/[id]/route")).PATCH;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { email, passwordHash, isActive: true, role: "admin" } });
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

  it("requires auth for template list", async () => {
    const res = await GET_TEMPLATES(new NextRequest("http://localhost/api/admin/config/templates"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator on admin template list", async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: "operator-only@example.com", passwordHash, isActive: true, role: "operator" },
    });
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email: "operator-only@example.com", password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    const res = await GET_TEMPLATES(
      new NextRequest("http://localhost/api/admin/config/templates", { headers: { cookie: jar.getCookieHeader() } }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string; traceId: string } };
    expect(json.error.code).toBe("FORBIDDEN");
    expect(json.error.traceId).toBeTruthy();
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("supports template create/list/update", async () => {
    const jar = await loginJar();
    const createRes = await POST_TEMPLATES(
      new NextRequest("http://localhost/api/admin/config/templates", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
          "x-request-id": "req-template-create",
        },
        body: JSON.stringify({
          eventType: "cleaning_overdue",
          channel: "sms",
          templateVersion: 1,
          title: "Cleaning overdue",
          body: "Task {{taskId}} overdue",
          enabled: true,
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string; title: string } };
    expect(created.data.title).toBe("Cleaning overdue");

    const listRes = await GET_TEMPLATES(
      new NextRequest("http://localhost/api/admin/config/templates", { headers: { cookie: jar.getCookieHeader() } }),
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listed.data.some((row) => row.id === created.data.id)).toBe(true);

    const patchRes = await PATCH_TEMPLATE(
      new NextRequest(`http://localhost/api/admin/config/templates/${created.data.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ title: "Cleaning overdue v2" }),
      }),
      { params: Promise.resolve({ id: created.data.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { data: { title: string } };
    expect(patched.data.title).toBe("Cleaning overdue v2");
  });

  it("supports threshold create/list/update", async () => {
    const jar = await loginJar();
    const createRes = await POST_THRESHOLDS(
      new NextRequest("http://localhost/api/admin/config/thresholds", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({
          key: "unassigned_backlog_count",
          numericValue: 10,
          unit: "bookings",
          notes: "ops baseline",
          enabled: true,
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string; numericValue: string } };
    expect(created.data.numericValue).toBe("10");

    const listRes = await GET_THRESHOLDS(
      new NextRequest("http://localhost/api/admin/config/thresholds", { headers: { cookie: jar.getCookieHeader() } }),
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listed.data.some((row) => row.id === created.data.id)).toBe(true);

    const patchRes = await PATCH_THRESHOLD(
      new NextRequest(`http://localhost/api/admin/config/thresholds/${created.data.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ numericValue: 14 }),
      }),
      { params: Promise.resolve({ id: created.data.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { data: { numericValue: string } };
    expect(patched.data.numericValue).toBe("14");
  });
});
