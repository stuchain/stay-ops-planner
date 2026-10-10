import { isRentalIndex, RENTAL_INDEXES, type RentalIndex } from "./income.js";
import { cents, sumCents, ZERO_CENTS, type Cents } from "./money.js";
import { taxFor, type IncomeBasis, type TaxCalculation, type TaxRules } from "./tax.js";

/**
 * The yearly ledger, column for column like the accountant's spreadsheet, in cents.
 * A row has automatic values (from the booking) and corrections typed by Stelios.
 * A correction is stored per field: a value, or `null` for "leave this cell blank".
 * A field with no correction shows the automatic value.
 */
export interface LedgerValues {
  readonly name: string;
  readonly guestCount: number | null;
  readonly passport: string;
  readonly roomLocation: string;
  readonly dateRange: string;
  readonly nights: number | null;
  readonly airbnbCents: Cents | null;
  readonly bookingCents: Cents | null;
  readonly contractCents: Cents | null;
  readonly soloCents: Cents | null;
  readonly prepaymentCents: Cents | null;
  readonly payoutCents: Cents | null;
  readonly rentalIndex: RentalIndex | null;
}

/** A per-apartment cell can be corrected on its own, like in the spreadsheet. */
export type RentalCellField = "rental1Cents" | "rental2Cents" | "rental3Cents" | "rental4Cents";

export type LedgerField = keyof LedgerValues | RentalCellField;

export const LEDGER_TEXT_FIELDS = ["name", "passport", "roomLocation", "dateRange"] as const;
export const LEDGER_COUNT_FIELDS = ["guestCount", "nights"] as const;
export const LEDGER_MONEY_FIELDS = [
  "airbnbCents",
  "bookingCents",
  "contractCents",
  "soloCents",
  "prepaymentCents",
  "payoutCents",
  "rental1Cents",
  "rental2Cents",
  "rental3Cents",
  "rental4Cents",
] as const;
export const LEDGER_FIELDS: readonly LedgerField[] = [
  ...LEDGER_TEXT_FIELDS,
  ...LEDGER_COUNT_FIELDS,
  ...LEDGER_MONEY_FIELDS,
  "rentalIndex",
];

export type LedgerOverrides = {
  readonly [K in LedgerField]?: K extends keyof LedgerValues ? LedgerValues[K] : Cents | null;
};

export interface ShownLedgerRow extends LedgerValues {
  /** The four apartment columns, in order. */
  readonly rentalCents: readonly [Cents | null, Cents | null, Cents | null, Cents | null];
  /** Fields whose value comes from a correction. */
  readonly overridden: ReadonlySet<LedgerField>;
}

function rentalField(index: RentalIndex): RentalCellField {
  return `rental${index}Cents`;
}

function has(o: LedgerOverrides, key: LedgerField): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/**
 * The amount that goes in the apartment column: what the guest paid (the first
 * filled channel column) or the payout, depending on the year's income basis.
 */
export function bucketAmount(row: LedgerValues, basis: IncomeBasis): Cents | null {
  if (basis === "payout") return row.payoutCents;
  return row.airbnbCents ?? row.bookingCents ?? row.contractCents ?? row.soloCents;
}

/**
 * Applies corrections. The apartment columns are worked out from the corrected
 * amount and apartment (E3-2), so a corrected price or apartment flows into the
 * totals, unless that apartment cell was itself corrected.
 */
export function applyLedgerOverrides(
  auto: LedgerValues,
  overrides: LedgerOverrides | null | undefined,
  basis: IncomeBasis,
): ShownLedgerRow {
  const o = overrides ?? {};
  const overridden = new Set<LedgerField>();
  const pick = <K extends keyof LedgerValues>(key: K): LedgerValues[K] => {
    if (!has(o, key)) return auto[key];
    overridden.add(key);
    return o[key] as LedgerValues[K];
  };
  const values: LedgerValues = {
    name: pick("name") ?? "",
    guestCount: pick("guestCount"),
    passport: pick("passport") ?? "",
    roomLocation: pick("roomLocation") ?? "",
    dateRange: pick("dateRange") ?? "",
    nights: pick("nights"),
    airbnbCents: pick("airbnbCents"),
    bookingCents: pick("bookingCents"),
    contractCents: pick("contractCents"),
    soloCents: pick("soloCents"),
    prepaymentCents: pick("prepaymentCents"),
    payoutCents: pick("payoutCents"),
    rentalIndex: pick("rentalIndex"),
  };
  const amount = bucketAmount(values, basis);
  const rentalCents = RENTAL_INDEXES.map((i) => {
    const field = rentalField(i);
    if (has(o, field)) {
      overridden.add(field);
      return o[field] ?? null;
    }
    return values.rentalIndex === i ? amount : null;
  }) as unknown as ShownLedgerRow["rentalCents"];
  return { ...values, rentalCents, overridden };
}

