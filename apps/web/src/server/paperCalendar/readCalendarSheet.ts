import ExcelJS from "exceljs";
import { isIsoDate, type IsoDate, type PaperNight } from "@stay-ops/domain";

/**
 * Reads the family's calendar sheet (Φύλλο1 of imerologio-2026.xlsx). Its layout, from the file itself:
 * - two months side by side; each month starts with a banner row "ΙΑΝΟΥΑΡΙΟΣ 2026" and has one row per week;
 * - each day is a block of 4 columns, one per apartment in the calendar's order (Onar, Cosmos, Iris, Helios);
 * - the first column of a block also holds the day number: "1" when free, "1  TODNER  2" when Onar is taken;
 * - a guest's name is written in every night's cell (not on the check-out day), with the number of guests.
 */

const MONTHS: Readonly<Record<string, number>> = {
  ΙΑΝΟΥΑΡΙΟΣ: 1,
  ΦΕΒΡΟΥΑΡΙΟΣ: 2,
  ΜΑΡΤΙΟΣ: 3,
  ΑΠΡΙΛΙΟΣ: 4,
  ΜΑΙΟΣ: 5,
  ΙΟΥΝΙΟΣ: 6,
  ΙΟΥΛΙΟΣ: 7,
  ΑΥΓΟΥΣΤΟΣ: 8,
  ΣΕΠΤΕΜΒΡΙΟΣ: 9,
  ΟΚΤΩΒΡΙΟΣ: 10,
  ΝΟΕΜΒΡΙΟΣ: 11,
  ΔΕΚΕΜΒΡΙΟΣ: 12,
};

const WEEKDAYS = new Set(["ΔΕΥΤΕΡΑ", "ΤΡΙΤΗ", "ΤΕΤΑΡΤΗ", "ΠΕΜΠΤΗ", "ΠΑΡΑΣΚΕΥΗ", "ΣΑΒΒΑΤΟ", "ΚΥΡΙΑΚΗ"]);

/** First column of each day's block (E, I, M, Q, U, Z, AD on the left; AJ … BH on the right). Column Y is hidden. */
const LEFT = [5, 9, 13, 17, 21, 26, 30];
const RIGHT = [36, 40, 44, 48, 52, 56, 60];
/** Week rows sit right under their month's banner; anything further down is stray typing. */
const WEEK_ROWS = 8;

export const PAPER_APARTMENTS = ["Onar", "Cosmos", "Iris", "Helios"] as const;

export class CalendarSheetError extends Error {}

function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().trim();
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value instanceof Date) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof value.text === "string") return value.text;
  }
  return "";
}

function blockOf(column: number): { side: number[]; index: number; offset: number } | null {
  for (const side of [LEFT, RIGHT]) {
    const index = side.findIndex((start) => column >= start && column < start + 4);
    if (index >= 0) return { side, index, offset: column - side[index]! };
  }
  return null;
}

function dayNumber(text: string): number | null {
  const match = /^\s*(\d{1,2})(?!\d)/.exec(text);
  return match ? Number(match[1]) : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Every filled night in the calendar sheet. */
export async function readCalendarSheet(file: Buffer | ArrayBuffer): Promise<PaperNight[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file as ArrayBuffer);
  } catch {
    throw new CalendarSheetError("not an xlsx file");
  }
  const sheet = workbook.getWorksheet("Φύλλο1") ?? workbook.worksheets[0];
  if (!sheet) throw new CalendarSheetError("no sheet");

  const text = (row: number, column: number) => cellText(sheet.getCell(row, column).value);

  // Month banners per side. A wrong year in one banner (Feb says 2025) loses to the year most banners have.
  const banners: { row: number; side: number[]; month: number; year: number }[] = [];
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, column) => {
      const words = plain(cellText(cell.value)).split(/\s+/);
      const month = MONTHS[words[0] ?? ""];
      if (month && words.length === 2 && /^\d{4}$/.test(words[1]!)) {
        banners.push({ row: rowNumber, side: column < RIGHT[0]! - 2 ? LEFT : RIGHT, month, year: Number(words[1]) });
      }
    });
  });
  if (banners.length === 0) throw new CalendarSheetError("no months");
  const years = new Map<number, number>();
  for (const b of banners) years.set(b.year, (years.get(b.year) ?? 0) + 1);
  const year = [...years.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  const monthAt = (row: number, side: number[]) => {
    let best: (typeof banners)[number] | null = null;
    for (const b of banners) if (b.side === side && b.row < row && (!best || b.row > best.row)) best = b;
    return best && row - best.row <= WEEK_ROWS ? best.month : null;
  };

  // The day of a block: its own number, or worked out from the other days in the week or the week below.
  const dayAt = (row: number, side: number[], index: number): number | null => {
    const own = dayNumber(text(row, side[index]!));
    if (own !== null) return own;
    for (let k = 0; k < side.length; k++) {
      const other = dayNumber(text(row, side[k]!));
      if (other !== null) return other + (index - k);
    }
    const below = dayNumber(text(row + 1, side[index]!));
    return below !== null ? below - 7 : null;
  };

  const nights: PaperNight[] = [];
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, column) => {
      const block = blockOf(column);
      if (!block) return;
      let value = cellText(cell.value);
      if (block.offset === 0) value = value.replace(/^\s*\d+/, "");
      const word = plain(value);
      if (!word || WEEKDAYS.has(word) || MONTHS[word.split(/\s+/)[0] ?? ""]) return;
      const month = monthAt(rowNumber, block.side);
      const day = dayAt(rowNumber, block.side, block.index);
      if (month === null || day === null) return;
      const date = `${year}-${pad(month)}-${pad(day)}`;
      if (!isIsoDate(date)) return;
      nights.push({ date: date as IsoDate, apartment: block.offset, text: value.trim() });
    });
  });
  return nights;
}
