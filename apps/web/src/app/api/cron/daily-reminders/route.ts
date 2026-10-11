import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { verifyCronBearerToken } from "@/lib/cronBearerAuth";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { reminderNotifiersFromEnv, runDailyReminder } from "@/server/reminders/dailyReminder";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Called each morning by .github/workflows/daily-reminders.yml with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const traceId = readTraceId(request) || newTraceId();
  if (!verifyCronBearerToken(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return attachTraceToResponse(request, apiError(request, "UNAUTHORIZED", "Authentication required", 401), traceId);
  }
  try {
    const result = await runDailyReminder({ notifiers: reminderNotifiersFromEnv() });
    return attachTraceToResponse(request, NextResponse.json({ data: result }, { status: 200 }), traceId);
  } catch (err) {
    return attachTraceToResponse(
      request,
      apiError(
        request,
        "INTERNAL_ERROR",
        "Daily reminder failed",
        500,
        undefined,
        { route: "/api/cron/daily-reminders", method: "GET" },
        err,
      ),
      traceId,
    );
  }
}
