import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { bookingListItemFromModel } from "@/modules/bookings/details";

const prisma = new PrismaClient();

const QuerySchema = z.object({
  channel: z.nativeEnum(Channel).optional(),
  status: z.nativeEnum(BookingStatus).optional(),
  dateType: z.enum(["checkinDate", "checkoutDate", "createdAt", "updatedAt"]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  action: z.string().trim().min(1).max(120).optional(),
  guestName: z.string().trim().max(160).optional(),
  guestCountMin: z.coerce.number().int().min(0).optional(),
  guestCountMax: z.coerce.number().int().min(0).optional(),
  valueMin: z.coerce.number().min(0).optional(),
  valueMax: z.coerce.number().min(0).optional(),
});

function parseQuery(request: NextRequest) {
  const url = new URL(request.url);
  const raw = {
    channel: url.searchParams.get("channel") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    dateType: url.searchParams.get("dateType") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    action: url.searchParams.get("action") ?? undefined,
    guestName: url.searchParams.get("guestName") ?? undefined,
    guestCountMin: url.searchParams.get("guestCountMin") ?? undefined,
    guestCountMax: url.searchParams.get("guestCountMax") ?? undefined,
    valueMin: url.searchParams.get("valueMin") ?? undefined,
    valueMax: url.searchParams.get("valueMax") ?? undefined,
  };
  return QuerySchema.safeParse(raw);
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

  const parsed = parseQuery(request);
  if (!parsed.success) {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid query", parsed.error.flatten()), {
      status: 400,
    });
  }

  const q = parsed.data;
  const where = {
    ...(q.channel ? { channel: q.channel } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.dateType === "checkinDate" && (q.startDate || q.endDate)
      ? {
          checkinDate: {
            ...(q.startDate ? { gte: new Date(`${q.startDate}T00:00:00.000Z`) } : {}),
            ...(q.endDate ? { lte: new Date(`${q.endDate}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(q.dateType === "checkoutDate" && (q.startDate || q.endDate)
      ? {
          checkoutDate: {
            ...(q.startDate ? { gte: new Date(`${q.startDate}T00:00:00.000Z`) } : {}),
            ...(q.endDate ? { lte: new Date(`${q.endDate}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(q.dateType === "createdAt" && (q.startDate || q.endDate)
      ? {
          createdAt: {
            ...(q.startDate ? { gte: new Date(`${q.startDate}T00:00:00.000Z`) } : {}),
            ...(q.endDate ? { lte: new Date(`${q.endDate}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(q.dateType === "updatedAt" && (q.startDate || q.endDate)
      ? {
          updatedAt: {
            ...(q.startDate ? { gte: new Date(`${q.startDate}T00:00:00.000Z`) } : {}),
            ...(q.endDate ? { lte: new Date(`${q.endDate}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const bookings = await prisma.booking.findMany({
    where,
    orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
  });

  let rows = bookings.map(bookingListItemFromModel);

  if (q.guestName) {
    const needle = q.guestName.toLowerCase();
    rows = rows.filter((row) => row.guestName.toLowerCase().includes(needle));
  }
  if (q.action) {
    const needle = q.action.toLowerCase();
    rows = rows.filter((row) => (row.action ?? "").toLowerCase().includes(needle));
  }
  if (q.guestCountMin !== undefined) {
    rows = rows.filter((row) => row.guestCount !== null && row.guestCount >= q.guestCountMin!);
  }
  if (q.guestCountMax !== undefined) {
    rows = rows.filter((row) => row.guestCount !== null && row.guestCount <= q.guestCountMax!);
  }
  if (q.valueMin !== undefined) {
    rows = rows.filter((row) => row.totalValue !== null && row.totalValue >= q.valueMin!);
  }
  if (q.valueMax !== undefined) {
    rows = rows.filter((row) => row.totalValue !== null && row.totalValue <= q.valueMax!);
  }

  return NextResponse.json({
    data: {
      items: rows,
      total: rows.length,
    },
  });
}
