import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { log, withRetry } from "@stay-ops/shared";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { prisma } from "@/lib/prisma";
import { isTransientSyncError, runHosthubReconcile } from "@stay-ops/sync";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { syncJsonError } from "@/modules/sync/errors";
const RECONCILE_LOCK_KEY = BigInt("848424015");

export async function POST(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
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

  try {
    await withRetry(() => runHosthubReconcile(prisma, { apiToken: token }), {
      maxAttempts: 2,
      timeoutBudgetMs: 60_000,
      isTransient: isTransientSyncError,
      traceId,
      onRetry: ({ attempt, delayMs, err, traceId: tid }) => {
        log("warn", "retry_attempt", {
          route: "/api/sync/hosthub/reconcile",
          attempt,
          delayMs,
          traceId: tid,
          message: err instanceof Error ? err.message : String(err),
        });
      },
      onExhausted: ({ attempts, elapsedMs, cause, traceId: tid }) => {
        log("error", "retry_exhausted", {
          route: "/api/sync/hosthub/reconcile",
          attempts,
          elapsedMs,
          traceId: tid,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    });
    return attachTraceToResponse(request, NextResponse.json({ data: { status: "completed" } }, { status: 200 }));
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${RECONCILE_LOCK_KEY})`;
  }
}
