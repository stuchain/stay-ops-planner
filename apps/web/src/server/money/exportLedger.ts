import ExcelJS from "exceljs";
import { centsToEuros, type Cents, type TaxBracket } from "@stay-ops/domain";
import type { LedgerRowView, LedgerYear } from "@/server/useCases/buildLedger";

/**
 * The yearly Excel file for the accountant: the same 18 columns and Greek headers as the
 * spreadsheet they already use (plus a note column), totals as formulas (E3-14), and a
 * summary sheet with the per-apartment totals and the bracket calculation.
 */

export const LEDGER_SHEET = "Φύλλο3";
export const SUMMARY_SHEET = "Σύνοψη";

const MONTHS = [
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
] as const;

const EURO_FORMAT = '#,##0.00 "€"';
const MONEY_COLUMNS = ["H", "I", "J", "K", "L", "M", "O", "P", "Q", "R"];
const RENTAL_COLUMNS = ["O", "P", "Q", "R"] as const;

export function ledgerHeaders(labels: readonly string[]): string[] {
  return [
    "Α/Α",
    "ΟΝΟΜΑ",
    "ΑΤΟΜΑ",
    "ΔΙΑΒΑΤΗΡΙΟ",
    "ROOM LOCATION",
    "ΑΦΙΞΗ - ΑΝΑΧΩΡΗΣΗ",
    "ΗΜΕΡΕΣ Χ ΤΙΜΗ",
    "AIRBNB ΔΩΜ ΠΟΣΟ",
    "BOOKING ΔΩΜ ΠΟΣΟ",
    "ΣΥΜΒΟ ΠΟΣΟ",
    "ΜΟΝΟΙ ΠΟΣΟ",
    "ΠΡΟΚ/ΛΗ",
    "ΚΑΘΑΡΟ",
    "ROOM AMA",
    ...labels,
    "ΣΗΜΕΙΩΣΗ",
  ];
}

function euros(value: Cents | null): number | null {
  return value === null ? null : centsToEuros(value);
}

/** Why a row reads differently, in plain Greek, for the note column. */
export function rowNote(row: LedgerRowView): string {
  const notes: string[] = [];
  if (row.kind === "pending") notes.push("Αίτημα, δεν μετράει");
  if (row.kind === "cancelled_paid") notes.push("Ακυρώθηκε, μετράει η πληρωμή");
  if (row.kind === "cancelled_unpaid") notes.push("Ακυρώθηκε, χωρίς πληρωμή");
  if (row.kind === "manual") notes.push("Χειροκίνητη εγγραφή");
  if (row.counts && row.shown.rentalCents.every((v) => v === null)) notes.push("Χωρίς διαμέρισμα");
  if (row.hosthubChanged) notes.push("Άλλαξε στο Hosthub");
  if (row.foreignCurrency) notes.push("Όχι σε ευρώ");
  return notes.join(" · ");
}

/** Excel formula for the bracket tax of `cell`, rounding each bracket like the app. */
export function bracketFormula(cell: string, brackets: readonly TaxBracket[]): string {
  let from = 0;
  const parts: string[] = [];
  for (const b of brackets) {
    const rate = b.rateBps / 10_000;
    const lower = from / 100;
    const upper = b.upToCents === null ? null : b.upToCents / 100;
    const portion = upper === null ? `MAX(0,${cell}-${lower})` : `MAX(0,MIN(${cell},${upper})-${lower})`;
    parts.push(`ROUND(${portion}*${rate},2)`);
    if (b.upToCents === null) break;
    from = b.upToCents;
  }
  return parts.join("+");
}

function percent(bps: number): string {
  return `${(bps / 100).toLocaleString("el-GR")}%`;
}

