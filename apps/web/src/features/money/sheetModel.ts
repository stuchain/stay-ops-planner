import { bucketAmount, parseEuroInput, type IncomeBasis, type LedgerField, type LedgerValues } from "@stay-ops/domain";
import type { LedgerRowData } from "@/api/types";

/**
 * "Σαν το Excel": the year laid out like the father's spreadsheet (Φύλλο3), column for column.
 * Column D (ROOM LOCATION) is hidden in his sheet, so it is left out here too.
 */
export type SheetCellKind = "name" | "text" | "count" | "money" | "apartment";
export type SheetColumn = {
  readonly field: LedgerField;
  readonly letter: string;
  readonly kind: SheetCellKind;
  /** Width in CSS pixels at 100%, from the sheet's own column widths. */
  readonly width: number;
  /** A thick black line on this side, as in the sheet. */
  readonly thick?: "left" | "right";
};

export const SHEET_COLUMNS: readonly SheetColumn[] = [
  { field: "name", letter: "B", kind: "name", width: 230 },
  { field: "passport", letter: "C", kind: "text", width: 112 },
  { field: "dateRange", letter: "E", kind: "text", width: 100, thick: "left" },
  { field: "nights", letter: "F", kind: "count", width: 62 },
  { field: "airbnbCents", letter: "G", kind: "money", width: 72 },
  { field: "bookingCents", letter: "H", kind: "money", width: 76 },
  { field: "contractCents", letter: "I", kind: "money", width: 60 },
  { field: "soloCents", letter: "J", kind: "money", width: 64 },
  { field: "prepaymentCents", letter: "K", kind: "money", width: 70 },
  { field: "payoutCents", letter: "L", kind: "money", width: 76 },
  { field: "rentalIndex", letter: "M", kind: "apartment", width: 40, thick: "right" },
  { field: "rental1Cents", letter: "N", kind: "money", width: 66 },
  { field: "rental2Cents", letter: "O", kind: "money", width: 66 },
  { field: "rental3Cents", letter: "P", kind: "money", width: 66 },
  { field: "rental4Cents", letter: "Q", kind: "money", width: 66, thick: "right" },
];

const RENTAL_FIELDS = ["rental1Cents", "rental2Cents", "rental3Cents", "rental4Cents"] as const;

/** Empty lines under each month, where a new row can be typed in. */
export const SPARE_LINES = 2;

export type SheetLine =
  | { readonly type: "month"; readonly key: string; readonly month: number; readonly line: number }
  | {
      readonly type: "row";
      readonly key: string;
      readonly month: number;
      readonly line: number;
      readonly row: LedgerRowData;
    }
  | { readonly type: "spare"; readonly key: string; readonly month: number; readonly line: number };

/** Row 1 is the header; then each month: its purple band, its rows, and a few empty lines. */
export function sheetLines(rows: readonly LedgerRowData[], spare = SPARE_LINES): SheetLine[] {
  const out: SheetLine[] = [];
  let line = 2;
  for (let month = 1; month <= 12; month++) {
    out.push({ type: "month", key: `month-${month}`, month, line: line++ });
    for (const row of rows) {
      if (row.month === month) out.push({ type: "row", key: row.key, month, line: line++, row });
    }
    for (let i = 0; i < spare; i++) out.push({ type: "spare", key: `spare-${month}-${i}`, month, line: line++ });
  }
  return out;
}

export type CellValue = string | number | null;

/** What the cell holds now, and what Hosthub would put there. */
export function cellValues(
  row: LedgerRowData,
  field: LedgerField,
  basis: IncomeBasis,
): { shown: CellValue; auto: CellValue } {
  const rental = RENTAL_FIELDS.indexOf(field as (typeof RENTAL_FIELDS)[number]);
  if (rental >= 0) {
    const auto = row.auto.rentalIndex === rental + 1 ? bucketAmount(row.auto as LedgerValues, basis) : null;
    return { shown: row.shown.rentalCents[rental] ?? null, auto };
  }
  const key = field as keyof LedgerValues;
  return { shown: (row.shown[key] ?? null) as CellValue, auto: (row.auto[key] ?? null) as CellValue };
}

