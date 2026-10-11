import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import type { NextRequest } from "next/server";
import { NextRequest as NextRequestClass } from "next/server";
import { CookieJar } from "./cookieJar";

const email = "admin@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

describe("auth.middleware", () => {
  const prisma = new PrismaClient();

  let middlewareFn: (request: NextRequest) => Response;
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_LOGOUT: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();

    const middlewareModule = await import("../../src/middleware");
    middlewareFn = middlewareModule.middleware;

    const loginModule = await import("../../src/app/api/auth/login/route");
    const logoutModule = await import(
      "../../src/app/api/auth/logout/route"
    );
    POST_LOGIN = loginModule.POST;
    POST_LOGOUT = logoutModule.POST;
  });

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, isActive: true, role: "admin" },
      create: { email, passwordHash, isActive: true, role: "admin" },
    });
  });

  it("returns JSON 401 for protected API routes without a session", async () => {
    const req = new NextRequestClass("http://localhost/api/auth/me", {
      method: "GET",
      headers: new Headers(),
    });

    const res = middlewareFn(req);
    expect(res.status).toBe(401);

    const rid = res.headers.get("x-request-id");
    expect(rid).toBeTruthy();
    const json = (await res.json()) as { error: { code: string; message: string; traceId: string } };
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(json.error.message).toBe("Authentication required");
    expect(json.error.traceId).toBe(rid);
  });

  it("lets the scheduled /api/cron/* jobs through without a session (they check CRON_SECRET themselves)", () => {
    for (const path of ["/api/cron/sync-hosthub", "/api/cron/health-alerts", "/api/cron/daily-reminders"]) {
      const res = middlewareFn(new NextRequestClass(`http://localhost${path}`, { method: "GET" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
    const post = middlewareFn(new NextRequestClass("http://localhost/api/cron/health-alerts", { method: "POST" }));
    expect(post.status).toBe(401);
  });

  it("redirects /app/* to login when unauthenticated", async () => {
    const req = new NextRequestClass("http://localhost/app/dashboard", {
      method: "GET",
      headers: new Headers(),
    });

    const res = middlewareFn(req);
    expect([301, 302, 303, 307, 308].includes(res.status)).toBe(true);

    const location = res.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fapp%2Fdashboard");
  });

  it("rejects middleware-protected APIs after logout clears the cookie", async () => {
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

    const req = new NextRequestClass("http://localhost/api/auth/me", {
      method: "GET",
      headers: new Headers({
        cookie: jar.getCookieHeader(),
      }),
    });

    const res = middlewareFn(req);
    expect(res.status).toBe(401);
  });
});