export async function buildLedgerWorkbook(ledger: LedgerYear): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stay Ops Planner";
  // Excel recalculates on open; the cached results are for viewers that don't (and exceljs drops zeros).
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet(LEDGER_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  const labels = ledger.apartments.map((a) => a.label);
  ws.addRow(ledgerHeaders(labels)).font = { bold: true };

  let seq = 0;
  for (let m = 1; m <= 12; m += 1) {
    const banner = ws.addRow([
      "",
      "",
      "",
      MONTHS[m - 1],
      "",
      "ΗΜΕΡΕΣ",
      "",
      "AIRBNB",
      "BOOKING",
      "",
      "",
      "ΠΡΟΚ/ΛΗ",
      "ΚΑΘΑΡΟ",
    ]);
    banner.font = { bold: true };
    for (const row of ledger.rows.filter((r) => r.month === m)) {
      seq += 1;
      const s = row.shown;
      // Rows that don't count keep their details but no amounts, so the column sums match the app.
      const money = (v: Cents | null) => (row.counts ? euros(v) : null);
      const added = ws.addRow([
        seq,
        s.name,
        s.guestCount,
        s.passport,
        s.roomLocation,
        s.dateRange,
        s.nights,
        money(s.airbnbCents),
        money(s.bookingCents),
        money(s.contractCents),
        money(s.soloCents),
        money(s.prepaymentCents),
        money(s.payoutCents),
        s.rentalIndex,
        ...s.rentalCents.map(money),
        rowNote(row),
      ]);
      if (row.kind === "cancelled_paid" || row.kind === "cancelled_unpaid") added.font = { strike: true };
      if (!row.counts) added.font = { ...added.font, color: { argb: "FF888888" } };
    }
  }
  const lastDataRow = ws.rowCount;
  const t = ledger.totals;
  ws.addRow([]);

  const totalsRow = ws.addRow([]);
  totalsRow.getCell("N").value = "ΣΥΝΟΛΑ";
  RENTAL_COLUMNS.forEach((col, i) => {
    totalsRow.getCell(col).value = {
      formula: `SUM(${col}2:${col}${lastDataRow})`,
      result: centsToEuros(t.byRentalCents[i]!),
    };
  });
  const tr = totalsRow.number;

  const grandRow = ws.addRow([]);
  grandRow.getCell("Q").value = "ΣΥΝΟΛΟ";
  grandRow.getCell("R").value = { formula: `SUM(O${tr}:R${tr})`, result: centsToEuros(t.totalCents) };
  const grandCell = `R${grandRow.number}`;

  const taxRow = ws.addRow([]);
  const rules = ledger.rules;
  if (rules.scope === "total") {
    taxRow.getCell("Q").value = "ΦΟΡΟΣ (κλίμακα)";
    taxRow.getCell("R").value = {
      formula: bracketFormula(grandCell, rules.brackets),
      result: centsToEuros(ledger.tax.taxCents),
    };
  } else {
    taxRow.getCell("N").value = "ΦΟΡΟΣ / ενοίκιο";
    RENTAL_COLUMNS.forEach((col, i) => {
      taxRow.getCell(col).value = {
        formula: bracketFormula(`${col}${tr}`, rules.brackets),
        result: centsToEuros(ledger.tax.calculations[i]!.taxCents),
      };
    });
    const taxTotal = ws.addRow([]);
    taxTotal.getCell("Q").value = "ΦΟΡΟΣ";
    taxTotal.getCell("R").value = {
      formula: `SUM(O${taxRow.number}:R${taxRow.number})`,
      result: centsToEuros(ledger.tax.taxCents),
    };
  }

  const sumsRow = ws.addRow([]);
  sumsRow.getCell("K").value = "ΣΥΝ J";
  sumsRow.getCell("L").value = { formula: `SUM(K2:K${lastDataRow})`, result: centsToEuros(t.soloCents) };
  sumsRow.getCell("M").value = "ΣΥΝ L";
  sumsRow.getCell("N").value = { formula: `SUM(M2:M${lastDataRow})`, result: centsToEuros(t.payoutCents) };
  sumsRow.getCell("N").numFmt = EURO_FORMAT;

  for (const col of MONEY_COLUMNS) ws.getColumn(col).numFmt = EURO_FORMAT;
  ws.getColumn("B").width = 26;
  ws.getColumn("F").width = 18;
  ws.getColumn("S").width = 34;

  addSummarySheet(wb, ledger, tr, grandCell);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addSummarySheet(wb: ExcelJS.Workbook, ledger: LedgerYear, totalsRow: number, grandCell: string) {
  const ws = wb.addWorksheet(SUMMARY_SHEET);
  const ref = (cell: string) => `'${LEDGER_SHEET}'!${cell}`;
  ws.addRow([`Έσοδα ${ledger.year}`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  ws.addRow(["Διαμέρισμα", "Έσοδα"]).font = { bold: true };
  ledger.apartments.forEach((a, i) => {
    const row = ws.addRow([a.label]);
    row.getCell(2).value = {
      formula: ref(`${RENTAL_COLUMNS[i]}${totalsRow}`),
      result: centsToEuros(ledger.totals.byRentalCents[i]!),
    };
  });
  const total = ws.addRow(["Σύνολο"]);
  total.font = { bold: true };
  total.getCell(2).value = { formula: ref(grandCell), result: centsToEuros(ledger.totals.totalCents) };
  const totalCell = `B${total.number}`;
  ws.addRow(["Καθαρό (πληρωμές)", centsToEuros(ledger.totals.payoutCents)]);
  if (ledger.totals.unbucketedCount > 0) {
    ws.addRow([
      `${ledger.totals.unbucketedCount} κρατήσεις χωρίς διαμέρισμα (δεν μετράνε στο σύνολο)`,
      centsToEuros(ledger.totals.unbucketedCents),
    ]);
  }

  ws.addRow([]);
  const rules = ledger.rules;
  const basis = rules.incomeBasis === "gross" ? "ό,τι πλήρωσε ο επισκέπτης" : "την πληρωμή μετά τις προμήθειες";
  const scope = rules.scope === "total" ? "στο σύνολο της χρονιάς" : "χωριστά για κάθε διαμέρισμα";
  ws.addRow([`Φόρος: υπολογίζεται ${scope}, πάνω σε ${basis}.`]);
  if (!rules.confirmed) ws.addRow(["Οι συντελεστές δεν έχουν επιβεβαιωθεί από τον λογιστή."]).font = { italic: true };
  ws.addRow(["Κλίμακα", "Από", "Έως", "Συντελεστής", "Ποσό στην κλίμακα", "Φόρος"]).font = { bold: true };

  const calculations = ledger.tax.calculations;
  calculations.forEach((calc, ci) => {
    const base = rules.scope === "total" ? totalCell : `B${4 + ci}`;
    const prefix = rules.scope === "total" ? "" : `${ledger.apartments[ci]!.label}: `;
    calc.lines.forEach((line, li) => {
      const from = centsToEuros(line.fromCents);
      const to = line.upToCents === null ? null : centsToEuros(line.upToCents);
      const portion = to === null ? `MAX(0,${base}-${from})` : `MAX(0,MIN(${base},${to})-${from})`;
      const row = ws.addRow([`${prefix}${li + 1}`, from, to ?? "και πάνω", percent(line.rateBps)]);
      row.getCell(5).value = { formula: portion, result: centsToEuros(line.taxedCents) };
      row.getCell(6).value = {
        formula: `ROUND(E${row.number}*${line.rateBps / 10_000},2)`,
        result: centsToEuros(line.taxCents),
      };
    });
  });
  const first = ws.rowCount - calculations.reduce((n, c) => n + c.lines.length, 0) + 1;
  const taxRow = ws.addRow(["Εκτιμώμενος φόρος"]);
  taxRow.font = { bold: true };
  taxRow.getCell(6).value = {
    formula: `SUM(F${first}:F${ws.rowCount - 1})`,
    result: centsToEuros(ledger.tax.taxCents),
  };

  for (const col of ["B", "C", "E", "F"]) ws.getColumn(col).numFmt = EURO_FORMAT;
  ws.getColumn("A").width = 30;
  for (const col of ["B", "C", "D", "E", "F"]) ws.getColumn(col).width = 18;
}
