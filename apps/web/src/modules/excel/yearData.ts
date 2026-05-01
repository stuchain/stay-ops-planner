import type { BookingStatus, Channel, Prisma, PrismaClient } from "@stay-ops/db";
import {
  applyOverrides,
  buildAutoRow,
  emptyManualAutoRow,
  type BookingForLedger,
  type LedgerRow,
  type Overrides,
} from "@/modules/excel/ledger";
import { isMissingExcelLedgerTableError } from "@/modules/excel/dbErrors";

export type ExcelApiRow = {
  entryId: string | null;
  bookingId: string | null;
  manual: boolean;
  sortCheckin: string | null;
  /** Booking channel; null for manual ledger rows. */
  channel: Channel | null;
  /** Booking lifecycle status; null for manual ledger rows. */
  status: BookingStatus | null;
  auto: LedgerRow;
  overrides: Overrides | null;
};

function startOfYearUtc(year: number): Date {
  return new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
}

function endOfYearUtc(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
}

type BookingLedgerRow = Prisma.BookingGetPayload<{
  include: {
    sourceListing: { select: { title: true; rentalIndex: true } };
    assignment: { include: { room: { select: { displayName: true } } } };
  };
}>;

function bookingToLedgerInput(b: BookingLedgerRow): BookingForLedger {
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

export async function loadLedgerRowsForYear(prisma: PrismaClient, year: number): Promise<ExcelApiRow[]> {
  const bookings = await prisma.booking.findMany({
    where: {
      checkinDate: {
        gte: startOfYearUtc(year),
        lte: endOfYearUtc(year),
      },
    },
    orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
    include: {
      sourceListing: { select: { title: true, rentalIndex: true } },
      assignment: { include: { room: { select: { displayName: true } } } },
    },
  });

  let ledgerRows: Awaited<ReturnType<typeof prisma.excelLedgerEntry.findMany>> = [];
  try {
    ledgerRows = await prisma.excelLedgerEntry.findMany({
      where: { year },
    });
  } catch (err) {
    if (!isMissingExcelLedgerTableError(err)) {
      throw err;
    }
  }
  const byBookingId = new Map<string, (typeof ledgerRows)[number]>();
  const manuals: (typeof ledgerRows)[number][] = [];
  for (const row of ledgerRows) {
    if (row.bookingId) byBookingId.set(row.bookingId, row);
    else manuals.push(row);
  }
  manuals.sort((a, b) => {
    const ma = a.manualMonth ?? 0;
    const mb = b.manualMonth ?? 0;
    if (ma !== mb) return ma - mb;
    return (a.manualName ?? "").localeCompare(b.manualName ?? "", undefined, { sensitivity: "base" });
  });

  const bookingApiRows: ExcelApiRow[] = bookings.map((b) => {
    const entry = byBookingId.get(b.id);
    const auto = buildAutoRow(bookingToLedgerInput(b));
    const overrides = (entry?.overrides as Overrides | null) ?? null;
    return {
      entryId: entry?.id ?? null,
      bookingId: b.id,
      manual: false,
      sortCheckin: b.checkinDate.toISOString().slice(0, 10),
      channel: b.channel,
      status: b.status,
      auto,
      overrides,
    };
  });

  const manualApiRows: ExcelApiRow[] = manuals.map((entry) => {
    const name = entry.manualName?.trim().toUpperCase() ?? "";
    const auto: LedgerRow = { ...emptyManualAutoRow(), name, guestCount: null };
    const overrides = (entry.overrides as Overrides | null) ?? null;
    const mm = entry.manualMonth ?? 1;
    const sortCheckin = `${year}-${String(mm).padStart(2, "0")}-99`;
    return {
      entryId: entry.id,
      bookingId: null,
      manual: true,
      sortCheckin,
      channel: null,
      status: null,
      auto,
      overrides,
    };
  });

  return [...bookingApiRows, ...manualApiRows].sort((a, b) => {
    const da = a.sortCheckin ?? "";
    const db = b.sortCheckin ?? "";
    if (da !== db) return da.localeCompare(db);
    if (a.manual !== b.manual) return a.manual ? 1 : -1;
    return (a.bookingId ?? a.entryId ?? "").localeCompare(b.bookingId ?? b.entryId ?? "");
  });
}

export function displayedRow(r: ExcelApiRow): LedgerRow {
  return applyOverrides(r.auto, r.overrides);
}
