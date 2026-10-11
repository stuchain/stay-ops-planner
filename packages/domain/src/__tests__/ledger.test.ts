import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RentalIndex } from "../income.js";
import {
  applyLedgerOverrides,
  bucketAmount,
  ledgerTax,
  ledgerTotals,
  mergeLedgerPatch,
  readLedgerOverrides,
  type CountedRow,
  type LedgerValues,
} from "../ledger.js";
import { cents, type Cents } from "../money.js";
import { defaultTaxRules } from "../tax.js";

const c = (n: number) => cents(n);

const auto = (over: Partial<LedgerValues> = {}): LedgerValues => ({
  name: "PAPADOPOULOS",
  guestCount: 2,
  passport: "",
  roomLocation: "Cosmos",
  dateRange: "1-5/8/",
  nights: 4,
  airbnbCents: c(56_000),
  bookingCents: null,
  contractCents: null,
  soloCents: null,
  prepaymentCents: null,
  payoutCents: c(49_075),
  rentalIndex: 2,
  ...over,
});

describe("applyLedgerOverrides", () => {
  it("shows automatic values and fills the booked apartment's column", () => {
    const shown = applyLedgerOverrides(auto(), null, "gross");
    expect(shown.rentalCents).toEqual([null, 56_000, null, null]);
    expect(shown.overridden.size).toBe(0);
  });

  it("uses the payout in the apartment column when tax is on payouts", () => {
    expect(applyLedgerOverrides(auto(), {}, "payout").rentalCents).toEqual([null, 49_075, null, null]);
  });

  it("a corrected price and apartment flow into the apartment columns (E3-2)", () => {
    const shown = applyLedgerOverrides(auto(), { airbnbCents: c(60_000), rentalIndex: 4 }, "gross");
    expect(shown.rentalCents).toEqual([null, null, null, 60_000]);
    expect([...shown.overridden].sort()).toEqual(["airbnbCents", "rentalIndex"]);
  });

  it("a corrected apartment cell wins over the worked-out value", () => {
    const shown = applyLedgerOverrides(auto(), { rental2Cents: c(10_000), rental3Cents: null }, "gross");
    expect(shown.rentalCents).toEqual([null, 10_000, null, null]);
    expect(shown.overridden.has("rental2Cents")).toBe(true);
    expect(shown.overridden.has("rental3Cents")).toBe(true);
  });

  it("null means blank, not revert (E3-5)", () => {
    const shown = applyLedgerOverrides(auto(), { airbnbCents: null, name: null as unknown as string }, "gross");
    expect(shown.airbnbCents).toBeNull();
    expect(shown.name).toBe("");
    expect(shown.rentalCents).toEqual([null, null, null, null]);
  });

  it("falls back through the channel columns for the apartment amount", () => {
    const row = auto({ airbnbCents: null, bookingCents: null, contractCents: null, soloCents: c(300) });
    expect(bucketAmount(row, "gross")).toBeNull();
    expect(bucketAmount({ ...row, prepaymentCents: c(50) }, "gross")).toBe(50);
    expect(bucketAmount(auto({ airbnbCents: null, bookingCents: c(5) }), "gross")).toBe(5);
    expect(bucketAmount(auto({ airbnbCents: null, contractCents: c(7) }), "gross")).toBe(7);
  });

  it("puts only the deposit of a direct booking in the apartment column, like the spreadsheet", () => {
    const direct = auto({ airbnbCents: null, soloCents: c(90_000), payoutCents: c(90_000) });
    expect(applyLedgerOverrides(direct, null, "gross").rentalCents).toEqual([null, null, null, null]);
    const withDeposit = applyLedgerOverrides(direct, { prepaymentCents: c(5000) }, "gross");
    expect(withDeposit.soloCents).toBe(85_000);
    expect(applyLedgerOverrides(direct, { prepaymentCents: null }, "gross").soloCents).toBe(90_000);
    expect(withDeposit.rentalCents).toEqual([null, 5000, null, null]);
    const corrected = applyLedgerOverrides(direct, { prepaymentCents: c(5000), soloCents: c(1) }, "gross");
    expect(corrected.soloCents).toBe(1);
  });

  it("blank text corrections show as empty strings", () => {
    const blank = null as unknown as string;
    const shown = applyLedgerOverrides(auto(), { passport: blank, roomLocation: blank, dateRange: blank }, "gross");
    expect([shown.passport, shown.roomLocation, shown.dateRange]).toEqual(["", "", ""]);
  });
});

