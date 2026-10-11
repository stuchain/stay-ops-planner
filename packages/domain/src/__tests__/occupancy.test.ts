import { describe, expect, it } from "vitest";
import {
  averageNightCents,
  occupancyByRoom,
  occupancyChange,
  occupancyPercent,
  occupancyTotal,
  type OccupancyStay,
} from "../occupancy.js";
import { isoDate } from "../stay.js";

const stay = (roomId: string, checkin: string, checkout: string, grossCents: number): OccupancyStay => ({
  roomId,
  checkin: isoDate(checkin),
  checkout: isoDate(checkout),
  grossCents,
});

describe("occupancyByRoom", () => {
  it("counts nights and gross inside a month, without the checkout day", () => {
    const [a] = occupancyByRoom([stay("a", "2026-03-10", "2026-03-14", 40_000)], 2026, ["a"]);
    expect(a!.months[2]).toEqual({ nights: 4, daysInMonth: 31, revenueCents: 40_000 });
    expect(a!.months[1]).toEqual({ nights: 0, daysInMonth: 28, revenueCents: 0 });
  });

  it("splits a stay across months by night", () => {
    const [a] = occupancyByRoom([stay("a", "2026-07-30", "2026-08-02", 30_000)], 2026, ["a"]);
    expect(a!.months[6]).toMatchObject({ nights: 2, revenueCents: 20_000 });
    expect(a!.months[7]).toMatchObject({ nights: 1, revenueCents: 10_000 });
  });

  it("keeps only the part inside the year", () => {
    const rows = occupancyByRoom(
      [stay("a", "2025-12-30", "2026-01-02", 30_000), stay("a", "2026-12-30", "2027-01-03", 40_000)],
      2026,
      ["a"],
    );
    expect(rows[0]!.months[0]).toMatchObject({ nights: 1, revenueCents: 10_000 });
    expect(rows[0]!.months[11]).toMatchObject({ nights: 2, revenueCents: 20_000 });
  });

  it("knows leap years", () => {
    expect(occupancyByRoom([], 2028, ["a"])[0]!.months[1]!.daysInMonth).toBe(29);
  });

  it("keeps apartments apart, in the order given, and ignores unknown ones and empty stays", () => {
    const rows = occupancyByRoom(
      [
        stay("b", "2026-05-01", "2026-05-03", 10_000),
        stay("zzz", "2026-05-01", "2026-05-03", 5),
        stay("a", "2026-05-05", "2026-05-05", 9),
      ],
      2026,
      ["a", "b"],
    );
    expect(rows.map((r) => r.roomId)).toEqual(["a", "b"]);
    expect(rows[0]!.months[4]!.nights).toBe(0);
    expect(rows[1]!.months[4]!.nights).toBe(2);
  });
});

describe("occupancy numbers", () => {
  const months = occupancyByRoom(
    [stay("a", "2026-01-01", "2026-01-11", 100_000), stay("a", "2026-02-01", "2026-02-08", 70_000)],
    2026,
    ["a"],
  )[0]!.months;

  it("adds the months up", () => {
    expect(occupancyTotal(months)).toEqual({ nights: 17, daysInMonth: 365, revenueCents: 170_000 });
    expect(occupancyTotal([])).toEqual({ nights: 0, daysInMonth: 0, revenueCents: 0 });
  });

  it("works out whole percent and the average night", () => {
    expect(occupancyPercent(months[0]!)).toBe(32);
    expect(occupancyPercent({ nights: 0, daysInMonth: 0 })).toBe(0);
    expect(averageNightCents(months[0]!)).toBe(10_000);
    expect(averageNightCents(months[2]!)).toBeNull();
  });

  it("compares with the year before in percentage points", () => {
    expect(occupancyChange(months[0]!, months[2]!)).toBe(32);
    expect(occupancyChange(months[2]!, months[0]!)).toBe(-32);
    expect(occupancyChange(months[2]!, months[2]!)).toBe(0);
  });
});
