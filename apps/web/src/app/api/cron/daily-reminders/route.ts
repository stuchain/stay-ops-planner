import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { verifyCronBearerToken } from "@/lib/cronBearerAuth";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { reminderNotifiersFromEnv, runDailyReminder } from "@/server/reminders/dailyReminder";
import { runGuestDataRetention } from "@/server/useCases/guestDataRetention";
import { runScheduledSync } from "@/server/useCases/scheduledSync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Called each morning by .github/workflows/daily-reminders.yml with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const traceId = readTraceId(request) || newTraceId();
  if (!verifyCronBearerToken(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return attachTraceToResponse(request, apiError(request, "UNAUTHORIZED", "Authentication required", 401), traceId);
  }
  try {
    // Sync first, so a booking made overnight is in the reminder even if nobody opened the app.
    const sync = await runScheduledSync();
    const result = await runDailyReminder({ notifiers: reminderNotifiersFromEnv() });
    // Once a day, in the same database wake-up: blank old guests' contact and identity details.
    const retention = await runGuestDataRetention();
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { ...result, sync, retention } }, { status: 200 }),
      traceId,
    );
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
