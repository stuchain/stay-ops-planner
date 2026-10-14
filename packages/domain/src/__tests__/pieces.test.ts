import { describe, expect, it } from "vitest";
import { fitPiecesToStay, normalizePieces, placeNights, roomOnNight, samePieces, type StayPiece } from "../pieces.js";
import { isoDate } from "../stay.js";

const p = (roomId: string, start: string, end: string): StayPiece => ({
  roomId,
  start: isoDate(start),
  end: isoDate(end),
});
const d = isoDate;

describe("normalizePieces", () => {
  it("sorts, drops empty pieces and joins neighbours in the same apartment", () => {
    expect(
      normalizePieces([
        p("iris", "2026-07-09", "2026-07-11"),
        p("helios", "2026-07-08", "2026-07-09"),
        p("iris", "2026-07-11", "2026-07-12"),
        p("onar", "2026-07-12", "2026-07-12"),
      ]),
    ).toEqual([p("helios", "2026-07-08", "2026-07-09"), p("iris", "2026-07-09", "2026-07-12")]);
  });

  it("keeps same-apartment pieces apart when they do not touch, and sorts equal starts stably", () => {
    expect(normalizePieces([p("a", "2026-07-05", "2026-07-06"), p("a", "2026-07-01", "2026-07-03")])).toEqual([
      p("a", "2026-07-01", "2026-07-03"),
      p("a", "2026-07-05", "2026-07-06"),
    ]);
    expect(normalizePieces([p("a", "2026-07-01", "2026-07-02"), p("b", "2026-07-01", "2026-07-02")])).toHaveLength(2);
  });
});

describe("placeNights", () => {
  const stay = [p("helios", "2026-07-08", "2026-07-11")];

  it("moves the nights from a day to the end into another apartment", () => {
    expect(placeNights(stay, d("2026-07-09"), d("2026-07-11"), "iris")).toEqual([
      p("helios", "2026-07-08", "2026-07-09"),
      p("iris", "2026-07-09", "2026-07-11"),
    ]);
  });

  it("can move nights in the middle, leaving the apartment on both sides", () => {
    expect(placeNights(stay, d("2026-07-09"), d("2026-07-10"), "iris")).toEqual([
      p("helios", "2026-07-08", "2026-07-09"),
      p("iris", "2026-07-09", "2026-07-10"),
      p("helios", "2026-07-10", "2026-07-11"),
    ]);
  });

  it("joins pieces again when they end up in the same apartment", () => {
    const split = placeNights(stay, d("2026-07-09"), d("2026-07-11"), "iris");
    expect(placeNights(split, d("2026-07-09"), d("2026-07-11"), "helios")).toEqual(stay);
  });

  it("leaves pieces before and after the moved nights alone", () => {
    const three = [
      p("helios", "2026-07-08", "2026-07-09"),
      p("iris", "2026-07-09", "2026-07-10"),
      p("helios", "2026-07-10", "2026-07-11"),
    ];
    expect(placeNights(three, d("2026-07-09"), d("2026-07-10"), "onar")).toEqual([
      p("helios", "2026-07-08", "2026-07-09"),
      p("onar", "2026-07-09", "2026-07-10"),
      p("helios", "2026-07-10", "2026-07-11"),
    ]);
    expect(placeNights(three, d("2026-07-10"), d("2026-07-11"), "onar")[0]).toEqual(
      p("helios", "2026-07-08", "2026-07-09"),
    );
    expect(placeNights(three, d("2026-07-08"), d("2026-07-09"), "onar")[2]).toEqual(
      p("helios", "2026-07-10", "2026-07-11"),
    );
  });

  it("moves the whole stay when the nights cover it", () => {
    const split = placeNights(stay, d("2026-07-09"), d("2026-07-11"), "iris");
    expect(placeNights(split, d("2026-07-08"), d("2026-07-11"), "onar")).toEqual([
      p("onar", "2026-07-08", "2026-07-11"),
    ]);
  });
});

describe("fitPiecesToStay", () => {
  const split = [p("helios", "2026-07-08", "2026-07-09"), p("iris", "2026-07-09", "2026-07-11")];

  it("stretches the first and last piece to new dates", () => {
    expect(fitPiecesToStay(split, d("2026-07-07"), d("2026-07-13"))).toEqual([
      p("helios", "2026-07-07", "2026-07-09"),
      p("iris", "2026-07-09", "2026-07-13"),
    ]);
  });

  it("drops pieces that fall outside a shorter stay", () => {
    expect(fitPiecesToStay(split, d("2026-07-09"), d("2026-07-10"))).toEqual([p("iris", "2026-07-09", "2026-07-10")]);
  });

  it("puts a stay that moved away completely in the arrival apartment", () => {
    expect(fitPiecesToStay(split, d("2026-08-01"), d("2026-08-04"))).toEqual([p("helios", "2026-08-01", "2026-08-04")]);
  });

  it("has nothing to fit without pieces", () => {
    expect(fitPiecesToStay([], d("2026-08-01"), d("2026-08-04"))).toEqual([]);
  });
});

describe("samePieces and roomOnNight", () => {
  const split = [p("helios", "2026-07-08", "2026-07-09"), p("iris", "2026-07-09", "2026-07-11")];

  it("compares apartments and nights", () => {
    expect(samePieces(split, [...split])).toBe(true);
    expect(samePieces(split, split.slice(1))).toBe(false);
    expect(samePieces(split, [split[0]!, p("onar", "2026-07-09", "2026-07-11")])).toBe(false);
  });

  it("tells the apartment of a night", () => {
    expect(roomOnNight(split, d("2026-07-08"))).toBe("helios");
    expect(roomOnNight(split, d("2026-07-10"))).toBe("iris");
    expect(roomOnNight(split, d("2026-07-11"))).toBeNull();
  });
});
