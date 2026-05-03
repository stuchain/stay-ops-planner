import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from "../../src/modules/auth/session";

const email = "session-abs@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://stayops:stayops@localhost:5432/stayops_test";

describe("session absolute expiry (Epic 7)", () => {
  const prisma = new PrismaClient();
  let GET_ME: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    GET_ME = (await import("../../src/app/api/auth/me/route.ts")).GET;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "login_attempts", "rate_limit_counters", "idempotency_keys", "audit_events", "users" RESTART IDENTITY CASCADE;
    `);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email, passwordHash, isActive: true, role: "operator" },
    });
  });

  it("rejects token past absolute expiry (aexp)", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const past = Date.now() - 13 * 60 * 60 * 1000;
    const { token } = createSessionToken(user.id, "operator", past);
    expect(verifySessionToken(token)).toBeNull();

    const res = await GET_ME(
      new Request("http://localhost/api/auth/me", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
    );
    expect(res.status).toBe(401);
  });
});
