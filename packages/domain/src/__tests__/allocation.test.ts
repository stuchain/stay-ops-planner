import { describe, expect, it } from "vitest";
import { canPlace, findConflicts, firstClash, overbookedNights, singleNightGapsCreated, type Occupant } from "../allocation.js";
import { isoDate, stay } from "../stay.js";

const booking = (id: string, from: string, to: string, guestName?: string): Occupant => ({
  kind: "booking",
  id,
  stay: stay(from, to),
  guestName,
});
const block = (id: string, from: string, to: string): Occupant => ({ kind: "block", id, stay: stay(from, to) });

describe("canPlace", () => {
  it("fits an empty room and back-to-back stays", () => {
    expect(canPlace(stay("2026-10-01", "2026-10-03"), [])).toEqual({ ok: true });
    expect(canPlace(stay("2026-10-03", "2026-10-05"), [booking("a", "2026-10-01", "2026-10-03")])).toEqual({ ok: true });
  });

  it("names the guest who is there", () => {
    const maria = booking("a", "2026-10-01", "2026-10-05", "Maria");
    expect(canPlace(stay("2026-10-04", "2026-10-06"), [maria])).toEqual({ ok: false, reason: "ROOM_TAKEN", clash: maria });
  });

  it("reports a closed period", () => {
    const closed = block("b", "2026-10-01", "2026-10-05");
    expect(canPlace(stay("2026-10-04", "2026-10-06"), [closed])).toEqual({ ok: false, reason: "ROOM_CLOSED", clash: closed });
  });

  it("rejects an invalid stay", () => {
    expect(canPlace({ checkin: isoDate("2026-10-05"), checkout: isoDate("2026-10-05") }, [])).toEqual({
      ok: false,
      reason: "INVALID_STAY",
    });
  });

  it("ignores the booking being moved", () => {
    expect(canPlace(stay("2026-10-02", "2026-10-04"), [booking("a", "2026-10-01", "2026-10-05")], { ignoreBookingId: "a" })).toEqual({
      ok: true,
    });
  });

  it("returns the earliest clash", () => {
    const later = booking("late", "2026-10-08", "2026-10-10");
    const earlier = booking("early", "2026-10-02", "2026-10-04");
    expect(firstClash(stay("2026-10-01", "2026-10-09"), [later, earlier])).toBe(earlier);
    expect(firstClash(stay("2026-10-01", "2026-10-09"), [earlier, later])).toBe(earlier);
  });
});

describe("findConflicts", () => {
  it("finds every overlapping pair per room", () => {
    const a = booking("a", "2026-10-01", "2026-10-05");
    const b = booking("b", "2026-10-04", "2026-10-06");
    const c = booking("c", "2026-10-05", "2026-10-07");
    const d = booking("d", "2026-10-01", "2026-10-09");
    const conflicts = findConflicts({
      placements: [
        { roomId: "r1", occupant: a },
        { roomId: "r1", occupant: b },
        { roomId: "r1", occupant: c },
        { roomId: "r2", occupant: d },
      ],
    });
    expect(conflicts).toEqual([
      { roomId: "r1", a, b },
      { roomId: "r1", a: b, b: c },
    ]);
  });
});

describe("overbookedNights", () => {
  it("returns nights inside the range where stays exceed rooms", () => {
    const stays = [stay("2026-10-01", "2026-10-04"), stay("2026-10-02", "2026-10-05"), stay("2026-10-03", "2026-10-04")];
    expect(overbookedNights(stays, 2, isoDate("2026-10-01"), isoDate("2026-10-31"))).toEqual(["2026-10-03"]);
    expect(overbookedNights(stays, 1, isoDate("2026-10-03"), isoDate("2026-10-04"))).toEqual(["2026-10-03"]);
    expect(overbookedNights(stays, 1, isoDate("2026-10-02"), isoDate("2026-10-04"))).toEqual(["2026-10-02", "2026-10-03"]);
  });
});

describe("singleNightGapsCreated", () => {
  const timeline = [booking("prev", "2026-10-01", "2026-10-04"), booking("next", "2026-10-09", "2026-10-12")];

  it("counts a one-night gap on each side", () => {
    expect(singleNightGapsCreated(stay("2026-10-05", "2026-10-08"), timeline)).toBe(2);
  });

  it("counts nothing when the stay is back to back or leaves longer gaps", () => {
    expect(singleNightGapsCreated(stay("2026-10-04", "2026-10-09"), timeline)).toBe(0);
    expect(singleNightGapsCreated(stay("2026-10-06", "2026-10-07"), timeline)).toBe(0);
  });

  it("does not count a night that someone else already fills", () => {
    const filled = [...timeline, booking("x", "2026-10-04", "2026-10-05"), booking("y", "2026-10-08", "2026-10-09")];
    expect(singleNightGapsCreated(stay("2026-10-05", "2026-10-08"), filled)).toBe(0);
  });

  it("ignores the booking being moved", () => {
    expect(singleNightGapsCreated(stay("2026-10-05", "2026-10-08"), timeline, { ignoreBookingId: "prev" })).toBe(1);
  });
});
