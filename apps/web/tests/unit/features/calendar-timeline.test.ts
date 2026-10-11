// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isoDate } from "@stay-ops/domain";
import {
  addMonths,
  blocksToLoad,
  createDrawnDaysStore,
  dateAt,
  dayIndex,
  drawnDays,
  DRAW_OVERSCAN_DAYS,
  DRAW_STEP_DAYS,
  monthsBetween,
  spanAround,
} from "@/features/calendar/timeline";
import { createTranslator } from "next-intl";
import { recommendationText } from "@/features/calendar/recommendation";
import { agoParts } from "@/features/shell/SyncIndicator";
import type { CalendarBooking } from "@/api/types";
import { laneOf } from "@/features/calendar/CalendarGrid";
import el from "../../../messages/el.json";

describe("calendar timeline", () => {
  const span = spanAround(isoDate("2026-10-10"));

  it("spans 2 years back to 18 months ahead in 3-month blocks", () => {
    expect(span.origin).toBe("2024-10-01");
    expect(span.end).toBe("2028-04-01");
    expect(span.blocks).toHaveLength(14);
    expect(span.blocks[8]).toEqual({ from: "2026-10-01", to: "2027-01-01" });
  });

  it("maps dates to columns and back", () => {
    const i = dayIndex(span, isoDate("2026-10-10"));
    expect(dateAt(span, i)).toBe("2026-10-10");
    expect(addMonths(isoDate("2026-11-01"), 2)).toBe("2027-01-01");
    expect(addMonths(isoDate("2026-01-01"), -1)).toBe("2025-12-01");
  });

  it("loads the blocks on screen and their neighbours", () => {
    const today = dayIndex(span, isoDate("2026-10-10"));
    expect(blocksToLoad(span, today, today + 20)).toEqual([7, 8]);
    expect(blocksToLoad(span, 0, 20)).toEqual([0]);
  });

  it("lists the months for the sticky labels", () => {
    const from = dayIndex(span, isoDate("2026-10-20"));
    const months = monthsBetween(span, from, from + 20);
    expect(months.map((m) => m.start)).toEqual(["2026-10-01", "2026-11-01"]);
  });
});

const tBooking = createTranslator({ locale: "el", messages: el, namespace: "booking" });
const tAgo = createTranslator({ locale: "el", messages: el, namespace: "common.ago" });
const agoText = (iso: string, now: Date) => {
  const ago = agoParts(iso, now);
  return ago.unit === "now" ? tAgo("now") : tAgo(ago.unit, { count: ago.count });
};

describe("calendar text", () => {
  it("explains the recommendation in words", () => {
    expect(recommendationText(tBooking, ["FREE", "FITS_PARTY", "LARGE_PARTY_ROOM"], 4)).toBe(
      "Προτείνεται: χωράει 4 άτομα",
    );
    expect(recommendationText(tBooking, ["FREE", "BOOKED_THIS_ROOM"], 2)).toBe(
      "Προτείνεται: αυτό έκλεισε ο επισκέπτης",
    );
    expect(recommendationText(tBooking, ["FREE", "NO_GAP"], null)).toBe("Προτείνεται: δεν αφήνει κενή νύχτα");
  });

  it("says how long ago Hosthub updated", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(agoText("2026-10-10T11:55:00Z", now)).toBe("πριν από 5 λεπτά");
    expect(agoText("2026-10-10T11:59:50Z", now)).toBe("μόλις τώρα");
    expect(agoText("2026-10-10T09:00:00Z", now)).toBe("πριν από 3 ώρες");
    expect(agoText("2026-10-08T12:00:00Z", now)).toBe("πριν από 2 μέρες");
  });
});

describe("past stays without an apartment", () => {
  const stay = (id: string, checkin: string, checkout: string) =>
    ({ id, checkin: isoDate(checkin), checkout: isoDate(checkout) }) as CalendarBooking;

  it("puts overlapping stays on separate lanes and reuses a lane once it is free", () => {
    const lanes = laneOf([
      stay("a", "2026-05-01", "2026-05-05"),
      stay("b", "2026-05-03", "2026-05-08"),
      stay("c", "2026-05-05", "2026-05-07"),
    ]);
    expect(Object.fromEntries(lanes)).toEqual({ a: 0, b: 1, c: 0 });
  });
});

describe("drawn days while scrolling", () => {
  it("covers the screen plus the overscan and only changes every step", () => {
    const at = (left: number) => drawnDays(left, 1060, 44, 208);
    const first = at(700 * 44);
    expect(first.firstDay).toBeLessThanOrEqual(700 - DRAW_OVERSCAN_DAYS);
    expect(first.lastDay).toBeGreaterThanOrEqual(700 + Math.ceil(852 / 44) + DRAW_OVERSCAN_DAYS);
    // A few days of scrolling inside the same step draws the same days.
    expect(at(700 * 44 + 3 * 44)).toEqual(at(700 * 44 + 1));
    expect(at(700 * 44 + DRAW_STEP_DAYS * 44).firstDay).toBe(first.firstDay + DRAW_STEP_DAYS);
  });

  it("tells subscribers only when the drawn days change", () => {
    const store = createDrawnDaysStore({ firstDay: 0, lastDay: 70 });
    let calls = 0;
    const stop = store.subscribe(() => calls++);
    store.set({ firstDay: 0, lastDay: 70 });
    expect(calls).toBe(0);
    store.set({ firstDay: 14, lastDay: 84 });
    expect(calls).toBe(1);
    expect(store.get()).toEqual({ firstDay: 14, lastDay: 84 });
    stop();
    store.set({ firstDay: 28, lastDay: 98 });
    expect(calls).toBe(1);
  });
});
