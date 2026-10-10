import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { verifyCronBearerToken } from "@/lib/cronBearerAuth";
import { prisma } from "@/lib/prisma";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { notifiersFromEnv } from "@/server/monitoring/notifier";
import { runHealthAlerts } from "@/server/monitoring/runHealthAlerts";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Called every 30 minutes by .github/workflows/health-alerts.yml with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const traceId = readTraceId(request) || newTraceId();
  if (!verifyCronBearerToken(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return attachTraceToResponse(request, apiError(request, "UNAUTHORIZED", "Authentication required", 401), traceId);
  }
  try {
    const result = await runHealthAlerts({ db: prisma, notifiers: notifiersFromEnv() });
    return attachTraceToResponse(request, NextResponse.json({ data: result }, { status: 200 }), traceId);
  } catch (err) {
    return attachTraceToResponse(
      request,
      apiError(
        request,
        "INTERNAL_ERROR",
        "Health alert check failed",
        500,
        undefined,
        { route: "/api/cron/health-alerts", method: "GET" },
        err,
      ),
      traceId,
    );
  }
}