/** An amount the way his Excel shows it: no € sign, no thousands dots, cents only when there are some ("694,71", "1680", "1066,3"). */
export function sheetAmount(value: number | null): string {
  if (value === null) return "";
  const euros = value / 100;
  if (Number.isInteger(euros)) return String(euros);
  return euros.toFixed(2).replace(/0$/, "").replace(".", ",");
}

/** The name cell holds the guests too, like "VERENA MUNSTERMANN 2". */
function nameText(row: LedgerRowData): string {
  const { name, guestCount } = row.shown;
  return guestCount === null || row.manual ? name : `${name} ${guestCount}`;
}

/** What the cell shows. */
export function cellText(row: LedgerRowData, column: SheetColumn, basis: IncomeBasis): string {
  if (column.kind === "name") return nameText(row);
  const { shown } = cellValues(row, column.field, basis);
  if (shown === null || shown === "") return "";
  if (column.kind === "money") return sheetAmount(shown as number);
  return String(shown);
}

/** The text a cell starts with when it is opened for typing. */
export const editText = cellText;

export type ParsedCell =
  | { readonly ok: true; readonly values: Partial<Record<LedgerField, CellValue>> }
  | { readonly ok: false; readonly error: "badAmount" | "badNumber" | "badApartment" };

/**
 * Reads what was typed into a cell. An empty cell is a blank on purpose (null).
 * In the name cell a number at the end is the number of guests, as in the sheet.
 */
export function parseCell(column: SheetColumn, text: string, manual = false): ParsedCell {
  const s = text.trim();
  switch (column.kind) {
    case "name": {
      if (manual) return { ok: true, values: { name: s } };
      const guests = /^(.*\S)\s+(\d{1,2})$/.exec(s);
      return guests
        ? { ok: true, values: { name: guests[1]!, guestCount: Number(guests[2]) } }
        : { ok: true, values: { name: s || null, guestCount: null } };
    }
    case "text":
      return { ok: true, values: { [column.field]: s || null } };
    case "count":
      if (!s) return { ok: true, values: { [column.field]: null } };
      return /^\d+$/.test(s) ? { ok: true, values: { [column.field]: Number(s) } } : { ok: false, error: "badNumber" };
    case "apartment":
      if (!s) return { ok: true, values: { rentalIndex: null } };
      return /^[1-4]$/.test(s)
        ? { ok: true, values: { rentalIndex: Number(s) } }
        : { ok: false, error: "badApartment" };
    case "money": {
      if (!s) return { ok: true, values: { [column.field]: null } };
      const parsed = parseEuroInput(s);
      return parsed.ok ? { ok: true, values: { [column.field]: parsed.cents } } : { ok: false, error: "badAmount" };
    }
  }
}

/**
 * The correction to save: only fields that change. Typing back Hosthub's own value
 * drops the correction instead of storing a copy of it.
 */
export function patchFor(
  row: LedgerRowData,
  values: Partial<Record<LedgerField, CellValue>>,
  basis: IncomeBasis,
): Partial<Record<LedgerField, CellValue | "revert">> {
  const patch: Partial<Record<LedgerField, CellValue | "revert">> = {};
  for (const [key, value] of Object.entries(values) as [LedgerField, CellValue][]) {
    const { shown, auto } = cellValues(row, key, basis);
    const same = (a: CellValue, b: CellValue) => (a ?? "") === (b ?? "");
    if (same(shown, value)) continue;
    patch[key] = !row.manual && same(auto, value) ? "revert" : value;
  }
  return patch;
}

export type SheetTone = "direct" | "platform" | "cancelled" | "pending" | "manual";

/** How the sheet colours a row: orange for direct, red payout for Airbnb/Booking, dark grey for cancelled. */
export function rowTone(row: LedgerRowData): SheetTone {
  if (row.manual) return "manual";
  if (row.kind === "cancelled_paid" || row.kind === "cancelled_unpaid") return "cancelled";
  if (row.kind === "pending") return "pending";
  return row.channel === "direct" ? "direct" : "platform";
}
