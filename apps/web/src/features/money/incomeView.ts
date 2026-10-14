import type { LedgerApartmentData, LedgerYearData } from "@/api/types";
import { apartmentColor } from "@/ui/apartmentColor";

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

/**
 * This year so far against the same months last year, as a fraction (0.12 = 12% more);
 * null when last year had nothing to compare with.
 */
export function changeOnLastYear(
  soFarCents: number,
  lastYear: Pick<LedgerYearData, "totals">,
  year: number,
  todayIso: string,
): number | null {
  const before = incomeView({ year, totals: lastYear.totals }, todayIso).soFarCents;
  if (before <= 0) return null;
  return (soFarCents - before) / before;
}

/** "+12%", "−5%" or "0%", rounded to a whole percent. */
export function formatChange(fraction: number): string {
  const percent = Math.round(fraction * 100);
  if (percent === 0) return "0%";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`;
}

/** Apartment colour on screen, from the room settings or else the column's design colour; follows the theme. */
export function ledgerApartmentColor(a: LedgerApartmentData): string {
  if (a.color) return apartmentColor(a.color);
  return ["var(--so-apt-onar)", "var(--so-apt-cosmos)", "var(--so-apt-iris)", "var(--so-apt-helios)"][a.index - 1]!;
}

/** "15%" or "22,5%" in Greek; "22.5%" in English. */
export function formatRate(rateBps: number, locale: string): string {
  return `${(rateBps / 100).toLocaleString(locale === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 2 })}%`;
}
