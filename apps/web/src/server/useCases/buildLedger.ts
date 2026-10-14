import { BookingStatus, Prisma, type Channel } from "@stay-ops/db";
import {
  applyLedgerOverrides,
  defaultTaxRules,
  incomeFor,
  isRentalIndex,
  ledgerTax,
  ledgerTotals,
  readLedgerOverrides,
  rentalBucketFor,
  TaxBracketsSchema,
  type IncomeBasis,
  type IncomeKind,
  type LedgerField,
  type LedgerOverrides,
  type LedgerTax,
  type LedgerTotals,
  type LedgerValues,
  type RentalBucketSource,
  type RentalIndex,
  type ShownLedgerRow,
  type TaxRules,
} from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { getOrCreateExcelRentalConfig } from "@/modules/excel/rentalConfig";
import { dbDateToIso, todayIso } from "@/server/time";

type Db = Prisma.TransactionClient | typeof prisma;

export interface LedgerApartment {
  readonly index: RentalIndex;
  /** The column label the accountant's sheet uses (Settings), e.g. "Onar". */
  readonly label: string;
  readonly color: string | null;
}

export interface LedgerRowView {
  /** Booking id for booking rows, entry id for manual rows. */
  readonly key: string;
  readonly bookingId: string | null;
  readonly entryId: string | null;
  readonly manual: boolean;
  readonly checkin: string | null;
  readonly checkout: string | null;
  /** Check-in month, 1–12; manual rows carry their own. */
  readonly month: number;
  readonly channel: Channel | null;
  readonly status: BookingStatus | null;
  readonly kind: IncomeKind | "manual";
  readonly counts: boolean;
  readonly auto: LedgerValues;
  readonly shown: Omit<ShownLedgerRow, "overridden">;
  readonly overrides: LedgerOverrides;
  readonly overridden: readonly LedgerField[];
  readonly bucketSource: RentalBucketSource;
  readonly stayedRentalIndex: RentalIndex | null;
  readonly foreignCurrency: boolean;
  /** Hosthub's amount changed after the row was corrected (E3-6). */
  readonly hosthubChanged: boolean;
  /** The entry's version, for edits (0 when the row has no corrections yet). */
  readonly version: number;
}

export interface LedgerYear {
  readonly year: number;
  /** Every year with bookings, plus this year and next (E3-13). */
  readonly years: readonly number[];
  readonly rules: TaxRules;
  readonly apartments: readonly LedgerApartment[];
  readonly rows: readonly LedgerRowView[];
  readonly totals: LedgerTotals;
  readonly tax: LedgerTax;
}

/** Amounts Hosthub reported when a row was last corrected. */
export interface HosthubSnapshot {
  readonly grossCents: number;
  readonly payoutCents: number;
}

export function readHosthubSnapshot(value: unknown): HosthubSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (!Number.isSafeInteger(o.grossCents) || !Number.isSafeInteger(o.payoutCents)) return null;
  return { grossCents: o.grossCents as number, payoutCents: o.payoutCents as number };
}

