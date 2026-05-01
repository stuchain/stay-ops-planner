import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@stay-ops/db";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import type { BookingWithLedgerRelations } from "@/modules/excel/bookingLedgerTypes";
import { isMissingExcelLedgerTableError } from "@/modules/excel/dbErrors";
import {
  buildAutoRow,
  emptyManualAutoRow,
  mergeOverridePatch,
  OverridesSchema,
  type BookingForLedger,
  type LedgerRow,
  type Overrides,
} from "@/modules/excel/ledger";

const prisma = new PrismaClient();

const PatchBodySchema = z
  .object({
    overrides: OverridesSchema.partial(),
  })
  .strict();

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

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid JSON"), { status: 400 });
  }

  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid body", parsed.error.flatten()), {
      status: 400,
    });
  }

  try {
    const existing = await prisma.excelLedgerEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(jsonError("NOT_FOUND", "Ledger entry not found"), { status: 404 });
    }

    const prevOverrides = (existing.overrides as Overrides | null) ?? null;
    const nextOverrides =
      parsed.data.overrides !== undefined
        ? mergeOverridePatch(prevOverrides, parsed.data.overrides as Record<string, unknown>)
        : prevOverrides;

    const overrideKeys = Object.keys(nextOverrides as Record<string, unknown>);
    const updated = await prisma.excelLedgerEntry.update({
      where: { id },
      data: {
        overrides:
          overrideKeys.length === 0 ? Prisma.JsonNull : (nextOverrides as Prisma.InputJsonValue),
      },
    });

    let auto: LedgerRow;
    if (updated.bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: updated.bookingId },
        include: {
          sourceListing: { select: { title: true, rentalIndex: true } },
          assignment: { include: { room: { select: { displayName: true } } } },
        },
      });
      if (!booking) {
        auto = emptyManualAutoRow();
      } else {
        auto = buildAutoRow(bookingToLedgerInput(booking));
      }
    } else {
      const name = updated.manualName?.trim().toUpperCase() ?? "";
      auto = { ...emptyManualAutoRow(), name, guestCount: null };
    }

    return NextResponse.json({ data: rowPayload(updated, auto) });
  } catch (err) {
    if (!isMissingExcelLedgerTableError(err)) throw err;
    return NextResponse.json(
      jsonError("MIGRATION_REQUIRED", "Excel ledger table is missing. Run Prisma migration first."),
      { status: 503 },
    );
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const { id } = await ctx.params;
  try {
    const existing = await prisma.excelLedgerEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(jsonError("NOT_FOUND", "Ledger entry not found"), { status: 404 });
    }

    if (existing.bookingId == null) {
      await prisma.excelLedgerEntry.delete({ where: { id } });
      return NextResponse.json({ data: { deleted: true } });
    }

    const updated = await prisma.excelLedgerEntry.update({
      where: { id },
      data: { overrides: Prisma.JsonNull },
    });

    const booking = await prisma.booking.findUnique({
      where: { id: updated.bookingId! },
      include: {
        sourceListing: { select: { title: true, rentalIndex: true } },
        assignment: { include: { room: { select: { displayName: true } } } },
      },
    });
    const auto = booking ? buildAutoRow(bookingToLedgerInput(booking)) : emptyManualAutoRow();
    return NextResponse.json({ data: { ...rowPayload(updated, auto), overridesCleared: true } });
  } catch (err) {
    if (!isMissingExcelLedgerTableError(err)) throw err;
    return NextResponse.json(
      jsonError("MIGRATION_REQUIRED", "Excel ledger table is missing. Run Prisma migration first."),
      { status: 503 },
    );
  }
}
