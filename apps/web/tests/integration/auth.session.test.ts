import { describe, expect, it, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "./cookieJar";

const email = "admin@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

describe("auth.session", () => {
  const prisma = new PrismaClient();

  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_ME: (request: Request) => Promise<Response>;
  let POST_LOGOUT: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, isActive: true },
      create: { email, passwordHash, isActive: true },
    });

    const loginModule = await import("../../src/app/api/auth/login/route");
    const meModule = await import("../../src/app/api/auth/me/route");
    const logoutModule = await import(
      "../../src/app/api/auth/logout/route"
    );

    POST_LOGIN = loginModule.POST;
    GET_ME = meModule.GET;
    POST_LOGOUT = logoutModule.POST;
  });

  it("login -> me -> logout clears cookie -> me is unauthorized", async () => {
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

    const meRes1 = await GET_ME(
      new Request("http://localhost/api/auth/me", {
        method: "GET",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(meRes1.status).toBe(200);

    const logoutRes = await POST_LOGOUT(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: jar.getCookieHeader(),
        },
      }),
    );
    expect(logoutRes.status).toBe(204);
    jar.applySetCookieHeader(logoutRes);
    expect(jar.getCookieHeader()).toBe("");

    const meRes2 = await GET_ME(
      new Request("http://localhost/api/auth/me", {
        method: "GET",
        headers: { cookie: jar.getCookieHeader() },
      }),
    );
    expect(meRes2.status).toBe(401);
    const json = (await meRes2.json()) as any;
    expect(json.error.code).toBe("UNAUTHORIZED");
  });
});

