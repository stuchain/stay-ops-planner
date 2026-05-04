import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import type { BookingStatus, Channel } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { createExcelLedgerManualEntry, upsertExcelLedgerBookingEntry } from "@/modules/excel/excelAuditMutations";
import type { BookingWithLedgerRelations } from "@/modules/excel/bookingLedgerTypes";
import { isMissingExcelLedgerTableError } from "@/modules/excel/dbErrors";
import {
  buildAutoRow,
  emptyManualAutoRow,
  type BookingForLedger,
  type LedgerRow,
  type Overrides,
} from "@/modules/excel/ledger";

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
  bookingMeta: { channel: Channel; status: BookingStatus } | null,
): {
  entryId: string;
  bookingId: string | null;
  manual: boolean;
  channel: Channel | null;
  status: BookingStatus | null;
  auto: LedgerRow;
  overrides: Overrides | null;
} {
  return {
    entryId: entry.id,
    bookingId: entry.bookingId,
    manual: entry.bookingId == null,
    channel: bookingMeta?.channel ?? null,
    status: bookingMeta?.status ?? null,
    auto,
    overrides: (entry.overrides as Overrides | null) ?? null,
  };
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
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

  const auditMeta = auditMetaFromRequest(request);

  if (parsed.data.kind === "manual") {
    const { year, manualName, manualMonth } = parsed.data;
    let entry: Awaited<ReturnType<typeof createExcelLedgerManualEntry>>;
    try {
      entry = await createExcelLedgerManualEntry({
        year,
        manualName,
        manualMonth,
        actorUserId: session.userId,
        auditMeta,
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
    return NextResponse.json({ data: rowPayload(entry, auto, null) }, { status: 201 });
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

  let entry: Awaited<ReturnType<typeof upsertExcelLedgerBookingEntry>>;
  try {
    entry = await upsertExcelLedgerBookingEntry({
      year,
      bookingId,
      actorUserId: session.userId,
      auditMeta,
    });
  } catch (err) {
    if (!isMissingExcelLedgerTableError(err)) throw err;
    return NextResponse.json(
      jsonError("MIGRATION_REQUIRED", "Excel ledger table is missing. Run Prisma migration first."),
      { status: 503 },
    );
  }

  const auto = buildAutoRow(bookingToLedgerInput(booking));
  return NextResponse.json(
    { data: rowPayload(entry, auto, { channel: booking.channel, status: booking.status }) },
    { status: 200 },
  );
}
