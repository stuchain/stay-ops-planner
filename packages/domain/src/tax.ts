import { z } from "zod";
import { cents, type Cents } from "./money.js";

/**
 * Rental income tax, worked out bracket by bracket. The brackets live in settings
 * (`tax_rules`, one row per year) so the accountant's figures can change without
 * a code change. Income belongs to the year of check-in (decision E3).
 */

/** A bracket taxes the part of the income up to `upToCents` (null: no upper limit). Rate in basis points: 1500 = 15%. */
export interface TaxBracket {
  readonly upToCents: number | null;
  readonly rateBps: number;
}

/** "total": one calculation on the year's total (one owner, decision E5). "per_apartment": one per apartment. */
export type TaxScope = "total" | "per_apartment";

/** What the tax is worked out on: what the guest paid, or the payout after platform fees (decision E4). */
export type IncomeBasis = "gross" | "payout";

export interface TaxRules {
  readonly year: number;
  readonly brackets: readonly TaxBracket[];
  readonly scope: TaxScope;
  readonly incomeBasis: IncomeBasis;
  /** False until the accountant has confirmed the figures; the screen says so. */
  readonly confirmed: boolean;
}

export const TaxBracketsSchema = z
  .array(
    z.object({
      upToCents: z.number().int().positive().nullable(),
      rateBps: z.number().int().min(0).max(10_000),
    }),
  )
  .min(1)
  .refine(
    (list) =>
      list.every((b, i) => {
        const isLast = i === list.length - 1;
        if (isLast) return b.upToCents === null;
        const prev = i === 0 ? 0 : list[i - 1]!.upToCents!;
        return b.upToCents !== null && b.upToCents > prev;
      }),
    { message: "Limits must rise, and only the last bracket is open-ended" },
  );

/** The brackets the current spreadsheet implies: 15% up to 12,000 €, 35% up to 35,000 €, 45% above. To be confirmed with the accountant. */
export const SPREADSHEET_BRACKETS: readonly TaxBracket[] = [
  { upToCents: 1_200_000, rateBps: 1500 },
  { upToCents: 2_400_000, rateBps: 2500 },
  { upToCents: 3_500_000, rateBps: 3500 },
  { upToCents: null, rateBps: 4500 },
];

/** As the 2026 spreadsheet does it: each apartment taxed on its own, on what the guest paid. */
export function defaultTaxRules(year: number): TaxRules {
  return { year, brackets: SPREADSHEET_BRACKETS, scope: "per_apartment", incomeBasis: "gross", confirmed: false };
}

export interface TaxBracketLine {
  readonly fromCents: Cents;
  readonly upToCents: Cents | null;
  readonly rateBps: number;
  /** The part of the income that falls in this bracket. */
  readonly taxedCents: Cents;
  readonly taxCents: Cents;
}

export interface TaxCalculation {
  readonly incomeCents: Cents;
  readonly lines: readonly TaxBracketLine[];
  readonly taxCents: Cents;
}

/** Half-up rounding of `amount × bps / 10000` using integers only. */
function applyRate(amount: number, rateBps: number): Cents {
  return cents(Math.floor((amount * rateBps + 5000) / 10_000));
}

/**
 * Piecewise tax. Each bracket's tax is rounded to the cent, and the total is the
 * sum of the lines, so the explanation on screen always adds up. Zero or negative
 * income (refunds larger than income) owes nothing.
 */
export function taxFor(incomeCents: Cents, brackets: readonly TaxBracket[]): TaxCalculation {
  const lines: TaxBracketLine[] = [];
  let from = 0;
  let total = 0;
  for (const b of brackets) {
    const top = b.upToCents;
    const taxed = Math.max(0, Math.min(incomeCents, top ?? Number.MAX_SAFE_INTEGER) - from);
    const tax = applyRate(taxed, b.rateBps);
    lines.push({
      fromCents: cents(from),
      upToCents: top === null ? null : cents(top),
      rateBps: b.rateBps,
      taxedCents: cents(taxed),
      taxCents: tax,
    });
    total += tax;
    if (top === null) break;
    from = top;
  }
  return { incomeCents, lines, taxCents: cents(total) };
}
