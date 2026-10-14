import { describe, expect, it } from "vitest";
import { matchPaperStays, nameLikeness, nameWords, paperStays, type PaperNight } from "../paperCalendar.js";
import { isoDate } from "../stay.js";

const d = isoDate;

/** One cell per night from `start` for `nights` nights. */
function nights(apartment: number, start: string, count: number, text: string): PaperNight[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    return { date: d(date.toISOString().slice(0, 10)), apartment, text };
  });
}

describe("nameWords", () => {
  it("spells names in plain capital Latin letters", () => {
    expect(nameWords("  Χρήστος  Παπαδόπουλος 2")).toEqual(["CHRISTOS", "PAPADOPOULOS"]);
    expect(nameWords("M0LLOY")).toEqual(["MOLLOY"]);
    expect(nameWords("Müller-Lüdenscheidt")).toEqual(["MULLER", "LUDENSCHEIDT"]);
    expect(nameWords("2")).toEqual([]);
  });
});

describe("paperStays", () => {
  it("joins a guest's nights, keeps the number of guests, and follows a guest who moved", () => {
    const stays = paperStays([
      ...nights(1, "2026-09-10", 1, "DIRK"),
      ...nights(0, "2026-09-11", 3, "DIRK"),
      ...nights(2, "2026-08-11", 1, "YURTERI"),
      ...nights(2, "2026-08-12", 1, "YURTERI 3"),
      ...nights(1, "2026-08-13", 1, "YURTERI 2"),
      ...nights(3, "2026-08-11", 2, "ANTONIOU 2"),
    ]);
    expect(stays).toEqual([
      {
        name: "YURTERI",
        key: "YURTERI",
        guests: 3,
        start: "2026-08-11",
        end: "2026-08-14",
        parts: [
          { apartment: 2, start: "2026-08-11", end: "2026-08-13" },
          { apartment: 1, start: "2026-08-13", end: "2026-08-14" },
        ],
      },
      {
        name: "ANTONIOU",
        key: "ANTONIOU",
        guests: 2,
        start: "2026-08-11",
        end: "2026-08-13",
        parts: [{ apartment: 3, start: "2026-08-11", end: "2026-08-13" }],
      },
      {
        name: "DIRK",
        key: "DIRK",
        guests: null,
        start: "2026-09-10",
        end: "2026-09-14",
        parts: [
          { apartment: 1, start: "2026-09-10", end: "2026-09-11" },
          { apartment: 0, start: "2026-09-11", end: "2026-09-14" },
        ],
      },
    ]);
  });

  it("starts a new stay for another name, a gap, or a guest back later; ignores cells without a name", () => {
    const stays = paperStays([
      ...nights(0, "2026-07-01", 2, "TODNER 2"),
      ...nights(0, "2026-07-03", 2, "MEIER"),
      ...nights(0, "2026-07-08", 1, "MEIER"),
      ...nights(1, "2026-07-01", 1, " 5 "),
      ...nights(1, "2026-07-02", 1, "TODNER"),
    ]);
    expect(stays.map((s) => [s.name, s.start, s.end, s.parts.length])).toEqual([
      ["TODNER", "2026-07-01", "2026-07-03", 1],
      ["TODNER", "2026-07-02", "2026-07-03", 1],
      ["MEIER", "2026-07-03", "2026-07-05", 1],
      ["MEIER", "2026-07-08", "2026-07-09", 1],
    ]);
  });
});

describe("nameLikeness", () => {
  it("finds the surname in the full name, even misspelled", () => {
    expect(nameLikeness("NENTWING", "Olaf Nentwig")).toBeGreaterThan(0.85);
    expect(nameLikeness("DIRK", "DIRK - LUT")).toBe(1);
    expect(nameLikeness("EKE", "Martin Eke")).toBe(1);
    expect(nameLikeness("ΧΡΗΣΤΙΔΗΣ", "Ghristos Christidis")).toBe(1);
    expect(nameLikeness("ASLIM", "Sinem Atilgan Onder")).toBeLessThan(0.7);
    expect(nameLikeness("", "Anyone")).toBe(0);
    expect(nameLikeness("AB", "AB")).toBe(1);
  });
});

describe("matchPaperStays", () => {
  const stay = (name: string, start: string, end: string) =>
    paperStays(nights(0, start, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000), name))[0]!;
  const booking = (id: string, guestName: string | null, checkin: string, checkout: string) => ({
    id,
    guestName,
    checkin: d(checkin),
    checkout: d(checkout),
  });

  it("pairs each stay with one booking: by name, by name with other dates, or by the same dates alone", () => {
    const stays = [
      stay("NENTWING", "2026-01-01", "2026-01-22"),
      stay("ROODVELDT", "2026-05-15", "2026-06-07"),
      stay("ASLIM", "2026-07-01", "2026-07-04"),
      stay("NOBODY", "2026-08-01", "2026-08-03"),
      stay("FARAWAY", "2026-09-01", "2026-09-03"),
    ];
    const bookings = [
      booking("b1", "Olaf Nentwig", "2026-01-01", "2026-01-22"),
      booking("b2", "Nathalie Roodveltd", "2026-05-14", "2026-06-08"),
      booking("b3", "Sinem Atilgan", "2026-07-01", "2026-07-04"),
      booking("b4", null, "2026-08-02", "2026-08-05"),
      booking("b5", "Faraway", "2026-10-01", "2026-10-03"),
    ];
    expect(matchPaperStays(stays, bookings).map((m) => [m.stay.name, m.bookingId, m.kind])).toEqual([
      ["NENTWING", "b1", "sure"],
      ["ROODVELDT", "b2", "dates"],
      ["ASLIM", "b3", "name"],
      ["NOBODY", null, null],
      ["FARAWAY", null, null],
    ]);
  });

  it("gives a booking to the closest stay only", () => {
    const stays = [stay("MEIER", "2026-07-01", "2026-07-03"), stay("MEIER", "2026-07-03", "2026-07-08")];
    const result = matchPaperStays(stays, [booking("m", "Hans Meier", "2026-07-03", "2026-07-08")]);
    expect(result.map((m) => m.bookingId)).toEqual([null, "m"]);
  });

  it("takes the later-starting and earlier-ending sides of a partial overlap", () => {
    const stays = [stay("MEIER", "2026-07-02", "2026-07-10")];
    const result = matchPaperStays(stays, [booking("m", "Hans Meier", "2026-07-01", "2026-07-05")]);
    expect(result[0]).toMatchObject({ bookingId: "m", kind: "dates" });
  });

  it("gives a stay the best of several bookings", () => {
    const stays = [stay("MEIER", "2026-07-01", "2026-07-10")];
    const result = matchPaperStays(stays, [
      booking("late", "Hans Meier", "2026-07-03", "2026-07-12"),
      booking("close", "Anna Meier", "2026-07-01", "2026-07-09"),
    ]);
    expect(result[0]).toMatchObject({ bookingId: "close", kind: "dates" });
  });
});
