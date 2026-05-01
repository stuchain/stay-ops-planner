import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";

function startOfYearUtc(year: number): Date {
  return new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
}

function endOfYearUtc(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
}

const YearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
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

  const parsed = YearQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid query", parsed.error.flatten()), {
      status: 400,
    });
  }
  const { year } = parsed.data;
  const gte = startOfYearUtc(year);
  const lte = endOfYearUtc(year);

  const counts = await prisma.booking.groupBy({
    by: ["sourceListingId"],
    where: {
      checkinDate: { gte, lte },
      sourceListingId: { not: null },
    },
    _count: { _all: true },
  });
  const bookingCountByListingId = new Map<string, number>();
  for (const row of counts) {
    if (row.sourceListingId) bookingCountByListingId.set(row.sourceListingId, row._count._all);
  }

  const listings = await prisma.sourceListing.findMany({
    orderBy: [{ channel: "asc" }, { title: "asc" }, { externalListingId: "asc" }],
  });

  return NextResponse.json({
    data: {
      listings: listings.map((l) => ({
        id: l.id,
        channel: l.channel,
        title: l.title,
        externalListingId: l.externalListingId,
        rentalIndex: l.rentalIndex,
        bookingCount: bookingCountByListingId.get(l.id) ?? 0,
      })),
    },
  });
}
