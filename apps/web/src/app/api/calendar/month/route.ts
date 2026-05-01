import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { readTraceId } from "@/lib/traceId";
import { log } from "@/lib/logger";
import { parseYearMonthParam } from "@/modules/calendar/monthBounds";
import { getCalendarMonthAggregate } from "@/modules/calendar/monthAggregate";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";

const QuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM"),
});

export async function GET(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }

  const url = new URL(request.url);
  const raw = { month: url.searchParams.get("month") ?? "" };
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(request, "VALIDATION_ERROR", "Invalid query", 400, parsed.error.flatten());
  }

  if (!parseYearMonthParam(parsed.data.month)) {
    return apiError(request, "VALIDATION_ERROR", "Invalid month", 400);
  }

  const timeZone = process.env.APP_TIMEZONE?.trim() || "Etc/UTC";

  try {
    const data = await getCalendarMonthAggregate({
      yearMonth: parsed.data.month,
      timeZone,
    });
    return attachTraceToResponse(request, NextResponse.json({ data }));
  } catch (err) {
    log("error", "calendar_month_failed", {
      traceId: readTraceId(request),
      err: err instanceof Error ? err.message : String(err),
    });
    const message =
      process.env.NODE_ENV === "development" && err instanceof Error
        ? err.message
        : "Could not load calendar data.";
    return apiError(
      request,
      "INTERNAL_ERROR",
      message,
      500,
      undefined,
      { route: "/api/calendar/month", method: "GET" },
      err,
    );
  }
}
