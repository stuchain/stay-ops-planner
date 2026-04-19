import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseYearMonthParam } from "@/modules/calendar/monthBounds";
import { getCalendarMonthAggregate } from "@/modules/calendar/monthAggregate";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";

const QuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM"),
});

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const url = new URL(request.url);
  const raw = { month: url.searchParams.get("month") ?? "" };
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid query", parsed.error.flatten()),
      { status: 400 },
    );
  }

  if (!parseYearMonthParam(parsed.data.month)) {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid month"), { status: 400 });
  }

  const timeZone = process.env.APP_TIMEZONE?.trim() || "Etc/UTC";

  try {
    const data = await getCalendarMonthAggregate({
      yearMonth: parsed.data.month,
      timeZone,
    });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[api/calendar/month]", err);
    const message =
      process.env.NODE_ENV === "development" && err instanceof Error
        ? err.message
        : "Could not load calendar data.";
    return NextResponse.json(jsonError("INTERNAL_ERROR", message), { status: 500 });
  }
}
