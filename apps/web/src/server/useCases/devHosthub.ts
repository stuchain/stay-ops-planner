import { writeAuditSnapshot } from "@stay-ops/audit";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { getHosthubTokenStatus, setHosthubToken, type HosthubTokenStatus } from "@/modules/integrations/hosthubToken";
import { hosthubSource, type HosthubSource } from "@/server/sync/hosthubSource";
import { runSyncNow, type RunSyncNowResult } from "./runSyncNow";

/** Dev mode, Hosthub section (P2-6): token, sync history, import errors, sync buttons, webhook. */

export const WEBHOOK_PATH = "/api/sync/hosthub/webhook";
export const HISTORY_PAGE_SIZE = 20;

export type HosthubOverview = {
  token: HosthubTokenStatus;
  /** The Hosthub `updated_gte` the next incremental sync starts from (Unix seconds), or null (= from the beginning). */
  cursor: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  running: boolean;
  webhook: {
    path: string;
    /** False when WEBHOOK_SECRET is not set, so deliveries are refused in production. */
    secretConfigured: boolean;
    lastReceivedAt: string | null;
    receivedLast24h: number;
  };
};

export async function getHosthubOverview(): Promise<HosthubOverview> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [token, state, lock, lastEvent, recent] = await Promise.all([
    getHosthubTokenStatus(),
    prisma.syncState.findUnique({ where: { id: 1 } }),
    prisma.syncLock.findUnique({ where: { name: "hosthub_reconcile" }, select: { lockedUntil: true } }),
    prisma.webhookInboundEvent.findFirst({
      where: { provider: "hosthub" },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    prisma.webhookInboundEvent.count({ where: { provider: "hosthub", receivedAt: { gte: since } } }),
  ]);
  return {
    token,
    cursor: state?.cursor ?? null,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
    running: lock !== null && lock.lockedUntil.getTime() > Date.now(),
    webhook: {
      path: WEBHOOK_PATH,
      secretConfigured: Boolean(process.env.WEBHOOK_SECRET?.trim()),
      lastReceivedAt: lastEvent?.receivedAt.toISOString() ?? null,
      receivedLast24h: recent,
    },
  };
}

/**
 * Asks Hosthub for one cheap page with this key. A refused key is HOSTHUB_TOKEN_REJECTED, anything else
 * that stops us getting an answer is HOSTHUB_UNREACHABLE; in both cases nothing is saved.
 */
export async function checkHosthubToken(token: string, source?: HosthubSource): Promise<void> {
  const src = source ?? hosthubSource(token);
  const page = await src.listCalendarEventsPage({
    nextPageUrl: null,
    updatedGte: Math.floor(Date.now() / 1000),
    isVisible: "all",
  });
  if (page.ok) return;
  const status = page.error.statusCode;
  if (status === 401 || status === 403) throw new DomainError("HOSTHUB_TOKEN_REJECTED");
  throw new DomainError("HOSTHUB_UNREACHABLE");
}

/** E2-8: the key is tested against Hosthub first; a bad one is refused and the stored one stays. */
export async function saveHosthubToken(input: {
  token: string;
  name?: string | null | undefined;
  actorUserId: string;
  source?: HosthubSource;
}): Promise<HosthubTokenStatus> {
  const token = input.token.trim();
  if (!token) throw new DomainError("VALIDATION");
  await checkHosthubToken(token, input.source);
  const status = await setHosthubToken({ token, name: input.name });
  // Hosthub just accepted this key, so a "key refused / unreadable" problem from earlier no longer holds.
  await prisma.syncState.updateMany({
    where: { id: 1, lastError: { startsWith: "HOSTHUB_AUTH_FAILED" } },
    data: { lastError: null },
  });
  await writeAuditSnapshot(prisma, {
    actorUserId: input.actorUserId,
    entityType: "integration_secret",
    entityId: "hosthub",
    action: "integration.hosthub.token_saved",
    before: null,
    after: { name: status.name },
  });
  return status;
}

export type SyncRunItem = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: "completed" | "failed" | "running";
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

function num(stats: unknown, key: string): number {
  const v = (stats as Record<string, unknown> | null)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? HISTORY_PAGE_SIZE), 1), 100);
}

type PageInput = { cursor?: string | undefined; limit?: number | undefined };

/** `sync_runs`, newest first, a page at a time. `cursor` is the id of the last row of the previous page. */
export async function listSyncRuns(input: PageInput = {}): Promise<Page<SyncRunItem>> {
  const limit = clampLimit(input.limit);
  const rows = await prisma.syncRun.findMany({
    where: { source: "hosthub_poll" },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      durationMs: r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
      status: r.status === "completed" ? "completed" : r.status === "failed" ? "failed" : "running",
      fetched: num(r.statsJson, "fetched"),
      created: num(r.statsJson, "created"),
      updated: num(r.statsJson, "updated"),
      unchanged: num(r.statsJson, "unchanged"),
      errors: num(r.statsJson, "errors"),
    })),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export type ImportErrorItem = {
  id: string;
  code: string | null;
  message: string;
  createdAt: string;
  syncRunId: string;
  /** The raw Hosthub event (or whatever was being applied) as stored. */
  payload: unknown;
};

/** `import_errors` with the raw payload, newest first, a page at a time. */
export async function listImportErrors(input: PageInput = {}): Promise<Page<ImportErrorItem>> {
  const limit = clampLimit(input.limit);
  const rows = await prisma.importError.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      code: r.code,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      syncRunId: r.syncRunId,
      payload: r.payload ?? null,
    })),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Incremental (`full` false) or full sync from the button, written to the audit log. */
export async function runHosthubSync(input: {
  full: boolean;
  actorUserId: string;
  source?: HosthubSource;
}): Promise<RunSyncNowResult> {
  const result = await runSyncNow(input.source, { full: input.full });
  await writeAuditSnapshot(prisma, {
    actorUserId: input.actorUserId,
    entityType: "sync_run",
    entityId: "*",
    action: input.full ? "sync.hosthub.full_resync" : "sync.hosthub.manual",
    before: null,
    after: { outcome: result.outcome },
  });
  return result;
}

/** Forget where the incremental sync stopped: the next one starts from the beginning. Refused while a sync runs. */
export async function resetHosthubCursor(input: { actorUserId: string }): Promise<{ previous: string | null }> {
  const lock = await prisma.syncLock.findUnique({
    where: { name: "hosthub_reconcile" },
    select: { lockedUntil: true },
  });
  if (lock && lock.lockedUntil.getTime() > Date.now()) throw new DomainError("SYNC_RUNNING");
  return prisma.$transaction(async (tx) => {
    const before = await tx.syncState.findUnique({ where: { id: 1 } });
    await tx.syncState.upsert({ where: { id: 1 }, create: { id: 1, cursor: null }, update: { cursor: null } });
    await writeAuditSnapshot(tx, {
      actorUserId: input.actorUserId,
      entityType: "sync_state",
      entityId: "1",
      action: "sync.hosthub.cursor_reset",
      before: { cursor: before?.cursor ?? null },
      after: { cursor: null },
    });
    return { previous: before?.cursor ?? null };
  });
}
