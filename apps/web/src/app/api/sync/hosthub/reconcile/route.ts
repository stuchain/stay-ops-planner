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
import { hosthubSource } from "@/server/sync/hosthubSource";
import { releaseHosthubReconcileLock, tryAcquireHosthubReconcileLock } from "@/server/sync/lock";
import { syncHosthub } from "@/server/useCases/syncHosthub";

export const maxDuration = 300;

const HEARTBEAT_TRIGGER = "heartbeat";

function readSyncTrigger(request: NextRequest): string | null {
  const v = request.headers.get("x-stayops-sync-trigger")?.trim().toLowerCase();
  return v && v.length > 0 ? v : null;
}

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
    // Full sync re-fetches all history from Hosthub, so it is admin-only; everything else is operator or admin.
    if (fullSync && !dryRun) {
      requireAnyRole(ctx, ["admin"]);
    } else {
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

  const traceId = readTraceId(request) || undefined;

  if (dryRun) {
    // The settings preview still uses the old reconcile in dry-run mode until that screen is retired.
    const lockHolder = await tryAcquireHosthubReconcileLock(prisma);
    if (!lockHolder) {
      return attachTraceToResponse(request, apiError(request, "SYNC_ALREADY_RUNNING", "sync already running", 409));
    }
    try {
      const summary = (await withRetry(
        () => runHosthubReconcile(prisma, { apiToken: token, dryRun: true, fullSync }),
        { maxAttempts: 2, timeoutBudgetMs: fullSync ? 120_000 : 60_000, isTransient: isTransientSyncError, traceId },
      )) as DryRunResult;
      log("info", "dry_run", {
        route: "/api/sync/hosthub/reconcile",
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
    } finally {
      await releaseHosthubReconcileLock(prisma, lockHolder);
    }
  }

  const trigger = readSyncTrigger(request) === HEARTBEAT_TRIGGER ? "open" : "manual";
  const result = await syncHosthub({ source: hosthubSource(token), trigger, full: fullSync });
  if (result.status === "skipped" && result.reason === "locked") {
    return attachTraceToResponse(request, apiError(request, "SYNC_ALREADY_RUNNING", "sync already running", 409));
  }
  if (result.status === "skipped") {
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { status: "skipped", reason: result.reason } }, { status: 200 }),
    );
  }
  return attachTraceToResponse(
    request,
    NextResponse.json({ data: { status: "completed", fullSync, stats: result.stats } }, { status: 200 }),
    traceId,
  );
}

export async function POST(request: NextRequest) {
  return withRateLimit("POST:/api/sync/hosthub/reconcile", SYNC_USER_RATE_RULES, request, (req) =>
    postHosthubReconcile(req as NextRequest),
  );
}