describe("mergeLedgerPatch", () => {
  it("sets, blanks and reverts", () => {
    const merged = mergeLedgerPatch(
      { airbnbCents: c(1), nights: 3 },
      { airbnbCents: "revert", nights: undefined, payoutCents: null, name: "X" },
    );
    expect(merged).toEqual({ nights: 3, payoutCents: null, name: "X" });
    expect(mergeLedgerPatch(null, { guestCount: 4 })).toEqual({ guestCount: 4 });
  });
});

describe("readLedgerOverrides", () => {
  it("keeps valid fields and drops the rest", () => {
    expect(
      readLedgerOverrides({
        name: "A",
        passport: 5,
        guestCount: 2,
        nights: -1,
        airbnbCents: -500,
        payoutCents: 1.5,
        rentalIndex: 3,
        rental1Cents: null,
        unknown: 1,
      }),
    ).toEqual({ name: "A", guestCount: 2, airbnbCents: -500, rentalIndex: 3, rental1Cents: null });
    expect(readLedgerOverrides({ rentalIndex: 7 })).toEqual({});
    expect(readLedgerOverrides(null)).toEqual({});
    expect(readLedgerOverrides([1])).toEqual({});
    expect(readLedgerOverrides("x")).toEqual({});
  });
});

const row = (values: Partial<LedgerValues>, counts = true, month = 8): CountedRow => ({
  shown: applyLedgerOverrides(auto(values), null, "gross"),
  counts,
  month,
});

describe("ledgerTotals", () => {
  it("adds the apartment columns, solo and payout, skipping rows that don't count", () => {
    const totals = ledgerTotals(
      [
        row({}),
        row(
          { rentalIndex: 1, airbnbCents: null, soloCents: c(15_000), prepaymentCents: c(5000), payoutCents: c(20_000) },
          true,
          1,
        ),
        row({ rentalIndex: 3 }, false),
      ],
      "gross",
    );
    expect(totals.byRentalCents).toEqual([5000, 56_000, 0, 0]);
    expect(totals.totalCents).toBe(61_000);
    expect(totals.soloCents).toBe(15_000);
    expect(totals.payoutCents).toBe(69_075);
    expect(totals.monthlyCents[0]).toEqual([5000, 0, 0, 0]);
    expect(totals.monthlyCents[7]).toEqual([0, 56_000, 0, 0]);
    expect(totals.unbucketedCount).toBe(0);
  });

  it("counts rows with an amount but no apartment (E3-8)", () => {
    const totals = ledgerTotals(
      [row({ rentalIndex: null }), row({ rentalIndex: null, airbnbCents: c(0), payoutCents: null })],
      "gross",
    );
    expect(totals.unbucketedCount).toBe(1);
    expect(totals.unbucketedCents).toBe(56_000);
    expect(totals.totalCents).toBe(0);
  });

  it("totals always equal the sum of the rows, with no drift", () => {
    const rowArb = fc.record({
      amount: fc.integer({ min: -100_000, max: 10_000_000 }),
      index: fc.constantFrom<RentalIndex | null>(1, 2, 3, 4, null),
      counts: fc.boolean(),
      month: fc.integer({ min: 1, max: 12 }),
    });
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 200 }), (list) => {
        const rows = list.map((r) =>
          row({ airbnbCents: c(r.amount), payoutCents: c(r.amount), rentalIndex: r.index }, r.counts, r.month),
        );
        const totals = ledgerTotals(rows, "gross");
        const expected = list.filter((r) => r.counts && r.index !== null).reduce((s, r) => s + r.amount, 0);
        expect(totals.totalCents).toBe(expected);
        expect(totals.byRentalCents.reduce((s: number, v: Cents) => s + v, 0)).toBe(expected);
        expect(totals.monthlyCents.flat().reduce((s: number, v: Cents) => s + v, 0)).toBe(expected);
        expect(Number.isInteger(totals.totalCents)).toBe(true);
      }),
    );
  });
});

describe("ledgerTax", () => {
  const totals = ledgerTotals(
    [row({ rentalIndex: 1, airbnbCents: c(2_000_000) }), row({ rentalIndex: 2, airbnbCents: c(2_000_000) })],
    "gross",
  );

  it("taxes each apartment separately by default, like the spreadsheet", () => {
    const tax = ledgerTax(totals, defaultTaxRules(2026));
    expect(tax.calculations).toHaveLength(4);
    expect(tax.taxCents).toBe(2 * (180_000 + 200_000)); // 20,000 € each: 1,800 + 8,000 × 25%
  });

  it("can tax the yearly total instead (one owner)", () => {
    const tax = ledgerTax(totals, { ...defaultTaxRules(2026), scope: "total" });
    expect(tax.calculations).toHaveLength(1);
    expect(tax.taxCents).toBe(865_000 + 225_000); // 40,000 €: 8,650 + 5,000 × 45%
  });
});
