import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { apiError, attachTraceToResponse, respondAuthError } from "@/lib/apiError";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { prisma } from "@/lib/prisma";
import { AuthError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { syncJsonError } from "@/modules/sync/errors";
import { hosthubSource } from "@/server/sync/hosthubSource";
import { syncHosthub } from "@/server/useCases/syncHosthub";

export const maxDuration = 300;

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
      traceId,
    );
  }

  try {
    const result = await syncHosthub({ source: hosthubSource(token), trigger: "manual", full: true });
    if (result.status === "skipped") {
      return attachTraceToResponse(request, apiError(request, "SYNC_ALREADY_RUNNING", "sync already running", 409), traceId);
    }
    await writeAuditSnapshot(prisma, {
      actorUserId: ctx.userId,
      entityType: "sync_run",
      entityId: result.runId,
      action: "sync.hosthub.full_resync",
      before: null,
      after: { runId: result.runId, ...result.stats },
    });
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { status: "completed", cursorReset: true, fullSync: true, stats: result.stats } }),
      traceId,
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
  }
}

export const POST = postFullResync;
