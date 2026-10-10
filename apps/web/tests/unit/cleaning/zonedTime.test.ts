import { describe, expect, it } from "vitest";
import {
  computeTurnoverPlannedWindowUTC,
  DEFAULT_CHECKIN_TIME,
  DEFAULT_CHECKOUT_TIME,
  utcToZonedDay,
  zonedTimeToUtc,
} from "@stay-ops/db";

const ATHENS = "Europe/Athens";

describe("cleaning times in Athens time (E4-2)", () => {
  it("keeps the default stay times in one place", () => {
    expect(DEFAULT_CHECKOUT_TIME).toBe("11:00");
    expect(DEFAULT_CHECKIN_TIME).toBe("15:00");
  });

  it("is UTC+3 in summer and UTC+2 in winter", () => {
    expect(zonedTimeToUtc("2026-07-15", "11:00", ATHENS).toISOString()).toBe("2026-07-15T08:00:00.000Z");
    expect(zonedTimeToUtc("2026-01-15", "11:00", ATHENS).toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("is right on the days the clocks change", () => {
    // Spring forward: 2026-03-29, 03:00 becomes 04:00. Morning is still winter time, afternoon is summer time.
    expect(zonedTimeToUtc("2026-03-29", "01:00", ATHENS).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(zonedTimeToUtc("2026-03-29", "11:00", ATHENS).toISOString()).toBe("2026-03-29T08:00:00.000Z");
    // Fall back: 2026-10-25, 04:00 becomes 03:00. Midnight is still summer time, 11:00 is winter time.
    expect(zonedTimeToUtc("2026-10-25", "00:00", ATHENS).toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(zonedTimeToUtc("2026-10-25", "11:00", ATHENS).toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("puts the default cleaning window at 11:00 on the checkout day, 120 minutes long", () => {
    const summer = computeTurnoverPlannedWindowUTC(new Date("2026-07-15T00:00:00.000Z"));
    expect(summer.plannedStart.toISOString()).toBe("2026-07-15T08:00:00.000Z");
    expect(summer.plannedEnd.toISOString()).toBe("2026-07-15T10:00:00.000Z");
    const winter = computeTurnoverPlannedWindowUTC(new Date("2026-12-15T00:00:00.000Z"));
    expect(winter.plannedStart.toISOString()).toBe("2026-12-15T09:00:00.000Z");
    const changeDay = computeTurnoverPlannedWindowUTC(new Date("2026-10-25T00:00:00.000Z"));
    expect(changeDay.plannedStart.toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(changeDay.plannedEnd.toISOString()).toBe("2026-10-25T11:00:00.000Z");
  });

  it("reads the calendar day in Athens, so a late evening is not the next day", () => {
    expect(utcToZonedDay(new Date("2026-07-15T21:30:00.000Z"), ATHENS)).toBe("2026-07-16");
    expect(utcToZonedDay(new Date("2026-01-15T21:30:00.000Z"), ATHENS)).toBe("2026-01-15");
  });
});
