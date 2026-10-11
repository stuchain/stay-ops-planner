/**
 * P2-6: Dev mode History, Users and System against a real database.
 */
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const prisma = new PrismaClient();
type Role = "admin" | "operator" | "viewer";

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "login_attempts", "audit_events", "assignments", "bookings", "rooms", "source_listings", "users"
    RESTART IDENTITY CASCADE;
  `);
}

async function makeUser(email: string, role: Role = "operator", flags: object = {}) {
  return prisma.user.create({
    data: { email, role, passwordHash: await bcrypt.hash("old-password-1", 4), flags },
  });
}

async function api(userId: string, role: Role = "admin") {
  const { createCaller } = await import("@/server/api/root");
  return createCaller({ headers: new Headers(), user: { userId, role, sessionExpiresAt: new Date(Date.now() + 1e6) } });
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof DomainError) return cause.code;
    throw err;
  }
  throw new Error("expected a DomainError");
}

async function event(data: {
  action: string;
  entityType: string;
  entityId: string;
  at: string;
  userId?: string | null;
  meta?: object;
  before?: object;
  after?: object;
}) {
  return prisma.auditEvent.create({
    data: {
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      userId: data.userId ?? null,
      createdAt: new Date(data.at),
      metaJson: data.meta ?? {},
      beforeJson: data.before ?? {},
      afterJson: data.after ?? {},
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(truncate);

describe("History: audit query", () => {
  async function seed() {
    const admin = await makeUser("admin@example.com", "admin");
    const other = await makeUser("op@example.com", "operator");
    await event({
      action: "booking.move",
      entityType: "booking",
      entityId: "b1",
      at: "2030-06-01T10:00:00Z",
      userId: admin.id,
    });
    await event({
      action: "booking.update",
      entityType: "booking",
      entityId: "b2",
      at: "2030-06-02T10:00:00Z",
      userId: other.id,
    });
    await event({
      action: "assignment.assign",
      entityType: "assignment",
      entityId: "a1",
      at: "2030-06-03T10:00:00Z",
      userId: admin.id,
      meta: { bookingId: "b1" },
    });
    await event({ action: "auth.login.failed", entityType: "auth", entityId: "hash", at: "2030-06-04T10:00:00Z" });
    return { admin, other };
  }

  it("lists newest first and counts everything", async () => {
    const { admin } = await seed();
    const res = await (await api(admin.id)).dev.history.list({ filters: {}, page: 1 });
    expect(res.total).toBe(4);
    expect(res.items.map((r) => r.entityId)).toEqual(["hash", "a1", "b2", "b1"]);
    expect(res.items[0]!.userEmail).toBeNull();
  });

  it("filters by date range, entity type, action, user and booking", async () => {
    const { admin, other } = await seed();
    const caller = await api(admin.id);
    const ids = async (filters: Parameters<typeof caller.dev.history.list>[0]["filters"]) =>
      (await caller.dev.history.list({ filters, page: 1 })).items.map((r) => r.entityId).sort();

    expect(await ids({ from: "2030-06-02", to: "2030-06-03" })).toEqual(["a1", "b2"]);
    expect(await ids({ from: "2030-06-04" })).toEqual(["hash"]);
    expect(await ids({ to: "2030-06-01" })).toEqual(["b1"]);
    expect(await ids({ entityType: "booking" })).toEqual(["b1", "b2"]);
    expect(await ids({ action: "auth.login.failed" })).toEqual(["hash"]);
    expect(await ids({ userId: other.id })).toEqual(["b2"]);
    // A booking's own changes and the placements that name it.
    expect(await ids({ bookingId: "b1" })).toEqual(["a1", "b1"]);
    expect(await ids({ entityType: "booking", userId: admin.id })).toEqual(["b1"]);
  });

  it("pages 50 at a time", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        action: "room.update",
        entityType: "room",
        entityId: `r${i}`,
        createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, i)),
      })),
    });
    const caller = await api(admin.id);
    const p1 = await caller.dev.history.list({ filters: {}, page: 1 });
    const p3 = await caller.dev.history.list({ filters: {}, page: 3 });
    expect([p1.items.length, p1.pages, p1.total]).toEqual([50, 3, 120]);
    expect(p1.items[0]!.entityId).toBe("r119");
    expect(p3.items).toHaveLength(20);
  });

  it("describes a move with the apartment names", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const a = await prisma.room.create({ data: { code: "ra", displayName: "Onar" } });
    const b = await prisma.room.create({ data: { code: "rb", displayName: "Cosmos" } });
    await event({
      action: "booking.move",
      entityType: "booking",
      entityId: "b9",
      at: "2030-06-01T10:00:00Z",
      before: { roomId: a.id },
      after: { roomId: b.id },
    });
    const res = await (await api(admin.id)).dev.history.list({ filters: {}, page: 1 });
    expect(res.items[0]!.event).toEqual({ kind: "moved", from: "Onar", to: "Cosmos" });
  });

  it("exports the filtered rows as CSV with a byte order mark and safe cells", async () => {
    const { admin } = await seed();
    await event({
      action: "booking.update",
      entityType: "booking",
      entityId: "=cmd",
      at: "2030-06-05T10:00:00Z",
      after: { guest: 'Γιώργος, "Ο" Παπά' },
    });
    const caller = await api(admin.id);
    const all = await caller.dev.history.exportCsv({ filters: {} });
    expect(all.csv.startsWith("﻿time,user,action,entity_type,entity_id,before,after,meta\r\n")).toBe(true);
    expect(all.rows).toBe(5);
    expect(all.truncated).toBe(false);
    expect(all.csv).toContain("'=cmd");
    expect(all.csv).toContain('"{""guest"":""Γιώργος, \\""Ο\\"" Παπά""}"');

    const only = await caller.dev.history.exportCsv({ filters: { entityType: "auth" } });
    expect(only.rows).toBe(1);
    expect(only.csv.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("is admin only", async () => {
    const op = await makeUser("op@example.com", "operator");
    const caller = await api(op.id, "operator");
    expect(await codeOf(caller.dev.history.list({ filters: {}, page: 1 }))).toBe("FORBIDDEN");
    expect(await codeOf(caller.dev.history.exportCsv({ filters: {} }))).toBe("FORBIDDEN");
    expect(await codeOf(caller.dev.users.list())).toBe("FORBIDDEN");
    expect(await codeOf(caller.dev.system.info())).toBe("FORBIDDEN");
  });
});

describe("Users", () => {
  it("lists users with last sign-in and lockout", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const op = await makeUser("Op@Example.com", "operator");
    await prisma.loginAttempt.create({ data: { email: "op@example.com", ip: "1.1.1.1", succeeded: true } });
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: 5 }, () => ({ email: "admin@example.com", ip: "1.1.1.1", succeeded: false })),
    });
    const { users } = await (await api(admin.id)).dev.users.list();
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
    expect(byEmail["Op@Example.com"]!.lastLoginAt).not.toBeNull();
    expect(byEmail["Op@Example.com"]!.lockedForSeconds).toBeNull();
    expect(byEmail["admin@example.com"]!.lastLoginAt).toBeNull();
    expect(byEmail["admin@example.com"]!.lockedForSeconds).toBeGreaterThan(0);
    expect(byEmail["admin@example.com"]!.lockedForSeconds).toBeLessThanOrEqual(15 * 60);
    expect(op.id).toBeTruthy();
  });

  it("sets a new password for any user, signs them out and keeps the password out of the log", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const op = await makeUser("op@example.com", "operator");
    const caller = await api(admin.id);

    expect(await codeOf(caller.dev.users.setPassword({ userId: op.id, newPassword: "short" }))).toBe(
      "PASSWORD_TOO_SHORT",
    );
    expect(await codeOf(caller.dev.users.setPassword({ userId: "nope", newPassword: "long-enough-1" }))).toBe(
      "NOT_FOUND",
    );

    await caller.dev.users.setPassword({ userId: op.id, newPassword: "brand-new-pass-1" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: op.id } });
    expect(await bcrypt.compare("brand-new-pass-1", after.passwordHash)).toBe(true);
    expect(await bcrypt.compare("old-password-1", after.passwordHash)).toBe(false);
    expect(after.sessionVersion).toBe(op.sessionVersion + 1);

    const log = await prisma.auditEvent.findMany({ where: { action: "user.password_set" } });
    expect(log).toHaveLength(1);
    expect(log[0]!.userId).toBe(admin.id);
    expect(JSON.stringify(log[0])).not.toContain("brand-new-pass-1");

    // An admin changing their own password keeps their own session.
    await caller.dev.users.setPassword({ userId: admin.id, newPassword: "my-new-pass-1" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).sessionVersion).toBe(0);
  });

  it("signs a user out everywhere", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const op = await makeUser("op@example.com");
    await (await api(admin.id)).dev.users.signOutEverywhere({ userId: op.id });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: op.id } })).sessionVersion).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "user.sign_out_everywhere" } })).toBe(1);
  });

  it("unlocks a user: their failures and the failures from the same IP", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const op = await makeUser("op@example.com");
    await prisma.loginAttempt.createMany({
      data: [
        ...Array.from({ length: 5 }, () => ({ email: "op@example.com", ip: "9.9.9.9", succeeded: false })),
        { email: "other@example.com", ip: "9.9.9.9", succeeded: false },
        { email: "far@example.com", ip: "8.8.8.8", succeeded: false },
        { email: "op@example.com", ip: "9.9.9.9", succeeded: true },
      ],
    });
    const caller = await api(admin.id);
    expect((await caller.dev.users.list()).users.find((u) => u.id === op.id)!.lockedForSeconds).not.toBeNull();

    const res = await caller.dev.users.unlock({ userId: op.id });
    expect(res.cleared).toBe(6);
    expect((await caller.dev.users.list()).users.find((u) => u.id === op.id)!.lockedForSeconds).toBeNull();
    // Another IP's failures and the successful sign-in stay on record.
    expect(await prisma.loginAttempt.count()).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: "auth.login.unlocked" } })).toBe(1);
  });
});

describe("System", () => {
  it("refuses the user tools for operators", async () => {
    const op = await makeUser("op@example.com", "operator");
    const caller = await api(op.id, "operator");
    expect(await codeOf(caller.dev.users.setPassword({ userId: op.id, newPassword: "long-enough-1" }))).toBe(
      "FORBIDDEN",
    );
    expect(await codeOf(caller.dev.users.unlock({ userId: op.id }))).toBe("FORBIDDEN");
  });

  it("reports the version, the database and the Sentry link", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    vi.stubEnv("SENTRY_DASHBOARD_URL", "");
    vi.stubEnv("SENTRY_ORG", "my-org");
    vi.stubEnv("SENTRY_PROJECT", "stay-ops");
    try {
      const info = await (await api(admin.id)).dev.system.info();
      expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(info.commit).toBe("abcdef1234567890");
      expect(info.database.ok).toBe(true);
      if (info.database.ok) expect(info.database.migrations).toBeGreaterThan(5);
      expect(info.sentryUrl).toBe("https://sentry.io/organizations/my-org/projects/stay-ops/");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
