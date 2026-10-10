/**
 * P2-4: preferences, password change, Dev mode switch, session version and the Hosthub banner condition.
 */
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@stay-ops/db";
import { createCaller } from "@/server/api/root";
import { domainErrorShape } from "@/server/api/trpc";
import { createSessionToken, verifySessionToken } from "@/modules/auth/session";
import { verifyAndLoadAuthContext } from "@/modules/auth/guard";
import { classifySyncError, getSyncStatus } from "@/server/useCases/syncStatus";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const prisma = new PrismaClient();
const OLD = "old-password-123";

const ids: Record<string, string> = {};

function as(role: "viewer" | "operator" | "admin", userId: string) {
  return createCaller({ headers: new Headers(), user: { userId, role, sessionExpiresAt: new Date(Date.now() + 1e6) } });
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    return { http: (err as { code: string }).code, domain: domainErrorShape(err as never) };
  }
  throw new Error("expected a failure");
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(OLD, 4);
  for (const role of ["admin", "operator"] as const) {
    const u = await prisma.user.upsert({
      where: { email: `p24-${role}@example.com` },
      update: {
        passwordHash,
        role,
        isActive: true,
        sessionVersion: 0,
        devMode: false,
        uiLocale: "el",
        textSize: "normal",
      },
      create: { email: `p24-${role}@example.com`, passwordHash, role, isActive: true },
    });
    ids[role] = u.id;
  }
});

afterAll(async () => {
  await prisma.syncState.updateMany({ where: { id: 1 }, data: { lastError: null } });
  await prisma.$disconnect();
});

describe("me.updatePreferences", () => {
  it("saves language and text size, and only the fields sent", async () => {
    const caller = as("operator", ids.operator!);
    await caller.me.updatePreferences({ locale: "en" });
    expect(
      await prisma.user.findUnique({ where: { id: ids.operator! }, select: { uiLocale: true, textSize: true } }),
    ).toEqual({
      uiLocale: "en",
      textSize: "normal",
    });
    await caller.me.updatePreferences({ textSize: "xlarge" });
    const row = await prisma.user.findUnique({
      where: { id: ids.operator! },
      select: { uiLocale: true, textSize: true },
    });
    expect(row).toEqual({ uiLocale: "en", textSize: "xlarge" });
    expect((await caller.me.get()).textSize).toBe("xlarge");
  });
});

describe("me.changePassword", () => {
  it("refuses a wrong current password with a Greek-translatable code", async () => {
    const f = await failure(
      as("operator", ids.operator!).me.changePassword({ currentPassword: "nope", newPassword: "brand-new-pass" }),
    );
    expect(f.domain.code).toBe("WRONG_PASSWORD");
    expect(f.http).toBe("BAD_REQUEST");
  });

  it("refuses a too-short new password", async () => {
    const f = await failure(
      as("operator", ids.operator!).me.changePassword({ currentPassword: OLD, newPassword: "short" }),
    );
    expect(f.domain.code).toBe("PASSWORD_TOO_SHORT");
  });

  it("changes the password when the current one matches", async () => {
    await as("operator", ids.operator!).me.changePassword({ currentPassword: OLD, newPassword: "brand-new-pass" });
    const row = await prisma.user.findUnique({ where: { id: ids.operator! }, select: { passwordHash: true } });
    expect(await bcrypt.compare("brand-new-pass", row!.passwordHash)).toBe(true);
  });
});

describe("me.setDevMode", () => {
  it("is refused for a non-admin and saved for an admin", async () => {
    const f = await failure(as("operator", ids.operator!).me.setDevMode({ enabled: true }));
    expect(f.http).toBe("FORBIDDEN");
    expect((await prisma.user.findUnique({ where: { id: ids.operator! } }))!.devMode).toBe(false);

    await as("admin", ids.admin!).me.setDevMode({ enabled: true });
    expect((await prisma.user.findUnique({ where: { id: ids.admin! } }))!.devMode).toBe(true);
  });
});

describe("sessionVersion", () => {
  it("rejects sessions older than the stored version after signOutEverywhere", async () => {
    const token = createSessionToken(ids.operator!, "operator", Date.now(), 0).token;
    expect(verifySessionToken(token)?.sessionVersion).toBe(0);
    expect(await verifyAndLoadAuthContext(token)).not.toBeNull();

    await as("admin", ids.admin!).admin.signOutEverywhere({ userId: ids.operator! });

    expect(await verifyAndLoadAuthContext(token)).toBeNull();
    const fresh = createSessionToken(ids.operator!, "operator", Date.now(), 1).token;
    expect(await verifyAndLoadAuthContext(fresh)).not.toBeNull();
  });

  it("is admin-only", async () => {
    const f = await failure(as("operator", ids.operator!).admin.signOutEverywhere({ userId: ids.admin! }));
    expect(f.http).toBe("FORBIDDEN");
  });
});

describe("Hosthub banner condition", () => {
  it("is 'auth' only when the last sync was refused", async () => {
    expect(classifySyncError(null)).toBe("none");
    expect(classifySyncError("HOSTHUB_AUTH_FAILED: bad key")).toBe("auth");
    expect(classifySyncError("HOSTHUB_HTTP: client error: 403 Forbidden")).toBe("auth");
    expect(classifySyncError("HOSTHUB_NETWORK: timeout")).toBe("other");

    await prisma.syncState.upsert({
      where: { id: 1 },
      create: { id: 1, lastError: "HOSTHUB_AUTH_FAILED: x" },
      update: { lastError: "HOSTHUB_AUTH_FAILED: x" },
    });
    expect((await getSyncStatus()).problem).toBe("auth");
    await prisma.syncState.update({ where: { id: 1 }, data: { lastError: null } });
    expect((await getSyncStatus()).problem).toBe("none");
  });
});
