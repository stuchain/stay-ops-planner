import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cents, centsToEuros, eurosToCents, formatEuros, parseEuroInput, sumCents } from "../money.js";

describe("cents", () => {
  it("accepts whole numbers only", () => {
    expect(cents(1234)).toBe(1234);
    expect(() => cents(12.5)).toThrow(RangeError);
    expect(() => cents(Number.NaN)).toThrow(RangeError);
  });

  it("sums, skipping empty values", () => {
    expect(sumCents([cents(100), null, undefined, cents(-25)])).toBe(75);
    expect(sumCents([])).toBe(0);
  });

  it("converts float euros without binary drift", () => {
    expect(eurosToCents(1.005)).toBe(101);
    expect(eurosToCents(0.1 + 0.2)).toBe(30);
    expect(eurosToCents(1234.56)).toBe(123456);
    expect(eurosToCents(-19.99)).toBe(-1999);
    expect(() => eurosToCents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(centsToEuros(cents(123456))).toBe(1234.56);
  });

  it("formats in Greek", () => {
    expect(formatEuros(cents(123456)).replace(/\s/g, " ")).toBe("1.234,56 €");
  });

  it("round-trips any amount through euros", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (n) => {
        expect(eurosToCents(centsToEuros(cents(n)))).toBe(n);
      }),
    );
  });
});

describe("parseEuroInput", () => {
  const ok = (text: string, value: number) => expect(parseEuroInput(text)).toEqual({ ok: true, cents: value });
  const bad = (text: string) => expect(parseEuroInput(text)).toEqual({ ok: false });

  it("reads Greek format", () => {
    ok("1.234,56", 123456);
    ok("1234,56", 123456);
    ok("1234,5", 123450);
    ok("1.234", 123400);
    ok("12.345.678", 1234567800);
    ok("0,99", 99);
  });

  it("reads international format", () => {
    ok("1234.56", 123456);
    ok("1,234.56", 123456);
    ok("12.5", 1250);
  });

  it("allows signs, euro signs and spaces", () => {
    ok("-50", -5000);
    ok("−50,00", -5000);
    ok("€ 80", 8000);
    ok("1 234,00 €", 123400);
    ok("-0", 0);
    ok("100", 10000);
  });

  it("rejects anything unclear instead of guessing", () => {
    bad("");
    bad("   ");
    bad("abc");
    bad("12a");
    bad("1,234");
    bad("1.2.3");
    bad("12,34,56");
    bad("1.23.456,00");
    bad("1,2345.00");
    bad(".5");
    bad("-");
    bad("1.234,567");
    bad("99999999999999999999");
  });

  it("reads back every formatted amount", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e11, max: 1e11 }), (n) => {
        expect(parseEuroInput(formatEuros(cents(n)))).toEqual({ ok: true, cents: n });
      }),
    );
  });
});
