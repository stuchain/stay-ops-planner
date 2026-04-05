import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingStatus, Channel } from "@stay-ops/db";
import { listUnassignedBookings } from "../../../../modules/allocation/service";
import { AuthError, jsonError } from "../../../../modules/auth/errors";
import { requireAdminSession } from "../../../../modules/auth/guard";

const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const QuerySchema = z.object({
  from: DateOnly,
  to: DateOnly,
  channel: z.nativeEnum(Channel).optional(),
  status: z.nativeEnum(BookingStatus).optional(),
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
  const raw = {
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    channel: url.searchParams.get("channel") || undefined,
    status: url.searchParams.get("status") || undefined,
  };

  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid query", parsed.error.flatten()),
      { status: 400 },
    );
  }

  if (!(parsed.data.from < parsed.data.to)) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "from must be strictly before to"),
      { status: 400 },
    );
  }

  const rows = await listUnassignedBookings({
    from: parsed.data.from,
    to: parsed.data.to,
    channel: parsed.data.channel,
    status: parsed.data.status,
  });

  return NextResponse.json({
    data: {
      bookings: rows.map((b) => ({
        id: b.id,
        channel: b.channel,
        externalBookingId: b.externalBookingId,
        status: b.status,
        checkinDate: b.checkinDate.toISOString().slice(0, 10),
        checkoutDate: b.checkoutDate.toISOString().slice(0, 10),
        nights: b.nights,
      })),
    },
    meta: { total: rows.length },
  });
}
