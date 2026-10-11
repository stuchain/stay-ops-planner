/**
 * P2-6: the Dev mode Hosthub section against a real database, with a mocked Hosthub client.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import { createCaller } from "@/server/api/root";
import { domainErrorShape } from "@/server/api/trpc";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import type { HosthubSource } from "@/server/sync/hosthubSource";
import {
  getHosthubOverview,
  listImportErrors,
  listSyncRuns,
  resetHosthubCursor,
  runHosthubSync,
  saveHosthubToken,
} from "@/server/useCases/devHosthub";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const prisma = new PrismaClient();
let adminId = "";
let operatorId = "";

type ListResult = Awaited<ReturnType<HosthubSource["listCalendarEventsPage"]>>;

function source(result: ListResult): HosthubSource {
  return {
    listCalendarEventsPage: async () => result,
    listRentalCalendarEventsPage: async () => ({
      ok: true,
      value: { data: [], rawData: [], nextPageUrl: null, skipped: 0 },
    }),
    getCalendarEventNotes: async () => ({ ok: true, value: {} }) as never,
    getCalendarEventGrTaxes: async () => ({ ok: true, value: {} }) as never,
  };
}

const emptyPage: ListResult = { ok: true, value: { data: [], rawData: [], nextPageUrl: null, skipped: 0 } };
const rejected = (statusCode: number | undefined, code = "HOSTHUB_HTTP_ERROR"): ListResult =>
  ({ ok: false, error: { code, message: "no", statusCode, retryable: false } }) as never;

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  throw new Error("expected a DomainError");
}

function as(role: "viewer" | "operator" | "admin", userId: string) {
  return createCaller({ headers: new Headers(), user: { userId, role, sessionExpiresAt: new Date(Date.now() + 1e6) } });
}

beforeAll(async () => {
  const admin = await prisma.user.upsert({
    where: { email: "p26-admin@example.com" },
    update: { role: "admin", isActive: true },
    create: { email: "p26-admin@example.com", passwordHash: "x", role: "admin", isActive: true },
  });
  const operator = await prisma.user.upsert({
    where: { email: "p26-operator@example.com" },
    update: { role: "operator", isActive: true },
    create: { email: "p26-operator@example.com", passwordHash: "x", role: "operator", isActive: true },
  });
  adminId = admin.id;
  operatorId = operator.id;
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "import_errors", "sync_runs", "sync_state", "sync_lock", "webhook_inbound_events", "integration_secrets" RESTART IDENTITY CASCADE;`,
  );
  await prisma.auditEvent.deleteMany({ where: { action: { startsWith: "sync.hosthub" } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("saving the Hosthub token (E2-8)", () => {
  it("refuses a key Hosthub rejects and keeps the stored one", async () => {
    await saveHosthubToken({ token: "good-key", actorUserId: adminId, source: source(emptyPage) });
    expect(await resolveHosthubApiToken()).toBe("good-key");

    expect(
      await codeOf(
        saveHosthubToken({
          token: "bad-key",
          actorUserId: adminId,
          source: source(rejected(401, "HOSTHUB_AUTH_FAILED")),
        }),
      ),
    ).toBe("HOSTHUB_TOKEN_REJECTED");
    expect(
      await codeOf(saveHosthubToken({ token: "bad-key", actorUserId: adminId, source: source(rejected(403)) })),
    ).toBe("HOSTHUB_TOKEN_REJECTED");
    expect(await resolveHosthubApiToken()).toBe("good-key");
  });

  it("says Hosthub could not be reached, without saving, when the test fails for another reason", async () => {
    expect(await codeOf(saveHosthubToken({ token: "k", actorUserId: adminId, source: source(rejected(503)) }))).toBe(
      "HOSTHUB_UNREACHABLE",
    );
    expect(
      await codeOf(
        saveHosthubToken({
          token: "k",
          actorUserId: adminId,
          source: source(rejected(undefined, "HOSTHUB_NETWORK_ERROR")),
        }),
      ),
    ).toBe("HOSTHUB_UNREACHABLE");
    expect(await prisma.integrationSecret.count()).toBe(0);
  });

  it("stores a good key encrypted, audits it without the key, and never returns it", async () => {
    const status = await saveHosthubToken({
      token: " secret-123 ",
      name: "Main",
      actorUserId: adminId,
      source: source(emptyPage),
    });
    expect(status).toMatchObject({ configured: true, name: "Main" });
    const row = await prisma.integrationSecret.findFirstOrThrow();
    expect(row.ciphertext).not.toContain("secret-123");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "integration.hosthub.token_saved" } });
    expect(JSON.stringify(audit)).not.toContain("secret-123");
    expect(JSON.stringify(await getHosthubOverview())).not.toContain("secret-123");
  });

  it("rejects an empty key", async () => {
    expect(await codeOf(saveHosthubToken({ token: "  ", actorUserId: adminId, source: source(emptyPage) }))).toBe(
      "VALIDATION",
    );
  });
});

describe("a stored key that cannot be read", () => {
  it("stops sync with the renew-key problem instead of crashing, and Settings asks for the key again", async () => {
    // Saved under another encryption key: GCM refuses to decrypt it.
    await prisma.integrationSecret.create({
      data: {
        provider: "hosthub",
        secretKey: "apiToken",
        ciphertext: Buffer.from("not-the-key").toString("base64"),
        iv: Buffer.alloc(12, 1).toString("base64"),
        tag: Buffer.alloc(16, 2).toString("base64"),
      },
    });
    const before = process.env.HOSTHUB_API_TOKEN;
    delete process.env.HOSTHUB_API_TOKEN;
    try {
      expect(await resolveHosthubApiToken()).toBeNull();
      const state = await prisma.syncState.findUniqueOrThrow({ where: { id: 1 } });
      expect(state.lastError).toMatch(/^HOSTHUB_AUTH_FAILED/);
      expect((await getHosthubOverview()).token.configured).toBe(false);
    } finally {
      if (before !== undefined) process.env.HOSTHUB_API_TOKEN = before;
    }
  });
});

describe("reset cursor", () => {
  it("clears sync_state.cursor, audits it and leaves the other fields", async () => {
    await prisma.syncState.create({ data: { id: 1, cursor: "1700000000", lastSuccessAt: new Date() } });
    const r = await resetHosthubCursor({ actorUserId: adminId });
    expect(r.previous).toBe("1700000000");
    const state = await prisma.syncState.findUniqueOrThrow({ where: { id: 1 } });
    expect(state.cursor).toBeNull();
    expect(state.lastSuccessAt).not.toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "sync.hosthub.cursor_reset" } });
    expect(audit.userId).toBe(adminId);
  });

  it("works when no sync_state row exists yet", async () => {
    expect((await resetHosthubCursor({ actorUserId: adminId })).previous).toBeNull();
  });

  it("is refused while a sync is running", async () => {
    await prisma.syncState.create({ data: { id: 1, cursor: "5" } });
    await prisma.syncLock.create({
      data: { name: "hosthub_reconcile", lockedUntil: new Date(Date.now() + 60_000), holder: "x" },
    });
    expect(await codeOf(resetHosthubCursor({ actorUserId: adminId }))).toBe("SYNC_RUNNING");
    expect((await prisma.syncState.findUniqueOrThrow({ where: { id: 1 } })).cursor).toBe("5");
  });
});

describe("sync buttons", () => {
  it("runs an incremental and a full sync and audits both", async () => {
    const calls: (number | null | undefined)[] = [];
    const src: HosthubSource = {
      ...source(emptyPage),
      listCalendarEventsPage: async (args) => {
        calls.push(args.updatedGte);
        return emptyPage;
      },
    };
    await prisma.syncState.create({ data: { id: 1, cursor: "1700000000", lastFullSyncAt: new Date() } });
    expect((await runHosthubSync({ full: false, actorUserId: adminId, source: src })).outcome).toBe("done");
    expect((await runHosthubSync({ full: true, actorUserId: adminId, source: src })).outcome).toBe("done");
    expect(calls).toEqual([1700000000, undefined]);
    const actions = (await prisma.auditEvent.findMany({ where: { action: { startsWith: "sync.hosthub" } } })).map(
      (a) => a.action,
    );
    expect(actions.sort()).toEqual(["sync.hosthub.full_resync", "sync.hosthub.manual"]);
  });
});

describe("history", () => {
  it("pages sync runs newest first with duration, result and counts", async () => {
    const t0 = Date.parse("2030-01-01T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      await prisma.syncRun.create({
        data: {
          source: "hosthub_poll",
          startedAt: new Date(t0 + i * 60_000),
          completedAt: new Date(t0 + i * 60_000 + 2500),
          status: i === 4 ? "failed" : "completed",
          statsJson: { fetched: 10 + i, created: i, updated: 1, unchanged: 3, errors: 0 },
        },
      });
    }
    await prisma.syncRun.create({ data: { source: "other", startedAt: new Date(t0 + 9e6), status: "completed" } });

    const first = await listSyncRuns({ limit: 2 });
    expect(first.items.map((r) => r.fetched)).toEqual([14, 13]);
    expect(first.items[0]).toMatchObject({ status: "failed", durationMs: 2500, created: 4 });
    expect(first.nextCursor).not.toBeNull();

    const second = await listSyncRuns({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((r) => r.fetched)).toEqual([12, 11]);
    const last = await listSyncRuns({ limit: 2, cursor: second.nextCursor! });
    expect(last.items.map((r) => r.fetched)).toEqual([10]);
    expect(last.nextCursor).toBeNull();
  });

  it("pages import errors newest first with the raw payload", async () => {
    const run = await prisma.syncRun.create({ data: { source: "hosthub_poll", status: "completed" } });
    const t0 = Date.parse("2030-01-01T10:00:00Z");
    for (let i = 0; i < 3; i++) {
      await prisma.importError.create({
        data: {
          syncRunId: run.id,
          code: "APPLY_ERROR",
          message: `bad ${i}`,
          ...(i === 2 ? {} : { payload: { id: `evt-${i}`, nested: { a: [1, 2] } } }),
          createdAt: new Date(t0 + i * 1000),
        },
      });
    }
    const first = await listImportErrors({ limit: 2 });
    expect(first.items.map((e) => e.message)).toEqual(["bad 2", "bad 1"]);
    expect(first.items[0]?.payload).toBeNull();
    expect(first.items[1]?.payload).toEqual({ id: "evt-1", nested: { a: [1, 2] } });
    const second = await listImportErrors({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((e) => e.message)).toEqual(["bad 0"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("webhook status", () => {
  it("reports the last delivery and the 24 hour count", async () => {
    const empty = await getHosthubOverview();
    expect(empty.webhook).toMatchObject({
      path: "/api/sync/hosthub/webhook",
      lastReceivedAt: null,
      receivedLast24h: 0,
    });
    const recent = new Date(Date.now() - 3_600_000);
    await prisma.webhookInboundEvent.createMany({
      data: [
        { provider: "hosthub", dedupeKey: "a", receivedAt: recent },
        { provider: "hosthub", dedupeKey: "b", receivedAt: new Date(Date.now() - 3 * 86_400_000) },
        { provider: "other", dedupeKey: "c", receivedAt: new Date() },
      ],
    });
    const o = await getHosthubOverview();
    expect(o.webhook.receivedLast24h).toBe(1);
    expect(o.webhook.lastReceivedAt).toBe(recent.toISOString());
  });
});

describe("admin only", () => {
  it("refuses operators on every dev.hosthub procedure", async () => {
    const op = as("operator", operatorId);
    const denied = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (err) {
        return domainErrorShape(err as never)?.code;
      }
      return "allowed";
    };
    expect(await denied(op.dev.hosthub.overview())).toBe("FORBIDDEN");
    expect(await denied(op.dev.hosthub.runs({}))).toBe("FORBIDDEN");
    expect(await denied(op.dev.hosthub.errors({}))).toBe("FORBIDDEN");
    expect(await denied(op.dev.hosthub.saveToken({ token: "x" }))).toBe("FORBIDDEN");
    expect(await denied(op.dev.hosthub.sync({ full: false }))).toBe("FORBIDDEN");
    expect(await denied(op.dev.hosthub.resetCursor())).toBe("FORBIDDEN");
  });

  it("lets an admin read the overview", async () => {
    expect((await as("admin", adminId).dev.hosthub.overview()).token.configured).toBe(false);
  });
});
