import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "excel-rental-audit@example.com";
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
      "excel_ledger_entries",
      "excel_rental_config",
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

describe("api PATCH /api/excel/rental-config audit", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let PATCH_RENTAL: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    PATCH_RENTAL = (await import("../../../src/app/api/excel/rental-config/route")).PATCH;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { email, passwordHash, isActive: true, role: "operator" } });
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

  it("writes excel_rental_config.update audit", async () => {
    const jar = await loginJar();
    const actor = await prisma.user.findUniqueOrThrow({ where: { email } });

    const res = await PATCH_RENTAL(
      new NextRequest("http://localhost/api/excel/rental-config", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ index: 1, label: "CustomCol" }),
      }),
    );
    expect(res.status).toBe(200);

    const logs = await prisma.auditEvent.findMany({
      where: { entityType: "excel_rental_config", action: "excel_rental_config.update" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.userId).toBe(actor.id);
    expect((logs[0]!.afterJson as { label1: string }).label1).toBe("CustomCol");
  });
});
