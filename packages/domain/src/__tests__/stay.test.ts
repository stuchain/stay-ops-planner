import { describe, expect, it } from "vitest";
import {
  addDays,
  compareDates,
  compareIds,
  daysBetween,
  eachNight,
  isIsoDate,
  isoDate,
  isValidStay,
  nights,
  overlaps,
  partySize,
  stay,
} from "../stay.js";
import { cents } from "../money.js";

describe("dates", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-10-17")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("17/10/2026")).toBe(false);
    expect(() => isoDate("2026-02-30")).toThrow(RangeError);
  });

  it("adds days across months, years and DST changes", () => {
    expect(addDays(isoDate("2026-10-31"), 1)).toBe("2026-11-01");
    expect(addDays(isoDate("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(isoDate("2026-03-29"), 1)).toBe("2026-03-30");
    expect(addDays(isoDate("2026-03-01"), -1)).toBe("2026-02-28");
    expect(daysBetween(isoDate("2026-10-25"), isoDate("2026-10-26"))).toBe(1);
    expect(daysBetween(isoDate("2026-10-26"), isoDate("2026-10-25"))).toBe(-1);
  });

  it("compares dates", () => {
    expect(compareDates(isoDate("2026-01-01"), isoDate("2026-01-02"))).toBe(-1);
    expect(compareDates(isoDate("2026-01-02"), isoDate("2026-01-01"))).toBe(1);
    expect(compareDates(isoDate("2026-01-01"), isoDate("2026-01-01"))).toBe(0);
    expect([compareIds("a", "b"), compareIds("b", "a"), compareIds("a", "a")]).toEqual([-1, 1, 0]);
  });
});

describe("stays", () => {
  it("counts nights and lists each night", () => {
    const s = stay("2026-10-30", "2026-11-02");
    expect(nights(s)).toBe(3);
    expect(eachNight(s)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("rejects a checkout on or before the checkin", () => {
    expect(() => stay("2026-10-17", "2026-10-17")).toThrow(RangeError);
    expect(isValidStay({ checkin: isoDate("2026-10-18"), checkout: isoDate("2026-10-17") })).toBe(false);
  });

  it("treats the checkout day as free", () => {
    expect(overlaps(stay("2026-10-01", "2026-10-05"), stay("2026-10-05", "2026-10-07"))).toBe(false);
    expect(overlaps(stay("2026-10-05", "2026-10-07"), stay("2026-10-01", "2026-10-05"))).toBe(false);
    expect(overlaps(stay("2026-10-01", "2026-10-06"), stay("2026-10-05", "2026-10-07"))).toBe(true);
    expect(overlaps(stay("2026-10-01", "2026-10-10"), stay("2026-10-03", "2026-10-04"))).toBe(true);
  });

  it("counts adults and children but not infants", () => {
    expect(partySize({ adults: 2, children: 1, infants: 1 })).toBe(3);
  });
});

describe("money", () => {
  it("only accepts whole cents", () => {
    expect(cents(125000)).toBe(125000);
    expect(() => cents(1.5)).toThrow(RangeError);
  });
});
