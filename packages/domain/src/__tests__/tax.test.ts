import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cents } from "../money.js";
import { defaultTaxRules, SPREADSHEET_BRACKETS, TaxBracketsSchema, taxFor } from "../tax.js";

const euros = (value: number) => cents(Math.round(value * 100));
const taxOn = (value: number) => taxFor(euros(value), SPREADSHEET_BRACKETS).taxCents;

describe("taxFor with the spreadsheet brackets", () => {
  // Hand-calculated: 15% of the first 12,000, 25% of the next 12,000, 35% up to 35,000, 45% above.
  it.each([
    [0, 0],
    [1000, 150],
    [11_999.99, 1800], // 1,799.9985 rounds to 1,800.00
    [12_000, 1800],
    [12_000.01, 1800], // 1,800 + 0.0025
    [12_000.02, 1800.01], // 1,800 + 0.005, half a cent rounds up
    [20_000, 3800],
    [24_000, 4800],
    [35_000, 8650],
    [100_000, 37_900], // 8,650 + 65,000 × 45%
  ])("at %d € owes %d €", (income, tax) => {
    expect(taxOn(income)).toBe(euros(tax));
  });

  it("matches the 2026 spreadsheet formulas", () => {
    // Φύλλο3 S173: 8650 + (total - 35000) × 0.45 above 35,000.
    expect(taxOn(51_621)).toBe(euros(8650 + 16_621 * 0.45));
    // Φύλλο3 N175: 1800 + (apartment - 12000) × 0.25 between 12,000 and 24,000.
    expect(taxOn(13_725)).toBe(euros(2231.25));
    expect(taxOn(11_919)).toBe(euros(1787.85));
  });

  it("owes nothing on zero or negative income", () => {
    expect(taxOn(-500)).toBe(0);
  });

  it("explains each bracket", () => {
    const calc = taxFor(euros(40_000), SPREADSHEET_BRACKETS);
    expect(calc.lines).toEqual([
      { fromCents: 0, upToCents: 1_200_000, rateBps: 1500, taxedCents: 1_200_000, taxCents: 180_000 },
      { fromCents: 1_200_000, upToCents: 2_400_000, rateBps: 2500, taxedCents: 1_200_000, taxCents: 300_000 },
      { fromCents: 2_400_000, upToCents: 3_500_000, rateBps: 3500, taxedCents: 1_100_000, taxCents: 385_000 },
      { fromCents: 3_500_000, upToCents: null, rateBps: 4500, taxedCents: 500_000, taxCents: 225_000 },
    ]);
    expect(calc.taxCents).toBe(1_090_000);
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
      scope: "per_apartment",
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
