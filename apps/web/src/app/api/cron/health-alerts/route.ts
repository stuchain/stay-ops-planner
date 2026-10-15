import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { verifyCronBearerToken } from "@/lib/cronBearerAuth";
import { prisma } from "@/lib/prisma";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { notifiersFromEnv } from "@/server/monitoring/notifier";
import { runHealthAlerts } from "@/server/monitoring/runHealthAlerts";
import { isAthensDaytime } from "@/server/monitoring/syncHealth";
import { runScheduledSync } from "@/server/useCases/scheduledSync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The background tick, called every 30 minutes during the day by .github/workflows/health-alerts.yml (or an
 * outside scheduler) with `Authorization: Bearer $CRON_SECRET`: syncs Hosthub, then checks sync health.
 * At night it answers without touching the database, so Neon's free compute is not spent waking it up.
 */
export async function GET(request: NextRequest) {
  const traceId = readTraceId(request) || newTraceId();
  if (!verifyCronBearerToken(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return attachTraceToResponse(request, apiError(request, "UNAUTHORIZED", "Authentication required", 401), traceId);
  }
  if (!isAthensDaytime(new Date())) {
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { status: "skipped", reason: "night" } }, { status: 200 }),
      traceId,
    );
  }
  try {
    const sync = await runScheduledSync();
    const result = await runHealthAlerts({ db: prisma, notifiers: notifiersFromEnv() });
    return attachTraceToResponse(request, NextResponse.json({ data: { ...result, sync } }, { status: 200 }), traceId);
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
