import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BookingStatus, Channel, Prisma, PrismaClient } from "@stay-ops/db";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { bookingListItemFromModel } from "@/modules/bookings/details";

const prisma = new PrismaClient();

const SortFieldSchema = z.enum(["updatedAt", "createdAt", "checkinDate", "checkoutDate", "totalValue"]);
const SortOrderSchema = z.enum(["asc", "desc"]);
const ReservationStatusSchema = z.enum(["all", "active", "cancelled"]);

const QuerySchema = z.object({
  channels: z.array(z.nativeEnum(Channel)).default([]),
  rentalIds: z.array(z.string().trim().min(1)).default([]),
  reservationStatus: ReservationStatusSchema.default("all"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: SortFieldSchema.default("checkinDate"),
  sortOrder: SortOrderSchema.default("asc"),
  // Legacy params kept for compatibility during migration.
  channel: z.nativeEnum(Channel).optional(),
  status: z.nativeEnum(BookingStatus).optional(),
  action: z.string().trim().min(1).max(120).optional(),
  guestName: z.string().trim().max(160).optional(),
  guestCountMin: z.coerce.number().int().min(0).optional(),
  guestCountMax: z.coerce.number().int().min(0).optional(),
  valueMin: z.coerce.number().min(0).optional(),
  valueMax: z.coerce.number().min(0).optional(),
});

function parseQuery(request: NextRequest) {
  const url = new URL(request.url);
  const channels = url.searchParams
    .getAll("channels")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const rentalIds = url.searchParams
    .getAll("rentalIds")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const raw = {
    channels,
    rentalIds,
    reservationStatus: url.searchParams.get("reservationStatus") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    sortBy: url.searchParams.get("sortBy") ?? undefined,
    sortOrder: url.searchParams.get("sortOrder") ?? undefined,
    channel: url.searchParams.get("channel") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
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
  const channels = q.channels.length > 0 ? q.channels : q.channel ? [q.channel] : [];
  const rentalIds = q.rentalIds;
  const reservationStatus = q.reservationStatus;
  const sortBy = q.sortBy;
  const sortOrder = q.sortOrder;
  const where = {
    ...(channels.length > 0 ? { channel: { in: channels } } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(reservationStatus === "active"
      ? {
          status: {
            not: BookingStatus.cancelled,
          },
        }
      : {}),
    ...(reservationStatus === "cancelled" ? { status: BookingStatus.cancelled } : {}),
    ...(rentalIds.length > 0 ? { assignment: { roomId: { in: rentalIds } } } : {}),
    ...(q.startDate || q.endDate
      ? {
          checkinDate: {
            ...(q.startDate ? { gte: new Date(`${q.startDate}T00:00:00.000Z`) } : {}),
            ...(q.endDate ? { lte: new Date(`${q.endDate}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const orderBy: Prisma.BookingOrderByWithRelationInput[] =
    sortBy === "totalValue" ? [{ checkinDate: "asc" }, { id: "asc" }] : [{ [sortBy]: sortOrder }, { id: sortOrder }];

  const bookings = await prisma.booking.findMany({
    where,
    include: {
      assignment: {
        include: {
          room: {
            select: {
              id: true,
              code: true,
              displayName: true,
            },
          },
        },
      },
    },
    orderBy,
  });

  let rows = bookings.map(bookingListItemFromModel);
  if (sortBy === "totalValue") {
    rows = rows.sort((a, b) => {
      const cmp = (a.totalValue ?? -1) - (b.totalValue ?? -1);
      if (cmp === 0) return a.id.localeCompare(b.id);
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }

  if (q.search) {
    const needle = q.search.toLowerCase();
    rows = rows.filter(
      (row) =>
        row.guestName.toLowerCase().includes(needle) || row.externalBookingId.toLowerCase().includes(needle),
    );
  }

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
