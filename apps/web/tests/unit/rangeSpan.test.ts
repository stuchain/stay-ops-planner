import { describe, expect, it } from "vitest";
import {
  bookingSpanInRange,
  buildMultiMonthRange,
  formatMultiMonthRangeTitle,
} from "@/modules/calendar/rangeSpan";

describe("buildMultiMonthRange", () => {
  it("maps July–August 2026 columns to ISO dates", () => {
    const spec = buildMultiMonthRange(["2026-07", "2026-08"]);
    expect(spec.totalDayCount).toBe(31 + 31);
    expect(spec.columnToIso(1)).toBe("2026-07-01");
    expect(spec.columnToIso(31)).toBe("2026-07-31");
    expect(spec.columnToIso(32)).toBe("2026-08-01");
    expect(spec.monthBoundaryColumns).toEqual([32]);
    expect(spec.isoToColumn("2026-08-15")).toBe(32 + 14);
  });
});

describe("bookingSpanInRange", () => {
  it("spans a stay across July–August boundary", () => {
    const spec = buildMultiMonthRange(["2026-07", "2026-08"]);
    const span = bookingSpanInRange("2026-07-30", "2026-08-05", spec);
    const jul30 = spec.isoToColumn("2026-07-30")!;
    const aug04 = spec.isoToColumn("2026-08-04")!;
    expect(span.start).toBe(jul30);
    expect(span.endExclusive).toBe(aug04 + 1);
  });
});

describe("formatMultiMonthRangeTitle", () => {
  it("formats same-year range", () => {
    expect(formatMultiMonthRangeTitle(["2026-07", "2026-08"])).toBe("July – August 2026");
    expect(formatMultiMonthRangeTitle(["2026-07", "2026-08", "2026-09"])).toBe(
      "July – September 2026",
    );
  });

  it("formats cross-year range", () => {
    expect(formatMultiMonthRangeTitle(["2026-12", "2027-01"])).toBe("December 2026 – January 2027");
  });
});