/** Sets or clears corrections. `undefined` leaves a field alone; `"revert"` goes back to the automatic value. */
export type LedgerPatch = { readonly [K in LedgerField]?: LedgerOverrides[K] | "revert" };

export function mergeLedgerPatch(existing: LedgerOverrides | null | undefined, patch: LedgerPatch): LedgerOverrides {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === "revert") delete next[key];
    else next[key] = value;
  }
  return next as LedgerOverrides;
}

/** Validates corrections read back from the database, dropping anything malformed. */
export function readLedgerOverrides(value: unknown): LedgerOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of LEDGER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const v = src[key];
    const ok =
      v === null ||
      ((LEDGER_TEXT_FIELDS as readonly string[]).includes(key) && typeof v === "string") ||
      ((LEDGER_COUNT_FIELDS as readonly string[]).includes(key) && Number.isSafeInteger(v) && (v as number) >= 0) ||
      ((LEDGER_MONEY_FIELDS as readonly string[]).includes(key) && Number.isSafeInteger(v)) ||
      (key === "rentalIndex" && isRentalIndex(v));
    if (ok) out[key] = v;
  }
  return out as LedgerOverrides;
}

export interface CountedRow {
  readonly shown: Omit<ShownLedgerRow, "overridden">;
  /** False for pending requests and cancellations with nothing paid. */
  readonly counts: boolean;
  /** Check-in month, 1–12. */
  readonly month: number;
}

export interface LedgerTotals {
  /** Per apartment, in column order. */
  readonly byRentalCents: readonly [Cents, Cents, Cents, Cents];
  /** Sum of the four apartment columns: the taxable income. */
  readonly totalCents: Cents;
  /** "ΣΥΝ J": direct bookings column. */
  readonly soloCents: Cents;
  /** "ΣΥΝ L": payout column. */
  readonly payoutCents: Cents;
  /** Counted rows with an amount but no apartment (E3-8): left out of the total and shown as a warning. */
  readonly unbucketedCount: number;
  readonly unbucketedCents: Cents;
  /** Per month (index 0 = January), per apartment. */
  readonly monthlyCents: readonly (readonly [Cents, Cents, Cents, Cents])[];
}

/** One totals rule for the screen and the export (E3-1). */
export function ledgerTotals(rows: readonly CountedRow[], basis: IncomeBasis): LedgerTotals {
  const byRental = [0, 0, 0, 0];
  const monthly = Array.from({ length: 12 }, () => [0, 0, 0, 0]);
  let solo = 0;
  let payout = 0;
  let unbucketedCount = 0;
  let unbucketed = 0;
  for (const { shown, counts, month } of rows) {
    if (!counts) continue;
    solo += shown.soloCents ?? 0;
    payout += shown.payoutCents ?? 0;
    let inBucket = false;
    shown.rentalCents.forEach((value, i) => {
      if (value === null) return;
      inBucket = true;
      byRental[i]! += value;
      monthly[month - 1]![i]! += value;
    });
    const amount = bucketAmount(shown, basis);
    if (!inBucket && amount !== null && amount !== 0) {
      unbucketedCount += 1;
      unbucketed += amount;
    }
  }
  const four = (list: number[]) => list.map((v) => cents(v)) as unknown as readonly [Cents, Cents, Cents, Cents];
  return {
    byRentalCents: four(byRental),
    totalCents: sumCents(byRental.map((v) => cents(v))),
    soloCents: cents(solo),
    payoutCents: cents(payout),
    unbucketedCount,
    unbucketedCents: cents(unbucketed),
    monthlyCents: monthly.map(four),
  };
}

export interface LedgerTax {
  readonly scope: TaxRules["scope"];
  /** One calculation for "total"; four (one per apartment) for "per_apartment". */
  readonly calculations: readonly TaxCalculation[];
  readonly taxCents: Cents;
}

export function ledgerTax(totals: LedgerTotals, rules: TaxRules): LedgerTax {
  const calculations =
    rules.scope === "total"
      ? [taxFor(totals.totalCents, rules.brackets)]
      : totals.byRentalCents.map((amount) => taxFor(amount, rules.brackets));
  return {
    scope: rules.scope,
    calculations,
    taxCents: calculations.reduce((sum, c) => cents(sum + c.taxCents), ZERO_CENTS),
  };
}
