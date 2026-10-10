import type { LedgerYearData } from "@/api/types";

/** A month already lived, the one we are in, or one still to come (from bookings already made). */
export type MonthKind = "actual" | "current" | "expected";

export interface MonthView {
  /** 1–12. */
  month: number;
  kind: MonthKind;
  /** Per apartment in column order, cents. */
  perApartment: readonly number[];
  totalCents: number;
}

export interface IncomeView {
  months: MonthView[];
  soFarCents: number;
  expectedCents: number;
  /** Months still to come that have amounts, for the note under the chart. */
  futureMonths: number[];
}

export function monthKind(year: number, month: number, todayIso: string): MonthKind {
  const thisYear = Number(todayIso.slice(0, 4));
  const thisMonth = Number(todayIso.slice(5, 7));
  if (year < thisYear || (year === thisYear && month < thisMonth)) return "actual";
  if (year === thisYear && month === thisMonth) return "current";
  return "expected";
}

/** Splits the year's totals into what has happened and what is still expected. */
export function incomeView(ledger: Pick<LedgerYearData, "year" | "totals">, todayIso: string): IncomeView {
  const months = ledger.totals.monthlyCents.map((perApartment, i) => {
    const month = i + 1;
    return {
      month,
      kind: monthKind(ledger.year, month, todayIso),
      perApartment,
      totalCents: perApartment.reduce((s, v) => s + v, 0),
    };
  });
  const soFarCents = months.filter((m) => m.kind !== "expected").reduce((s, m) => s + m.totalCents, 0);
  return {
    months,
    soFarCents,
    expectedCents: ledger.totals.totalCents - soFarCents,
    futureMonths: months.filter((m) => m.kind === "expected").map((m) => m.month),
  };
}

/** "15%" or "22,5%" in Greek; "22.5%" in English. */
export function formatRate(rateBps: number, locale: string): string {
  return `${(rateBps / 100).toLocaleString(locale === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 2 })}%`;
}
