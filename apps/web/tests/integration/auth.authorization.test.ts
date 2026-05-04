import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CookieJar } from "./cookieJar";
import { resolveApiPolicy } from "../../src/modules/auth/rbac";

const password = "password1234";

describe("auth.authorization matrix", () => {
  let POST_LOGIN: (req: Request) => Promise<Response>;
  let GET_SYNC_RUNS: (req: NextRequest) => Promise<Response>;
  let GET_ADMIN_TEMPLATES: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    POST_LOGIN = (await import("../../src/app/api/auth/login/route")).POST;
    GET_SYNC_RUNS = (await import("../../src/app/api/sync/runs/route")).GET;
    GET_ADMIN_TEMPLATES = (await import("../../src/app/api/admin/config/templates/route")).GET;
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: ["alice@authz.test", "bob@authz.test", "admin@authz.test"] } },
    });
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: "alice@authz.test", passwordHash, isActive: true, role: "viewer" },
    });
    await prisma.user.create({
      data: { email: "bob@authz.test", passwordHash, isActive: true, role: "operator" },
    });
    await prisma.user.create({
      data: { email: "admin@authz.test", passwordHash, isActive: true, role: "admin" },
    });
  });

  async function loginAs(email: string): Promise<CookieJar> {
    const jar = new CookieJar();
    const res = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user: { role: string } } };
    expect(body.data.user.role).toBeTruthy();
    jar.applySetCookieHeader(res);
    return jar;
  }

  it("resolveApiPolicy matches routes", () => {
    expect(resolveApiPolicy("POST", "/api/sync/hosthub/webhook")).toEqual([]);
    expect(resolveApiPolicy("GET", "/api/sync/runs")).toEqual(["operator", "admin"]);
    expect(resolveApiPolicy("GET", "/api/admin/config/templates")).toEqual(["admin"]);
    expect(resolveApiPolicy("GET", "/api/assets/channel-logo/airbnb")).toEqual(["viewer", "operator", "admin"]);
  });

  it("sync runs: viewer gets FORBIDDEN, operator gets 200", async () => {
    const viewerJar = await loginAs("alice@authz.test");
    const denied = await GET_SYNC_RUNS(
      new NextRequest("http://localhost/api/sync/runs", {
        headers: { cookie: viewerJar.getCookieHeader(), "x-request-id": "req-authz-viewer-sync" },
      }),
    );
    expect(denied.status).toBe(403);
    const rid = denied.headers.get("x-request-id");
    expect(rid).toBe("req-authz-viewer-sync");
    const deniedJson = (await denied.json()) as { error: { code: string; message: string; traceId: string } };
    expect(deniedJson.error.code).toBe("FORBIDDEN");
    expect(deniedJson.error.traceId).toBe(rid);

    const operatorJar = await loginAs("bob@authz.test");
    const allowed = await GET_SYNC_RUNS(
      new NextRequest("http://localhost/api/sync/runs", { headers: { cookie: operatorJar.getCookieHeader() } }),
    );
    expect(allowed.status).toBe(200);
  });

  it("admin templates: operator gets FORBIDDEN, admin gets 200", async () => {
    const operatorJar = await loginAs("bob@authz.test");
    const denied = await GET_ADMIN_TEMPLATES(
      new NextRequest("http://localhost/api/admin/config/templates", { headers: { cookie: operatorJar.getCookieHeader() } }),
    );
    expect(denied.status).toBe(403);
    const deniedJson = (await denied.json()) as { error: { code: string; traceId: string } };
    expect(deniedJson.error.code).toBe("FORBIDDEN");
    expect(deniedJson.error.traceId).toBeTruthy();
    expect(denied.headers.get("x-request-id")).toBeTruthy();

    const adminJar = await loginAs("admin@authz.test");
    const allowed = await GET_ADMIN_TEMPLATES(
      new NextRequest("http://localhost/api/admin/config/templates", { headers: { cookie: adminJar.getCookieHeader() } }),
    );
    expect(allowed.status).toBe(200);
  });
});
