import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { log } from "@stay-ops/shared";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { verifyCronBearerToken } from "@/lib/cronBearerAuth";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { syncJsonError } from "@/modules/sync/errors";
import { isWithinHosthubCronDaytimeWindow } from "@/modules/sync/cronDaytime";
import { hosthubSource } from "@/server/sync/hosthubSource";
import { syncHosthub } from "@/server/useCases/syncHosthub";

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

  try {
    const result = await syncHosthub({ source: hosthubSource(token), trigger: "scheduled" });
    if (result.status === "skipped") {
      return attachTraceToResponse(request, apiError(request, "SYNC_ALREADY_RUNNING", "sync already running", 409), traceId);
    }
    log("info", "cron_hosthub_reconcile_completed", { traceId });
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { status: "completed", fullSync: false, stats: result.stats } }, { status: 200 }),
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
  }
}
