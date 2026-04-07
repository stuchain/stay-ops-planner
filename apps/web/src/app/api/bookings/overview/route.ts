import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { getCalendarMonthAggregate } from "@/modules/calendar/monthAggregate";
import { parseYearMonthParam } from "@/modules/calendar/monthBounds";

const QuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM"),
});

function roomLabel(room: { code: string | null; name: string | null; id: string }): string {
  if (room.name?.trim()) return room.name.trim();
  if (room.code?.trim()) return room.code.trim();
  return room.id;
}

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
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid query", parsed.error.flatten()), {
      status: 400,
    });
  }

  if (!parseYearMonthParam(parsed.data.month)) {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid month"), { status: 400 });
  }

  const timeZone = process.env.APP_TIMEZONE?.trim() || "Etc/UTC";
  const data = await getCalendarMonthAggregate({
    yearMonth: parsed.data.month,
    timeZone,
  });

  const allRooms = data.rooms;
  const roomById = new Map(allRooms.map((room) => [room.id, room]));

  const bookingItems = data.items.filter((item) => item.kind === "booking");
  const unassigned = bookingItems
    .filter((item) => item.roomId === null)
    .map((item) => ({
      bookingId: item.id,
      guestName: item.guestName,
      checkinDate: item.startDate,
      checkoutDate: item.endDate,
      status: item.status,
      assignmentId: item.assignmentId,
      assignmentVersion: item.assignmentVersion,
    }));

  const assigned = bookingItems
    .filter((item) => item.roomId !== null)
    .map((item) => {
      const room = item.roomId ? roomById.get(item.roomId) : undefined;
      return {
        bookingId: item.id,
        guestName: item.guestName,
        checkinDate: item.startDate,
        checkoutDate: item.endDate,
        status: item.status,
        roomId: item.roomId,
        roomLabel: room ? roomLabel(room) : "Unknown room",
        assignmentId: item.assignmentId,
        assignmentVersion: item.assignmentVersion,
      };
    });

  return NextResponse.json({
    data: {
      month: data.month,
      timezone: data.timezone,
      rooms: allRooms.map((room) => ({
        id: room.id,
        label: roomLabel(room),
      })),
      unassigned,
      assigned,
    },
  });
}
