import { describe, expect, it } from "vitest";
import { shortGaps, type Occupied } from "../gaps.js";
import { isoDate } from "../stay.js";

const o = (roomId: string, start: string, end: string): Occupied => ({
  id: `${roomId}:${start}`,
  roomId,
  start: isoDate(start),
  end: isoDate(end),
});

describe("shortGaps", () => {
  it("finds single empty nights by default, and longer gaps up to maxNights", () => {
    expect(shortGaps([o("a", "2026-07-01", "2026-07-05"), o("a", "2026-07-07", "2026-07-09")])).toEqual([]);
    expect(
      shortGaps(
        [o("a", "2026-07-01", "2026-07-05"), o("a", "2026-07-06", "2026-07-09"), o("a", "2026-07-11", "2026-07-15")],
        { maxNights: 2 },
      ),
    ).toEqual([
      {
        roomId: "a",
        start: "2026-07-05",
        end: "2026-07-06",
        nights: 1,
        beforeId: "a:2026-07-01",
        afterId: "a:2026-07-06",
      },
      {
        roomId: "a",
        start: "2026-07-09",
        end: "2026-07-11",
        nights: 2,
        beforeId: "a:2026-07-06",
        afterId: "a:2026-07-11",
      },
    ]);
  });

  it("ignores back-to-back stays, long gaps and other apartments", () => {
    expect(
      shortGaps([
        o("a", "2026-07-01", "2026-07-05"),
        o("a", "2026-07-05", "2026-07-08"),
        o("a", "2026-07-11", "2026-07-14"),
        o("b", "2026-07-09", "2026-07-10"),
      ]),
    ).toEqual([]);
  });

  it("measures from the latest end when stays overlap", () => {
    expect(
      shortGaps([
        o("a", "2026-07-01", "2026-07-10"),
        o("a", "2026-07-02", "2026-07-04"),
        o("a", "2026-07-11", "2026-07-12"),
      ]),
    ).toMatchObject([{ start: "2026-07-10", end: "2026-07-11", nights: 1, beforeId: "a:2026-07-01" }]);
  });

  it("lists apartments in id order and skips empty ranges", () => {
    const gaps = shortGaps([
      o("b", "2026-07-01", "2026-07-02"),
      o("b", "2026-07-03", "2026-07-04"),
      o("a", "2026-07-01", "2026-07-02"),
      o("a", "2026-07-02", "2026-07-02"),
      o("a", "2026-07-03", "2026-07-04"),
    ]);
    expect(gaps.map((g) => `${g.roomId}:${g.start}`)).toEqual(["a:2026-07-02", "b:2026-07-02"]);
  });

  it("keeps only gaps that end after the given day and honours maxNights", () => {
    const list = [
      o("a", "2026-07-01", "2026-07-02"),
      o("a", "2026-07-03", "2026-07-04"),
      o("a", "2026-07-07", "2026-07-08"),
    ];
    expect(shortGaps(list, { after: isoDate("2026-07-03") }).map((g) => g.start)).toEqual([]);
    expect(shortGaps(list, { after: isoDate("2026-07-02"), maxNights: 3 }).map((g) => g.start)).toEqual([
      "2026-07-02",
      "2026-07-04",
    ]);
  });
});