function yearBounds(year: number): { gte: Date; lt: Date } {
  return { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
}

/** "1-5/8/", "28/7-3/8", "28/12/25-4/1/26": the date style of the accountant's sheet. */
export function formatStayRange(from: Date, to: Date): string {
  const [d1, m1, y1] = [from.getUTCDate(), from.getUTCMonth() + 1, from.getUTCFullYear()];
  const [d2, m2, y2] = [to.getUTCDate(), to.getUTCMonth() + 1, to.getUTCFullYear()];
  if (y1 === y2 && m1 === m2) return `${d1}-${d2}/${m1}/`;
  if (y1 === y2) return `${d1}/${m1}-${d2}/${m2}`;
  return `${d1}/${m1}/${String(y1).slice(2)}-${d2}/${m2}/${String(y2).slice(2)}`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A passport or ID number when Hosthub sent one (display only; never money). */
function passportFrom(rawPayload: unknown): string {
  if (!rawPayload || typeof rawPayload !== "object") return "";
  const raw = rawPayload as Record<string, unknown>;
  const guest = (raw.guest && typeof raw.guest === "object" ? raw.guest : {}) as Record<string, unknown>;
  return (
    asString(raw.guest_identification_number) ??
    asString(guest.identification_number) ??
    asString(guest.passport) ??
    asString(guest.document_number) ??
    ""
  );
}

function guestCount(b: {
  guestTotal: number | null;
  guestAdults: number | null;
  guestChildren: number | null;
  guestInfants: number | null;
}): number | null {
  if (b.guestTotal != null && b.guestTotal > 0) return b.guestTotal;
  const sum = (b.guestAdults ?? 0) + (b.guestChildren ?? 0) + (b.guestInfants ?? 0);
  return sum > 0 ? sum : null;
}

export async function loadTaxRules(db: Db, year: number): Promise<TaxRules> {
  const row = await db.taxRule.findUnique({ where: { year } });
  if (!row) return defaultTaxRules(year);
  const brackets = TaxBracketsSchema.safeParse(row.brackets);
  return {
    year,
    brackets: brackets.success ? brackets.data : defaultTaxRules(year).brackets,
    scope: row.scope === "per_apartment" ? "per_apartment" : "total",
    incomeBasis: row.incomeBasis === "payout" ? "payout" : "gross",
    confirmed: row.confirmed && brackets.success,
  };
}

async function ledgerYears(db: Db, today: string): Promise<number[]> {
  const current = Number(today.slice(0, 4));
  const rows = await db.$queryRaw<{ year: number }[]>`
    SELECT DISTINCT EXTRACT(YEAR FROM checkin_date)::int AS year FROM bookings
    UNION SELECT DISTINCT year FROM ledger_entries WHERE year IS NOT NULL`;
  const set = new Set<number>([current, current + 1, ...rows.map((r) => Number(r.year))]);
  return [...set].sort((a, b) => a - b);
}

async function loadApartments(db: Db): Promise<LedgerApartment[]> {
  const [labels, rooms] = await Promise.all([
    getOrCreateExcelRentalConfig(db as typeof prisma),
    db.room.findMany({ where: { rentalIndex: { not: null } }, select: { rentalIndex: true, color: true } }),
  ]);
  const colorOf = new Map(rooms.map((r) => [r.rentalIndex, r.color]));
  return ([1, 2, 3, 4] as const).map((index) => ({
    index,
    label: labels[`label${index}`],
    color: colorOf.get(index) ?? null,
  }));
}

const bookingInclude = {
  sourceListing: { select: { rentalIndex: true } },
  assignments: {
    orderBy: { startDate: "asc" },
    select: { room: { select: { displayName: true, code: true, rentalIndex: true } } },
  },
  ledgerEntry: true,
} satisfies Prisma.BookingInclude;

type LedgerBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** The automatic row for a booking, its income, and which apartment it counts for. */
export function bookingRow(b: LedgerBooking, basis: IncomeBasis): LedgerRowView {
  const income = incomeFor({
    channel: b.channel,
    status: b.status,
    totalValueCents: b.totalValueCents,
    bookingValueCents: b.totalAmountCents,
    payoutCents: b.payoutAmountCents,
    cleaningFeeCents: b.cleaningFeeCents,
    currency: b.currency,
  });
  // One row per booking whatever the number of apartments, so a guest who moved is counted once. A direct
  // booking counts for the apartment the guest arrived in (the first piece).
  const pieces = b.assignments.map((a) => a.room);
  const room = pieces[0] ?? null;
  const bucket = rentalBucketFor({
    channel: b.channel,
    listingRentalIndex: b.sourceListing?.rentalIndex ?? null,
    stayedRentalIndex: room?.rentalIndex ?? null,
  });
  const auto: LedgerValues = {
    name: (b.guestName ?? "").trim().toUpperCase(),
    guestCount: guestCount(b),
    passport: passportFrom(b.rawPayload),
    roomLocation: pieces.map((r) => (r.displayName ?? r.code ?? "").trim()).join(" → "),
    dateRange: formatStayRange(b.checkinDate, b.checkoutDate),
    nights: b.nights,
    airbnbCents: b.channel === "airbnb" ? income.grossCents : null,
    bookingCents: b.channel === "booking" ? income.grossCents : null,
    contractCents: null,
    soloCents: b.channel === "direct" ? income.grossCents : null,
    prepaymentCents: null,
    payoutCents: income.payoutCents,
    rentalIndex: bucket.index,
  };
  const entry = b.ledgerEntry;
  const overrides = readLedgerOverrides(entry?.overrides);
  const { overridden, ...shown } = applyLedgerOverrides(auto, overrides, basis);
  const snapshot = readHosthubSnapshot(entry?.hosthubSnapshot);
  const checkin = dbDateToIso(b.checkinDate);
  return {
    key: b.id,
    bookingId: b.id,
    entryId: entry?.id ?? null,
    manual: false,
    checkin,
    checkout: dbDateToIso(b.checkoutDate),
    month: Number(checkin.slice(5, 7)),
    channel: b.channel,
    status: b.status,
    kind: income.kind,
    counts: income.counts,
    auto,
    shown,
    overrides,
    overridden: [...overridden],
    bucketSource: overridden.has("rentalIndex") ? "override" : bucket.source,
    stayedRentalIndex: bucket.stayedIndex,
    foreignCurrency: income.foreignCurrency,
    hosthubChanged:
      snapshot !== null && (snapshot.grossCents !== income.grossCents || snapshot.payoutCents !== income.payoutCents),
    version: entry?.version ?? 0,
  };
}

type ManualEntry = { id: string; month: number | null; label: string | null; overrides: unknown; version: number };

export function emptyLedgerValues(name = ""): LedgerValues {
  return {
    name,
    guestCount: null,
    passport: "",
    roomLocation: "",
    dateRange: "",
    nights: null,
    airbnbCents: null,
    bookingCents: null,
    contractCents: null,
    soloCents: null,
    prepaymentCents: null,
    payoutCents: null,
    rentalIndex: null,
  };
}

export function manualRow(entry: ManualEntry, basis: IncomeBasis): LedgerRowView {
  const auto = emptyLedgerValues((entry.label ?? "").trim().toUpperCase());
  const overrides = readLedgerOverrides(entry.overrides);
  const { overridden, ...shown } = applyLedgerOverrides(auto, overrides, basis);
  return {
    key: entry.id,
    bookingId: null,
    entryId: entry.id,
    manual: true,
    checkin: null,
    checkout: null,
    month: entry.month ?? 1,
    channel: null,
    status: null,
    kind: "manual",
    counts: true,
    auto,
    shown,
    overrides,
    overridden: [...overridden],
    bucketSource: isRentalIndex(shown.rentalIndex) ? "override" : "none",
    stayedRentalIndex: null,
    foreignCurrency: false,
    hosthubChanged: false,
    version: entry.version,
  };
}

/**
 * The year's ledger: every booking checked in that year (cancelled ones included, counted
 * for what was paid out), the manual rows, the corrections, totals and the tax estimate.
 * Screen and export both read this, so they always agree (E3-1).
 */
export async function buildLedger(year: number, db: Db = prisma, now: Date = new Date()): Promise<LedgerYear> {
  const [rules, years, apartments, bookings, manuals] = await Promise.all([
    loadTaxRules(db, year),
    ledgerYears(db, todayIso(now)),
    loadApartments(db),
    db.booking.findMany({
      where: { checkinDate: yearBounds(year) },
      orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
      include: bookingInclude,
    }),
    db.ledgerEntry.findMany({
      where: { bookingId: null, year },
      orderBy: [{ month: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const basis = rules.incomeBasis;
  const rows = [...bookings.map((b) => bookingRow(b, basis)), ...manuals.map((m) => manualRow(m, basis))].sort(
    (a, b) =>
      a.month - b.month ||
      Number(a.manual) - Number(b.manual) ||
      (a.checkin ?? "").localeCompare(b.checkin ?? "") ||
      a.key.localeCompare(b.key),
  );
  const totals = ledgerTotals(rows, basis);
  return { year, years, rules, apartments, rows, totals, tax: ledgerTax(totals, rules) };
}
