import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PrismaClient } from "@stay-ops/db";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import type { BookingWithLedgerRelations } from "@/modules/excel/bookingLedgerTypes";
import { isMissingExcelLedgerTableError } from "@/modules/excel/dbErrors";
import {
  buildAutoRow,
  emptyManualAutoRow,
  type BookingForLedger,
  type LedgerRow,
  type Overrides,
} from "@/modules/excel/ledger";

const prisma = new PrismaClient();

const ManualPostSchema = z
  .object({
    kind: z.literal("manual"),
    year: z.number().int().min(2000).max(2100),
    manualName: z.string().trim().min(1).max(200),
    manualMonth: z.number().int().min(1).max(12),
  })
  .strict();

const EnsureBookingPostSchema = z
  .object({
    kind: z.literal("ensure_booking"),
    year: z.number().int().min(2000).max(2100),
    bookingId: z.string().trim().min(1),
  })
  .strict();

const PostBodySchema = z.discriminatedUnion("kind", [ManualPostSchema, EnsureBookingPostSchema]);

function bookingToLedgerInput(b: BookingWithLedgerRelations): BookingForLedger {
  return {
    channel: b.channel,
    checkinDate: b.checkinDate,
    checkoutDate: b.checkoutDate,
    nights: b.nights,
    guestName: b.guestName,
    guestEmail: b.guestEmail,
    guestAdults: b.guestAdults,
    guestChildren: b.guestChildren,
    guestInfants: b.guestInfants,
    guestTotal: b.guestTotal,
    rawPayload: b.rawPayload,
    sourceListingTitle: b.sourceListing?.title ?? null,
    roomDisplayName: b.assignment?.room?.displayName ?? null,
    sourceListingRentalIndex: b.sourceListing?.rentalIndex ?? null,
  };
}

function rowPayload(
  entry: { id: string; bookingId: string | null; manualName: string | null; manualMonth: number | null; overrides: unknown },
  auto: LedgerRow,
): { entryId: string; bookingId: string | null; manual: boolean; auto: LedgerRow; overrides: Overrides | null } {
  return {
    entryId: entry.id,
    bookingId: entry.bookingId,
    manual: entry.bookingId == null,
    auto,
    overrides: (entry.overrides as Overrides | null) ?? null,
  };
}

export async function POST(request: NextRequest) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid JSON"), { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid body", parsed.error.flatten()), {
      status: 400,
    });
  }

  if (parsed.data.kind === "manual") {
    const { year, manualName, manualMonth } = parsed.data;
    let entry: Awaited<ReturnType<typeof prisma.excelLedgerEntry.create>>;
    try {
      entry = await prisma.excelLedgerEntry.create({
        data: {
          year,
          bookingId: null,
          manualName,
          manualMonth,
          overrides: undefined,
        },
      });
    } catch (err) {
      if (!isMissingExcelLedgerTableError(err)) throw err;
      return NextResponse.json(
        jsonError("MIGRATION_REQUIRED", "Excel ledger table is missing. Run Prisma migration first."),
        { status: 503 },
      );
    }
    const auto: LedgerRow = {
      ...emptyManualAutoRow(),
      name: manualName.trim().toUpperCase(),
      guestCount: null,
    };
    return NextResponse.json({ data: rowPayload(entry, auto) }, { status: 201 });
  }

  const { year, bookingId } = parsed.data;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      sourceListing: { select: { title: true, rentalIndex: true } },
      assignment: { include: { room: { select: { displayName: true } } } },
    },
  });
  if (!booking) {
    return NextResponse.json(jsonError("NOT_FOUND", "Booking not found"), { status: 404 });
  }

  let entry: Awaited<ReturnType<typeof prisma.excelLedgerEntry.upsert>>;
  try {
    entry = await prisma.excelLedgerEntry.upsert({
      where: {
        year_bookingId: {
          year,
          bookingId,
        },
      },
      create: {
        year,
        bookingId,
        manualName: null,
        manualMonth: null,
      },
      update: {},
    });
  } catch (err) {
    if (!isMissingExcelLedgerTableError(err)) throw err;
    return NextResponse.json(
      jsonError("MIGRATION_REQUIRED", "Excel ledger table is missing. Run Prisma migration first."),
      { status: 503 },
    );
  }

  const auto = buildAutoRow(bookingToLedgerInput(booking));
  return NextResponse.json({ data: rowPayload(entry, auto) }, { status: 200 });
}
