// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isoDate } from "@stay-ops/domain";
import { addMonths, blocksToLoad, dateAt, dayIndex, monthsBetween, spanAround } from "@/features/calendar/timeline";
import { recommendationText } from "@/features/calendar/text";
import { agoText } from "@/features/shell/SyncIndicator";

describe("calendar timeline", () => {
  const span = spanAround(isoDate("2026-10-10"));

  it("spans 6 months back to 18 ahead in 3-month blocks", () => {
    expect(span.origin).toBe("2026-04-01");
    expect(span.end).toBe("2028-04-01");
    expect(span.blocks).toHaveLength(8);
    expect(span.blocks[2]).toEqual({ from: "2026-10-01", to: "2027-01-01" });
  });

  it("maps dates to columns and back", () => {
    const i = dayIndex(span, isoDate("2026-10-10"));
    expect(dateAt(span, i)).toBe("2026-10-10");
    expect(addMonths(isoDate("2026-11-01"), 2)).toBe("2027-01-01");
    expect(addMonths(isoDate("2026-01-01"), -1)).toBe("2025-12-01");
  });

  it("loads the blocks on screen and their neighbours", () => {
    const today = dayIndex(span, isoDate("2026-10-10"));
    expect(blocksToLoad(span, today, today + 20)).toEqual([1, 2]);
    expect(blocksToLoad(span, 0, 20)).toEqual([0]);
  });

  it("lists the months for the sticky labels", () => {
    const from = dayIndex(span, isoDate("2026-10-20"));
    const months = monthsBetween(span, from, from + 20);
    expect(months.map((m) => m.start)).toEqual(["2026-10-01", "2026-11-01"]);
  });
});

describe("calendar text", () => {
  it("explains the recommendation in words", () => {
    expect(recommendationText(["FREE", "FITS_PARTY", "LARGE_PARTY_ROOM"], 4)).toBe("Προτείνεται: χωράει 4 άτομα");
    expect(recommendationText(["FREE", "BOOKED_THIS_ROOM"], 2)).toBe("Προτείνεται: αυτό έκλεισε ο επισκέπτης");
    expect(recommendationText(["FREE", "NO_GAP"], null)).toBe("Προτείνεται: δεν αφήνει κενή νύχτα");
  });

  it("says how long ago Hosthub updated", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(agoText("2026-10-10T11:55:00Z", now)).toBe("πριν από 5 λεπτά");
    expect(agoText("2026-10-10T11:59:50Z", now)).toBe("μόλις τώρα");
    expect(agoText("2026-10-10T09:00:00Z", now)).toBe("πριν από 3 ώρες");
    expect(agoText("2026-10-08T12:00:00Z", now)).toBe("πριν από 2 μέρες");
  });
});
