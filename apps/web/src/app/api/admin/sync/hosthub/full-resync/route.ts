import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { log, withRetry } from "@stay-ops/shared";
import { isTransientSyncError, runHosthubReconcile } from "@stay-ops/sync";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { apiError, attachTraceToResponse, respondAuthError } from "@/lib/apiError";
import { SYNC_USER_RATE_RULES, withRateLimit } from "@/lib/rateLimit";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { prisma } from "@/lib/prisma";
import { AuthError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { syncJsonError } from "@/modules/sync/errors";

const RECONCILE_LOCK_KEY = BigInt("848424015");

async function postFullResync(request: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  const traceId = readTraceId(request) || newTraceId();

  const token = await resolveHosthubApiToken();
  if (!token) {
    return attachTraceToResponse(
      request,
      NextResponse.json(syncJsonError("SERVICE_UNAVAILABLE", "Hosthub token is not configured", undefined, traceId), {
        status: 503,
      }),
    );
  }

  let runsCursorCleared = 0;
  try {
    runsCursorCleared = await prisma.$transaction(async (tx) => {
      const beforeCount = await tx.syncRun.count({
        where: { source: "hosthub_poll", cursor: { not: null } },
      });
      const res = await tx.syncRun.updateMany({
        where: { source: "hosthub_poll", cursor: { not: null } },
        data: { cursor: null },
      });
      await writeAuditSnapshot(tx, {
        actorUserId: ctx.userId,
        entityType: "sync_run",
        entityId: "*",
        action: "sync.hosthub.full_resync_cursor_reset",
        before: { runsWithCursor: beforeCount },
        after: { runsWithCursor: 0 },
      });
      return res.count;
    });
  } catch (err) {
    return apiError(
      request,
      "INTERNAL_ERROR",
      "Internal server error",
      500,
      undefined,
      { route: "/api/admin/sync/hosthub/full-resync", method: "POST" },
      err,
    );
  }

  const lockRows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${RECONCILE_LOCK_KEY}) AS acquired
  `;
  const acquired = Boolean(lockRows[0]?.acquired);
  if (!acquired) {
    return attachTraceToResponse(
      request,
      NextResponse.json(
        { data: { status: "running", cursorReset: true, runsCursorCleared } },
        { status: 202 },
      ),
    );
  }

  try {
    await withRetry(() => runHosthubReconcile(prisma, { apiToken: token, fullSync: true }), {
      maxAttempts: 2,
      timeoutBudgetMs: 120_000,
      isTransient: isTransientSyncError,
      traceId,
      onRetry: ({ attempt, delayMs, err, traceId: tid }) => {
        log("warn", "retry_attempt", {
          route: "/api/admin/sync/hosthub/full-resync",
          attempt,
          delayMs,
          traceId: tid,
          message: err instanceof Error ? err.message : String(err),
        });
      },
      onExhausted: ({ attempts, elapsedMs, cause, traceId: tid }) => {
        log("error", "retry_exhausted", {
          route: "/api/admin/sync/hosthub/full-resync",
          attempts,
          elapsedMs,
          traceId: tid,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    });
    return attachTraceToResponse(
      request,
      NextResponse.json({
        data: { status: "completed", cursorReset: true, runsUpdated: runsCursorCleared, fullSync: true },
      }),
    );
  } catch (err) {
    return apiError(
      request,
      "INTERNAL_ERROR",
      "Hosthub full resync failed",
      500,
      undefined,
      { route: "/api/admin/sync/hosthub/full-resync", method: "POST" },
      err,
    );
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${RECONCILE_LOCK_KEY})`;
  }
}

export async function POST(request: NextRequest) {
  return withRateLimit("POST:/api/admin/sync/hosthub/full-resync", SYNC_USER_RATE_RULES, request, (req) =>
    postFullResync(req as NextRequest),
  );
}
