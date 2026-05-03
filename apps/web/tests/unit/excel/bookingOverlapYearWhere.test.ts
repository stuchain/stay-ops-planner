import { describe, expect, it } from "vitest";
import { bookingOverlapsUtcCalendarYearWhere } from "@/app/api/excel/listings/bookingOverlapYearWhere";

describe("bookingOverlapsUtcCalendarYearWhere", () => {
  it("uses half-open interval [yearStart, nextYearStart) for occupied nights", () => {
    const w = bookingOverlapsUtcCalendarYearWhere(2026);
    expect(w.checkinDate.lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(w.checkoutDate.gt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
