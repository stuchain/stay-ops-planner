import ExcelJS from "exceljs";

/**
 * A small copy of the family's calendar sheet layout (Φύλλο1): two months side by side, a banner per month, a row
 * per week, 4 columns per day (Onar, Cosmos, Iris, Helios) and the day number in the first. Made in the test so no
 * real guest names are stored in the repository.
 */

const LEFT = [5, 9, 13, 17, 21, 26, 30];
const RIGHT = [36, 40, 44, 48, 52, 56, 60];
const MONTH_NAMES = [
  "ΙΑΝΟΥΑΡΙΟΣ",
  "ΦΕΒΡΟΥΑΡΙΟΣ",
  "ΜΑΡΤΙΟΣ",
  "ΑΠΡΙΛΙΟΣ",
  "ΜΑΪΟΣ",
  "ΙΟΥΝΙΟΣ",
  "ΙΟΥΛΙΟΣ",
  "ΑΥΓΟΥΣΤΟΣ",
  "ΣΕΠΤΕΜΒΡΙΟΣ",
  "ΟΚΤΩΒΡΙΟΣ",
  "ΝΟΕΜΒΡΙΟΣ",
  "ΔΕΚΕΜΒΡΙΟΣ",
];
const WEEKDAYS = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"];

export type PaperEntry = { date: string; apartment: 0 | 1 | 2 | 3; text: string };

export type PaperOptions = {
  /** A wrong year written in one month's banner, as in the real file. */
  bannerYear?: Record<number, number>;
  /** Days whose number is missing from the first column. */
  noDayNumber?: string[];
  /** Stray typing far below the calendar. */
  stray?: string;
};

export async function paperCalendarWorkbook(
  year: number,
  entries: PaperEntry[],
  options: PaperOptions = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Φύλλο1");
  const text = new Map(entries.map((e) => [`${e.date}|${e.apartment}`, e.text]));
  const months = [...new Set(entries.map((e) => Number(e.date.slice(5, 7))))].sort((a, b) => a - b);
  months.forEach((month, i) => {
    const side = i % 2 === 0 ? LEFT : RIGHT;
    const banner = 4 + Math.floor(i / 2) * 10;
    sheet.getCell(banner, side[0]!).value = `${MONTH_NAMES[month - 1]} ${options.bannerYear?.[month] ?? year}`;
    WEEKDAYS.forEach((w, k) => (sheet.getCell(banner + 1, side[k]!).value = w));
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      const iso = date.toISOString().slice(0, 10);
      const weekday = (date.getUTCDay() + 6) % 7;
      const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
      const row = banner + 2 + Math.floor((day - 1 + firstWeekday) / 7);
      const start = side[weekday]!;
      const number = options.noDayNumber?.includes(iso) ? "" : `${day}`;
      const onar = text.get(`${iso}|0`);
      sheet.getCell(row, start).value = onar ? `${number}  ${onar}` : number === "" ? null : day;
      for (const apartment of [1, 2, 3]) {
        const value = text.get(`${iso}|${apartment}`);
        if (value) sheet.getCell(row, start + apartment).value = value;
      }
    }
  });
  if (options.stray) sheet.getCell(150, 9).value = options.stray;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
