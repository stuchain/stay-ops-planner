import { describe, expect, it } from "vitest";
import {
  addCalendarMonth,
  formatYearMonthInTimeZone,
  listYearMonthsInclusive,
  subtractCalendarMonth,
  yearMonthsAroundPivot,
  yearMonthsOverlappingUtcRange,
} from "./yearMonthBuckets.js";

describe("yearMonthBuckets", () => {
  it("addCalendarMonth rolls year", () => {
    expect(addCalendarMonth("2024-12")).toBe("2025-01");
    expect(addCalendarMonth("2024-01")).toBe("2024-02");
  });

  it("subtractCalendarMonth rolls year", () => {
    expect(subtractCalendarMonth("2025-01")).toBe("2024-12");
  });

  it("listYearMonthsInclusive orders and spans", () => {
    expect(listYearMonthsInclusive("2024-01", "2024-03")).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(listYearMonthsInclusive("2024-03", "2024-01")).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("yearMonthsOverlappingUtcRange swaps inverted range", () => {
    const a = new Date("2024-06-10T12:00:00.000Z");
    const b = new Date("2024-06-15T12:00:00.000Z");
    expect(yearMonthsOverlappingUtcRange("Etc/UTC", a, b)).toEqual(["2024-06"]);
  });

  it("yearMonthsOverlappingUtcRange spans two UTC months in same local month", () => {
    const tz = "Etc/UTC";
    const from = new Date("2024-05-31T22:00:00.000Z");
    const to = new Date("2024-06-01T02:00:00.000Z");
    const months = yearMonthsOverlappingUtcRange(tz, from, to);
    expect(months).toContain("2024-05");
    expect(months).toContain("2024-06");
  });

  it("formatYearMonthInTimeZone respects Europe/Athens offset for late UTC", () => {
    const d = new Date("2024-06-30T21:00:00.000Z");
    const ymUtc = formatYearMonthInTimeZone(d, "Etc/UTC");
    expect(ymUtc).toBe("2024-06");
    const ymAthens = formatYearMonthInTimeZone(d, "Europe/Athens");
    expect(ymAthens).toBe("2024-07");
  });

  it("yearMonthsAroundPivot expands backward and forward", () => {
    const pivot = new Date("2024-06-15T12:00:00.000Z");
    const list = yearMonthsAroundPivot("Etc/UTC", pivot, 1, 1);
    expect(list[0]).toBe("2024-05");
    expect(list[list.length - 1]).toBe("2024-07");
    expect(list).toContain("2024-06");
  });
});
