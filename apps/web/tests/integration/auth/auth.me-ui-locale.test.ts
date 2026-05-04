import { describe, expect, it, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "locale-patch@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops_test";

/**
 * Requires `stayops_test` migrated through `20260503140000_user_ui_locale`
 * (`pnpm --filter @stay-ops/db exec prisma migrate deploy` with TEST_DATABASE_URL).
 */
describe("auth.me ui locale", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let GET_ME: (request: Request) => Promise<Response>;
  let PATCH_ME: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, isActive: true, uiLocale: "en" },
      create: { email, passwordHash, isActive: true, uiLocale: "en" },
    });

    const loginModule = await import("../../../src/app/api/auth/login/route");
    const meModule = await import("../../../src/app/api/auth/me/route");
    POST_LOGIN = loginModule.POST;
    GET_ME = meModule.GET;
    PATCH_ME = meModule.PATCH;
  });

  it("GET /api/auth/me includes uiLocale and PATCH persists", async () => {
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

    const me1 = await GET_ME(
      new Request("http://localhost/api/auth/me", { headers: { cookie: jar.getCookieHeader() } }),
    );
    expect(me1.status).toBe(200);
    const j1 = (await me1.json()) as { data: { user: { uiLocale: string } } };
    expect(j1.data.user.uiLocale).toBe("en");

    const patchRes = await PATCH_ME(
      new Request("http://localhost/api/auth/me", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ uiLocale: "el" }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const jPatch = (await patchRes.json()) as { data: { user: { uiLocale: string } } };
    expect(jPatch.data.user.uiLocale).toBe("el");

    const row = await prisma.user.findUnique({ where: { email }, select: { uiLocale: true } });
    expect(row?.uiLocale).toBe("el");

    await prisma.user.update({ where: { email }, data: { uiLocale: "en" } });
  });
});
