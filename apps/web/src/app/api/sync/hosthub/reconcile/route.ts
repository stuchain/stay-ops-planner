import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { log, withRetry, type DryRunResult } from "@stay-ops/shared";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { SYNC_USER_RATE_RULES, withRateLimit } from "@/lib/rateLimit";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { prisma } from "@/lib/prisma";
import { isTransientSyncError, runHosthubReconcile } from "@stay-ops/sync";
import { AuthError } from "@/modules/auth/errors";
import { requireAnyRole, requireSession } from "@/modules/auth/guard";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { syncJsonError } from "@/modules/sync/errors";
const RECONCILE_LOCK_KEY = BigInt("848424015");

type ReconcileBodyOptions = {
  dryRun: boolean;
  fullSync: boolean;
};

async function parseReconcileBodyOptions(request: NextRequest): Promise<ReconcileBodyOptions> {
  const dryRunQuery = request.nextUrl.searchParams.get("dryRun") === "true";
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return { dryRun: dryRunQuery, fullSync: false };
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
  const o = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return {
    dryRun: dryRunQuery || Boolean(o.dryRun),
    fullSync: Boolean(o.fullSync),
  };
}

async function postHosthubReconcile(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }

  let dryRun = false;
  let fullSync = false;
  try {
    const opts = await parseReconcileBodyOptions(request);
    dryRun = opts.dryRun;
    fullSync = opts.fullSync;
  } catch {
    return apiError(request, "VALIDATION_ERROR", "Invalid request body", 400);
  }

  try {
    if (dryRun || !fullSync) {
      requireAnyRole(ctx, ["operator", "admin"]);
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }

  const token = await resolveHosthubApiToken();
  if (!token) {
    const tid = readTraceId(request) || newTraceId();
    return attachTraceToResponse(
      request,
      NextResponse.json(syncJsonError("SERVICE_UNAVAILABLE", "Hosthub token is not configured", undefined, tid), {
        status: 503,
      }),
      tid,
    );
  }

  const running = await prisma.syncRun.findFirst({
    where: {
      source: "hosthub_poll",
      completedAt: null,
      startedAt: { gte: new Date(Date.now() - 2 * 60_000) },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  if (running) {
    return attachTraceToResponse(
      request,
      NextResponse.json(
        { data: { status: "running", runId: running.id, startedAt: running.startedAt.toISOString() } },
        { status: 202 },
      ),
    );
  }

  const lockRows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${RECONCILE_LOCK_KEY}) AS acquired
  `;
  const acquired = Boolean(lockRows[0]?.acquired);
  if (!acquired) {
    return attachTraceToResponse(request, NextResponse.json({ data: { status: "running" } }, { status: 202 }));
  }

  const traceId = readTraceId(request) || undefined;
  const reconcileTimeoutMs = fullSync ? 120_000 : 60_000;

  try {
    if (dryRun) {
      const summary = (await withRetry(
        () => runHosthubReconcile(prisma, { apiToken: token, dryRun: true, fullSync }),
        {
          maxAttempts: 2,
          timeoutBudgetMs: reconcileTimeoutMs,
          isTransient: isTransientSyncError,
          traceId,
          onRetry: ({ attempt, delayMs, err, traceId: tid }) => {
            log("warn", "retry_attempt", {
              route: "/api/sync/hosthub/reconcile",
              dryRun: true,
              fullSync,
              attempt,
              delayMs,
              traceId: tid,
              message: err instanceof Error ? err.message : String(err),
            });
          },
          onExhausted: ({ attempts, elapsedMs, cause, traceId: tid }) => {
            log("error", "retry_exhausted", {
              route: "/api/sync/hosthub/reconcile",
              dryRun: true,
              fullSync,
              attempts,
              elapsedMs,
              traceId: tid,
              message: cause instanceof Error ? cause.message : String(cause),
            });
          },
        },
      )) as DryRunResult;
      log("info", "dry_run", {
        route: "/api/sync/hosthub/reconcile",
        dryRun: true,
        fullSync,
        traceId,
        processed: summary.totals.processed,
        warnings: summary.warnings.length,
      });
      return attachTraceToResponse(
        request,
        NextResponse.json({ data: { dryRun: true, fullSync, summary } }, { status: 200 }),
        traceId,
      );
    }

    await withRetry(() => runHosthubReconcile(prisma, { apiToken: token, fullSync }), {
      maxAttempts: 2,
      timeoutBudgetMs: reconcileTimeoutMs,
      isTransient: isTransientSyncError,
      traceId,
      onRetry: ({ attempt, delayMs, err, traceId: tid }) => {
        log("warn", "retry_attempt", {
          route: "/api/sync/hosthub/reconcile",
          fullSync,
          attempt,
          delayMs,
          traceId: tid,
          message: err instanceof Error ? err.message : String(err),
        });
      },
      onExhausted: ({ attempts, elapsedMs, cause, traceId: tid }) => {
        log("error", "retry_exhausted", {
          route: "/api/sync/hosthub/reconcile",
          fullSync,
          attempts,
          elapsedMs,
          traceId: tid,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    });
    log("info", "hosthub_reconcile_completed", { route: "/api/sync/hosthub/reconcile", fullSync, traceId });
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { status: "completed", fullSync } }, { status: 200 }),
      traceId,
    );
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${RECONCILE_LOCK_KEY})`;
  }
}

export async function POST(request: NextRequest) {
  return withRateLimit("POST:/api/sync/hosthub/reconcile", SYNC_USER_RATE_RULES, request, (req) =>
    postHosthubReconcile(req as NextRequest),
  );
}
