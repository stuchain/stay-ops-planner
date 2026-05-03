import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "./cookieJar";

const email = "bruteforce-test@example.com";
const password = "correct-password-123";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://stayops:stayops@localhost:5432/stayops_test";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "rate_limit_counters",
      "login_attempts",
      "idempotency_keys",
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

describe("auth login brute-force", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../src/app/api/auth/login/route.ts")).POST;
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

  it("returns 429 RATE_LIMITED after too many failed attempts for one email", async () => {
    const jar = new CookieJar();
    const body = () =>
      JSON.stringify({
        email,
        password: "wrong-password",
      });

    for (let i = 0; i < 5; i += 1) {
      const res = await POST_LOGIN(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" },
          body: body(),
        }),
      );
      expect(res.status).toBe(401);
    }

    const blocked = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" },
        body: body(),
      }),
    );
    expect(blocked.status).toBe(429);
    const json = (await blocked.json()) as { error: { code: string } };
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(blocked.headers.get("Retry-After")).toBeTruthy();

    await prisma.loginAttempt.deleteMany({ where: { email: email.toLowerCase() } });

    const ok = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(ok.status).toBe(200);
  });

  it("returns 429 after too many failures from one IP across different emails", async () => {
    const hdr = { "content-type": "application/json", "x-forwarded-for": "203.0.113.99" };
    for (let i = 0; i < 10; i += 1) {
      const res = await POST_LOGIN(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ email: `nope-${i}@example.com`, password: "x" }),
        }),
      );
      expect(res.status).toBe(401);
    }

    const blocked = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: hdr,
        body: JSON.stringify({ email: "nope-11@example.com", password: "x" }),
      }),
    );
    expect(blocked.status).toBe(429);
  });
});
