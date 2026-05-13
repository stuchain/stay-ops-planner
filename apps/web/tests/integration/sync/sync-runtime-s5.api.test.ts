import type { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest as NextRequestCtor } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const operatorEmail = "s5-sync@example.com";
const adminEmail = "s5-admin@example.com";
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

describe("S5 sync runtime (cron + heartbeat debounce)", () => {
  const prisma = new PrismaClient();
  let GET_CRON: (request: NextRequest) => Promise<Response>;
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let PUT_HOSTHUB_TOKEN: (request: NextRequest) => Promise<Response>;
  let POST_RECONCILE: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    process.env.CRON_SECRET = "0123456789abcdef0123456789abcdef";
    GET_CRON = (await import("../../../src/app/api/cron/sync-hosthub/route")).GET;
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    PUT_HOSTHUB_TOKEN = (await import("../../../src/app/api/admin/integrations/hosthub/token/route")).PUT;
    POST_RECONCILE = (await import("../../../src/app/api/sync/hosthub/reconcile/route")).POST;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await truncate(prisma);
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, operatorEmail] } },
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

  it("cron GET returns 401 without Authorization", async () => {
    const res = await GET_CRON(new NextRequestCtor("http://localhost/api/cron/sync-hosthub"));
    expect(res.status).toBe(401);
  });

  it("cron GET returns 401 for wrong Bearer token", async () => {
    const res = await GET_CRON(
      new NextRequestCtor("http://localhost/api/cron/sync-hosthub", {
        headers: { authorization: "Bearer wrong-token-not-matching-secret-at-all" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("cron GET skips outside daytime window (Etc/UTC)", async () => {
    process.env.APP_TIMEZONE = "Etc/UTC";
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2024-06-15T04:00:00.000Z"));

    const res = await GET_CRON(
      new NextRequestCtor("http://localhost/api/cron/sync-hosthub", {
        headers: { authorization: "Bearer 0123456789abcdef0123456789abcdef" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { status: string; reason: string } };
    expect(json.data.status).toBe("skipped");
    expect(json.data.reason).toBe("outside_daytime_window");
  });

  it("cron GET runs reconcile inside daytime window", async () => {
    process.env.APP_TIMEZONE = "Etc/UTC";
    const adminJar = await loginJar(adminEmail);
    const saveTokenRes = await PUT_HOSTHUB_TOKEN(
      new NextRequestCtor("http://localhost/api/admin/integrations/hosthub/token", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminJar.getCookieHeader(),
        },
        body: JSON.stringify({ token: "dummy-token-cron-run" }),
      }),
    );
    expect(saveTokenRes.status).toBe(200);

    const syncMod = await import("@stay-ops/sync");
    const spy = vi.spyOn(syncMod, "runHosthubReconcile").mockResolvedValue(undefined as never);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    try {
      const res = await GET_CRON(
        new NextRequestCtor("http://localhost/api/cron/sync-hosthub", {
          headers: { authorization: "Bearer 0123456789abcdef0123456789abcdef" },
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: { status: string } };
      expect(json.data.status).toBe("completed");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("debounces second heartbeat reconcile within the debounce window", async () => {
    process.env.SYNC_HEARTBEAT_DEBOUNCE_MS = "60000";
    const adminJar = await loginJar(adminEmail);
    const saveTokenRes = await PUT_HOSTHUB_TOKEN(
      new NextRequestCtor("http://localhost/api/admin/integrations/hosthub/token", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminJar.getCookieHeader(),
        },
        body: JSON.stringify({ token: "dummy-token-heartbeat" }),
      }),
    );
    expect(saveTokenRes.status).toBe(200);

    const syncMod = await import("@stay-ops/sync");
    const spy = vi.spyOn(syncMod, "runHosthubReconcile").mockResolvedValue(undefined as never);

    try {
      const operatorJar = await loginJar(operatorEmail);
      const headers = {
        cookie: operatorJar.getCookieHeader(),
        "X-StayOps-Sync-Trigger": "heartbeat",
      };

      const first = await POST_RECONCILE(
        new NextRequestCtor("http://localhost/api/sync/hosthub/reconcile", { method: "POST", headers }),
      );
      expect(first.status).toBe(200);

      const second = await POST_RECONCILE(
        new NextRequestCtor("http://localhost/api/sync/hosthub/reconcile", { method: "POST", headers }),
      );
      expect(second.status).toBe(200);
      const body = (await second.json()) as { data: { status: string; reason: string } };
      expect(body.data.status).toBe("skipped");
      expect(body.data.reason).toBe("debounced");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
