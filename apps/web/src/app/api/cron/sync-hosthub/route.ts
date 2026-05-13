import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { log, withRetry } from "@stay-ops/shared";
import { isTransientSyncError, runHosthubReconcile } from "@stay-ops/sync";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { verifyCronBearerToken } from "@/lib/cronBearerAuth";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { prisma } from "@/lib/prisma";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { syncJsonError } from "@/modules/sync/errors";
import { isWithinHosthubCronDaytimeWindow } from "@/modules/sync/cronDaytime";
import {
  findInFlightHosthubPoll,
  releaseHosthubReconcileLock,
  tryAcquireHosthubReconcileLock,
} from "@/modules/sync/hosthubPollLock";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const traceId = readTraceId(request) || newTraceId();
  const secret = process.env.CRON_SECRET?.trim();
  const authz = request.headers.get("authorization");
  if (!verifyCronBearerToken(authz, secret)) {
    return attachTraceToResponse(request, apiError(request, "UNAUTHORIZED", "Authentication required", 401), traceId);
  }

  if (!isWithinHosthubCronDaytimeWindow()) {
    log("info", "cron_sync_skipped", { reason: "outside_daytime_window", traceId });
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { status: "skipped", reason: "outside_daytime_window" } }, { status: 200 }),
      traceId,
    );
  }

  const token = await resolveHosthubApiToken();
  if (!token) {
    return attachTraceToResponse(
      request,
      NextResponse.json(syncJsonError("SERVICE_UNAVAILABLE", "Hosthub token is not configured", undefined, traceId), {
        status: 503,
      }),
      traceId,
    );
  }

  const running = await findInFlightHosthubPoll(prisma);
  if (running) {
    return attachTraceToResponse(
      request,
      apiError(request, "SYNC_ALREADY_RUNNING", "sync already running", 409, {
        runId: running.id,
        startedAt: running.startedAt.toISOString(),
      }),
      traceId,
    );
  }

  const acquired = await tryAcquireHosthubReconcileLock(prisma);
  if (!acquired) {
    return attachTraceToResponse(request, apiError(request, "SYNC_ALREADY_RUNNING", "sync already running", 409), traceId);
  }

  try {
    await withRetry(() => runHosthubReconcile(prisma, { apiToken: token, fullSync: false }), {
      maxAttempts: 2,
      timeoutBudgetMs: 60_000,
      isTransient: isTransientSyncError,
      traceId,
      onRetry: ({ attempt, delayMs, err, traceId: tid }) => {
        log("warn", "retry_attempt", {
          route: "/api/cron/sync-hosthub",
          attempt,
          delayMs,
          traceId: tid,
          message: err instanceof Error ? err.message : String(err),
        });
      },
      onExhausted: ({ attempts, elapsedMs, cause, traceId: tid }) => {
        log("error", "retry_exhausted", {
          route: "/api/cron/sync-hosthub",
          attempts,
          elapsedMs,
          traceId: tid,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    });
    log("info", "cron_hosthub_reconcile_completed", { traceId });
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { status: "completed", fullSync: false } }, { status: 200 }),
      traceId,
    );
  } catch (err) {
    return attachTraceToResponse(
      request,
      apiError(
        request,
        "INTERNAL_ERROR",
        "Hosthub cron reconcile failed",
        500,
        undefined,
        { route: "/api/cron/sync-hosthub", method: "GET" },
        err,
      ),
      traceId,
    );
  } finally {
    await releaseHosthubReconcileLock(prisma);
  }
}
