import { describe, expect, it, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "./cookieJar";

const email = "admin@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

describe("auth.login", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_ME: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, isActive: true },
      create: { email, passwordHash, isActive: true },
    });

    const loginModule = await import("../../src/app/api/auth/login/route.ts");
    const meModule = await import("../../src/app/api/auth/me/route.ts");
    POST_LOGIN = loginModule.POST;
    GET_ME = meModule.GET;
  });

  it("sets a session cookie and /api/auth/me returns the user", async () => {
    const jar = new CookieJar();

    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ email, password }),
      }),
    );

    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    expect(jar.getCookieHeader()).toContain("stay_ops_session=");

    const meRes = await GET_ME(
      new Request("http://localhost/api/auth/me", {
        method: "GET",
        headers: {
          cookie: jar.getCookieHeader(),
        },
      }),
    );

    expect(meRes.status).toBe(200);
    const json = (await meRes.json()) as { data: { user: { email: string } } };
    expect(json.data.user.email).toBe(email);
  });

  it("accepts login when submitted email casing differs from the stored row", async () => {
    const storedEmail = "CaSeTest-Login@example.com";
    const submittedEmail = "casetest-login@example.com";
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email: storedEmail },
      update: { passwordHash, isActive: true },
      create: { email: storedEmail, passwordHash, isActive: true },
    });

    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: submittedEmail, password }),
      }),
    );

    expect(loginRes.status).toBe(200);
    const json = (await loginRes.json()) as { data: { user: { email: string } } };
    expect(json.data.user.email).toBe(storedEmail);
  });
});

