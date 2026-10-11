import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  applyLedgerOverrides,
  cents,
  defaultTaxRules,
  ledgerTax,
  ledgerTotals,
  type IncomeKind,
  type LedgerValues,
  type TaxRules,
} from "@stay-ops/domain";
import { buildLedgerWorkbook, LEDGER_SHEET, ledgerHeaders, SUMMARY_SHEET } from "@/server/money/exportLedger";
import { emptyLedgerValues, type LedgerRowView, type LedgerYear } from "@/server/useCases/buildLedger";

function row(key: string, month: number, values: Partial<LedgerValues>, kind: IncomeKind = "confirmed"): LedgerRowView {
  const auto = { ...emptyLedgerValues(key.toUpperCase()), ...values };
  const { overridden, ...shown } = applyLedgerOverrides(auto, {}, "gross");
  return {
    key,
    bookingId: key,
    entryId: null,
    manual: false,
    checkin: null,
    checkout: null,
    month,
    channel: "airbnb",
    status: "confirmed",
    kind,
    counts: kind === "confirmed" || kind === "cancelled_paid",
    auto,
    shown,
    overrides: {},
    overridden: [...overridden],
    bucketSource: "listing",
    stayedRentalIndex: null,
    foreignCurrency: false,
    hosthubChanged: false,
    version: 0,
  };
}

function ledger(rules: TaxRules): LedgerYear {
  const rows = [
    row("anna", 1, { airbnbCents: cents(2_000_000), payoutCents: cents(1_800_000), rentalIndex: 1 }),
    row("bob", 7, {
      soloCents: cents(1_500_050),
      prepaymentCents: cents(1_500_050),
      payoutCents: cents(1_500_050),
      rentalIndex: 2,
    }),
    row("carl", 8, { airbnbCents: cents(10_000), payoutCents: cents(10_000), rentalIndex: 2 }, "cancelled_paid"),
    row("dina", 8, { airbnbCents: cents(99_900), payoutCents: cents(90_000), rentalIndex: 3 }, "pending"),
  ];
  const totals = ledgerTotals(rows, rules.incomeBasis);
  return {
    year: 2025,
    years: [2025, 2026],
    rules,
    apartments: (["Onar", "Cosmos", "Iris", "Helios"] as const).map((label, i) => ({
      index: (i + 1) as 1 | 2 | 3 | 4,
      label,
      color: null,
    })),
    rows,
    totals,
    tax: ledgerTax(totals, rules),
  };
}

async function read(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

function findRow(ws: ExcelJS.Worksheet, col: string, text: string): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((r) => {
    if (r.getCell(col).value === text) found = r;
  });
  if (!found) throw new Error(`no row with ${text} in ${col}`);
  return found;
}

const result = (cell: ExcelJS.Cell) => (cell.value as { result?: number }).result ?? 0;
const formula = (cell: ExcelJS.Cell) => (cell.value as { formula: string }).formula;

describe("Excel export", () => {
  it("keeps the accountant's headers and lists every row by month", async () => {
    const wb = await read(await buildLedgerWorkbook(ledger(defaultTaxRules(2025))));
    const ws = wb.getWorksheet(LEDGER_SHEET)!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(ledgerHeaders(["Onar", "Cosmos", "Iris", "Helios"]));
    expect(ws.getRow(2).getCell("D").value).toBe("ΙΑΝΟΥΑΡΙΟΣ");
    const anna = findRow(ws, "B", "ANNA");
    expect(anna.getCell("A").value).toBe(1);
    expect(anna.getCell("H").value).toBe(20_000);
    expect(anna.getCell("O").value).toBe(20_000);
    expect(anna.getCell("H").numFmt).toBe('#,##0.00 "€"');
    const carl = findRow(ws, "B", "CARL");
    expect(carl.font.strike).toBe(true);
    expect(carl.getCell("S").value).toBe("Ακυρώθηκε, μετράει η πληρωμή");
    const dina = findRow(ws, "B", "DINA");
    expect(dina.getCell("H").value).toBeNull();
    expect(dina.getCell("S").value).toBe("Αίτημα, δεν μετράει");
  });

  it("writes totals as formulas whose cached results match the app", async () => {
    const l = ledger({ ...defaultTaxRules(2025), scope: "total" });
    const ws = (await read(await buildLedgerWorkbook(l))).getWorksheet(LEDGER_SHEET)!;
    const totals = findRow(ws, "N", "ΣΥΝΟΛΑ");
    expect(formula(totals.getCell("O"))).toMatch(/^SUM\(O2:O\d+\)$/);
    expect([..."OPQR"].map((c) => result(totals.getCell(c)))).toEqual([20_000, 15_100.5, 0, 0]);
    const grand = findRow(ws, "Q", "ΣΥΝΟΛΟ");
    expect(result(grand.getCell("R"))).toBe(35_100.5);
    const tax = findRow(ws, "Q", "ΦΟΡΟΣ (κλίμακα)");
    expect(formula(tax.getCell("R"))).toBe(
      `ROUND(MAX(0,MIN(R${grand.number},12000)-0)*0.15,2)+ROUND(MAX(0,MIN(R${grand.number},24000)-12000)*0.25,2)+` +
        `ROUND(MAX(0,MIN(R${grand.number},35000)-24000)*0.35,2)+ROUND(MAX(0,R${grand.number}-35000)*0.45,2)`,
    );
    expect(result(tax.getCell("R"))).toBe(8695.23); // 8,650 + 100.50 × 45% = 45.225 → 45.23
    const sums = findRow(ws, "K", "ΣΥΝ J");
    expect(result(sums.getCell("L"))).toBe(15_000.5);
    expect(result(sums.getCell("N"))).toBe(18_000 + 15_000.5 + 100);
  });

  it("adds a summary sheet with apartments and the bracket calculation", async () => {
    const rules: TaxRules = { ...defaultTaxRules(2025), scope: "total" };
    const ws = (await read(await buildLedgerWorkbook(ledger(rules)))).getWorksheet(SUMMARY_SHEET)!;
    expect(ws.getCell("A1").value).toBe("Έσοδα 2025");
    expect(ws.getCell("A4").value).toBe("Onar");
    expect(formula(ws.getCell("B4"))).toMatch(/^'Φύλλο3'!O\d+$/);
    expect(result(ws.getCell("B8"))).toBe(35_100.5);
    const unconfirmed = findRow(ws, "A", "Οι συντελεστές δεν έχουν επιβεβαιωθεί από τον λογιστή.");
    expect(unconfirmed).toBeDefined();
    const total = findRow(ws, "A", "Εκτιμώμενος φόρος");
    expect(result(total.getCell(6))).toBe(8695.23);
  });

  it("taxes each apartment when the rules say so", async () => {
    const rules: TaxRules = { ...defaultTaxRules(2025), confirmed: true };
    const wb = await read(await buildLedgerWorkbook(ledger(rules)));
    const ws = wb.getWorksheet(LEDGER_SHEET)!;
    const perRental = findRow(ws, "N", "ΦΟΡΟΣ / ενοίκιο");
    expect(result(perRental.getCell("O"))).toBe(3800); // 20,000 €: 1,800 + 8,000 × 25%
    expect(result(perRental.getCell("P"))).toBe(2575.13); // 1,800 + 3,100.50 × 25% = 775.125 → 775.13
    expect(result(findRow(ws, "Q", "ΦΟΡΟΣ").getCell("R"))).toBe(6375.13);
    const summary = wb.getWorksheet(SUMMARY_SHEET)!;
    expect(result(findRow(summary, "A", "Εκτιμώμενος φόρος").getCell(6))).toBe(6375.13);
  });
});
