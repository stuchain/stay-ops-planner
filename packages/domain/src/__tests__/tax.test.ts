import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cents } from "../money.js";
import { defaultTaxRules, SPREADSHEET_BRACKETS, TaxBracketsSchema, taxFor } from "../tax.js";

const euros = (value: number) => cents(Math.round(value * 100));
const taxOn = (value: number) => taxFor(euros(value), SPREADSHEET_BRACKETS).taxCents;

describe("taxFor with the spreadsheet brackets", () => {
  // Hand-calculated: 15% of the first 12,000, 35% of the next 23,000, 45% above.
  it.each([
    [0, 0],
    [1000, 150],
    [11_999.99, 1800], // 1,799.9985 rounds to 1,800.00
    [12_000, 1800],
    [12_000.01, 1800], // 1,800 + 0.0035
    [12_000.02, 1800.01], // 1,800 + 0.007
    [20_000, 4600],
    [35_000, 9850],
    [100_000, 39_100], // 9,850 + 65,000 × 45%
  ])("at %d € owes %d €", (income, tax) => {
    expect(taxOn(income)).toBe(euros(tax));
  });

  it("matches the old spreadsheet shortcuts where those are valid", () => {
    // 9850 + (total - 35000) × 0.45 above 35,000.
    expect(taxOn(50_000)).toBe(euros(9850 + 15_000 * 0.45));
    // 1800 + (x - 12000) × 0.35 between 12,000 and 35,000.
    expect(taxOn(30_000)).toBe(euros(1800 + 18_000 * 0.35));
  });

  it("owes nothing on zero or negative income", () => {
    expect(taxOn(-500)).toBe(0);
  });

  it("explains each bracket", () => {
    const calc = taxFor(euros(40_000), SPREADSHEET_BRACKETS);
    expect(calc.lines).toEqual([
      { fromCents: 0, upToCents: 1_200_000, rateBps: 1500, taxedCents: 1_200_000, taxCents: 180_000 },
      { fromCents: 1_200_000, upToCents: 3_500_000, rateBps: 3500, taxedCents: 2_300_000, taxCents: 805_000 },
      { fromCents: 3_500_000, upToCents: null, rateBps: 4500, taxedCents: 500_000, taxCents: 225_000 },
    ]);
    expect(calc.taxCents).toBe(1_210_000);
  });

  it("stops at the last limit when no bracket is open-ended", () => {
    expect(taxFor(euros(500), [{ upToCents: 10_000, rateBps: 1000 }]).taxCents).toBe(1000);
  });

  it("never decreases as income grows, and the lines add up", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e7, max: 1e9 }), fc.integer({ min: 0, max: 1e7 }), (a, d) => {
        const lower = taxFor(cents(a), SPREADSHEET_BRACKETS);
        const higher = taxFor(cents(a + d), SPREADSHEET_BRACKETS);
        expect(higher.taxCents).toBeGreaterThanOrEqual(lower.taxCents);
        expect(lower.lines.reduce((s, l) => s + l.taxCents, 0)).toBe(lower.taxCents);
        expect(lower.lines.reduce((s, l) => s + l.taxedCents, 0)).toBe(Math.max(0, a));
      }),
    );
  });
});

describe("tax rules", () => {
  it("defaults to the spreadsheet brackets, unconfirmed", () => {
    expect(defaultTaxRules(2026)).toEqual({
      year: 2026,
      brackets: SPREADSHEET_BRACKETS,
      scope: "total",
      incomeBasis: "gross",
      confirmed: false,
    });
  });

  it("validates bracket lists", () => {
    expect(TaxBracketsSchema.safeParse(SPREADSHEET_BRACKETS).success).toBe(true);
    expect(TaxBracketsSchema.safeParse([]).success).toBe(false);
    expect(TaxBracketsSchema.safeParse([{ upToCents: 100, rateBps: 1000 }]).success).toBe(false);
    expect(
      TaxBracketsSchema.safeParse([
        { upToCents: 200, rateBps: 1000 },
        { upToCents: 100, rateBps: 2000 },
        { upToCents: null, rateBps: 3000 },
      ]).success,
    ).toBe(false);
    expect(
      TaxBracketsSchema.safeParse([
        { upToCents: null, rateBps: 1000 },
        { upToCents: null, rateBps: 2000 },
      ]).success,
    ).toBe(false);
    expect(TaxBracketsSchema.safeParse([{ upToCents: null, rateBps: 20_000 }]).success).toBe(false);
  });
});
