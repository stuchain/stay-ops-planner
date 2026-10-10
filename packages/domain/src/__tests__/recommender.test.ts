import { describe, expect, it } from "vitest";
import type { Occupant } from "../allocation.js";
import * as recommender from "../recommender.js";
import { rankRooms, type BookingToPlace, type RoomInfo } from "../recommender.js";
import { isoDate, stay } from "../stay.js";

const rooms: RoomInfo[] = [
  { id: "onar", sortOrder: 1, capacity: 3, preferredForLargeParty: false, isActive: true },
  { id: "cosmos", sortOrder: 2, capacity: 4, preferredForLargeParty: true, isActive: true },
  { id: "iris", sortOrder: 3, capacity: 3, preferredForLargeParty: false, isActive: true },
  { id: "helios", sortOrder: 4, capacity: 4, preferredForLargeParty: true, isActive: true },
];

const guest = (adults: number, children = 0, infants = 0) => ({ adults, children, infants });
const want = (party: BookingToPlace["party"], extra: Partial<BookingToPlace> = {}): BookingToPlace => ({
  id: "new",
  stay: stay("2026-10-10", "2026-10-13"),
  party,
  ...extra,
});
const busy = (id: string, from: string, to: string): Occupant => ({
  kind: "booking",
  id,
  stay: stay(from, to),
  guestName: id,
});
const order = (ranked: ReturnType<typeof rankRooms>) => ranked.map((r) => r.roomId);

describe("rankRooms", () => {
  it("sends a party of 4 to the large-party rooms first", () => {
    const ranked = rankRooms(want(guest(2, 2, 1)), rooms, new Map());
    expect(order(ranked)).toEqual(["cosmos", "helios", "onar", "iris"]);
    expect(ranked[0]).toMatchObject({
      recommended: true,
      reasons: ["FREE", "FITS_PARTY", "LARGE_PARTY_ROOM", "NO_GAP"],
    });
    expect(ranked[2]).toMatchObject({ recommended: false, warnings: ["OVER_CAPACITY"] });
  });

  it("sends a couple to the smaller rooms first", () => {
    const ranked = rankRooms(want(guest(2)), rooms, new Map());
    expect(order(ranked)).toEqual(["onar", "iris", "cosmos", "helios"]);
    expect(ranked[0]!.reasons).toContain("SMALL_PARTY_ROOM");
  });

  it("puts busy, closed and inactive rooms last with the reason", () => {
    const blockStay = { kind: "block", id: "b", stay: stay("2026-10-01", "2026-10-20") } as const;
    const timelines = new Map<string, Occupant[]>([
      ["cosmos", [busy("Maria", "2026-10-12", "2026-10-15")]],
      ["helios", [blockStay]],
    ]);
    const closedOnar = rooms.map((r) => (r.id === "onar" ? { ...r, isActive: false } : r));
    const ranked = rankRooms(want(guest(4)), closedOnar, timelines);
    expect(order(ranked)).toEqual(["iris", "cosmos", "helios", "onar"]);
    expect(ranked[0]).toMatchObject({ available: true, recommended: true, warnings: ["OVER_CAPACITY"] });
    expect(ranked[1]).toMatchObject({ available: false, reasons: expect.arrayContaining(["ROOM_TAKEN"]) });
    expect(ranked[1]!.blockedBy).toMatchObject({ guestName: "Maria" });
    expect(ranked[2]).toMatchObject({ available: false, reasons: expect.arrayContaining(["ROOM_CLOSED"]) });
    expect(ranked[3]).toMatchObject({
      available: false,
      blockedBy: null,
      reasons: expect.arrayContaining(["ROOM_INACTIVE"]),
    });
  });

  it("recommends nothing when every room is busy", () => {
    const allBusy = new Map(rooms.map((r) => [r.id, [busy(`g-${r.id}`, "2026-10-01", "2026-10-30")]]));
    expect(rankRooms(want(guest(2)), rooms, allBusy).some((r) => r.recommended)).toBe(false);
  });

  it("prefers the apartment the guest booked when the party rules tie", () => {
    const ranked = rankRooms(want(guest(2), { bookedRoomId: "iris" }), rooms, new Map());
    expect(order(ranked).slice(0, 2)).toEqual(["iris", "onar"]);
    expect(ranked[0]!.reasons).toContain("BOOKED_THIS_ROOM");
  });

  it("avoids leaving a single empty night", () => {
    const timelines = new Map<string, Occupant[]>([["onar", [busy("x", "2026-10-05", "2026-10-09")]]]);
    const ranked = rankRooms(want(guest(2)), rooms, timelines);
    expect(order(ranked).slice(0, 2)).toEqual(["iris", "onar"]);
    expect(ranked[1]!.reasons).toContain("LEAVES_GAP");
  });

  it("falls back to room order when the party size is unknown or zero", () => {
    expect(order(rankRooms(want(null), rooms, new Map()))).toEqual(["onar", "cosmos", "iris", "helios"]);
    expect(order(rankRooms(want(guest(0)), rooms, new Map()))).toEqual(["onar", "cosmos", "iris", "helios"]);
  });

  it("treats an unset capacity as unknown, not as too small", () => {
    const unset = rooms.map((r) => ({ ...r, capacity: null }));
    const ranked = rankRooms(want(guest(4)), unset, new Map());
    expect(order(ranked)).toEqual(["cosmos", "helios", "onar", "iris"]);
    expect(ranked.every((r) => r.warnings.length === 0)).toBe(true);
  });

  it("ignores the booking itself when re-ranking a placed booking", () => {
    const timelines = new Map<string, Occupant[]>([["onar", [busy("new", "2026-10-10", "2026-10-13")]]]);
    expect(rankRooms(want(guest(2)), rooms, timelines)[0]!.roomId).toBe("onar");
  });

  it("breaks a full tie by id and marks an invalid stay as unavailable", () => {
    const twins: RoomInfo[] = [
      { id: "b", sortOrder: 1, capacity: 2, preferredForLargeParty: false, isActive: true },
      { id: "a", sortOrder: 1, capacity: 2, preferredForLargeParty: false, isActive: true },
    ];
    expect(order(rankRooms(want(guest(2)), twins, new Map()))).toEqual(["a", "b"]);
    const bad = want(guest(2), { stay: { checkin: isoDate("2026-10-10"), checkout: isoDate("2026-10-10") } });
    expect(rankRooms(bad, twins, new Map()).every((r) => !r.available && r.blockedBy === null)).toBe(true);
  });
});

describe("rankRooms rule config", () => {
  const { DEFAULT_RECOMMENDER_CONFIG, RULE_NAMES, rankRoomsDetailed } = recommender;
  const parties = [guest(1), guest(2), guest(2, 1), guest(2, 2, 1), guest(4)];
  const withWeight = (rule: string, weight: number) => ({
    rules: DEFAULT_RECOMMENDER_CONFIG.rules.map((r) => (r.rule === rule ? { ...r, weight } : r)),
  });

  it("the default config gives the same ranking as no config", () => {
    for (const party of parties) {
      const timelines = new Map<string, Occupant[]>([
        ["onar", [busy("x", "2026-10-08", "2026-10-09")]],
        ["helios", [busy("y", "2026-10-14", "2026-10-16")]],
      ]);
      const b = want(party, { bookedRoomId: "iris" });
      expect(rankRooms(b, rooms, timelines, DEFAULT_RECOMMENDER_CONFIG)).toEqual(rankRooms(b, rooms, timelines));
    }
    expect(DEFAULT_RECOMMENDER_CONFIG.rules.map((r) => r.rule)).toEqual([...RULE_NAMES]);
  });

  it("a changed order changes the ranking", () => {
    expect(order(rankRooms(want(guest(2)), rooms, new Map()))).toEqual(["onar", "iris", "cosmos", "helios"]);
    const roomOrderFirst = {
      rules: [
        { rule: "roomOrder" as const, weight: 1 },
        ...DEFAULT_RECOMMENDER_CONFIG.rules.filter((r) => r.rule !== "roomOrder"),
      ],
    };
    expect(order(rankRooms(want(guest(2)), rooms, new Map(), roomOrderFirst))).toEqual([
      "onar",
      "cosmos",
      "iris",
      "helios",
    ]);
  });

  it("weight 0 switches a rule off and a negative weight reverses it", () => {
    expect(order(rankRooms(want(guest(2)), rooms, new Map(), withWeight("partyRoom", 0)))).toEqual([
      "onar",
      "cosmos",
      "iris",
      "helios",
    ]);
    expect(order(rankRooms(want(guest(2)), rooms, new Map(), withWeight("partyRoom", -1)))).toEqual([
      "cosmos",
      "helios",
      "onar",
      "iris",
    ]);
  });

  it("detailed ranking lists every rule's contribution in config order", () => {
    const detail = rankRoomsDetailed(want(guest(2)), rooms, new Map());
    expect(detail[0]!.contributions.map((c) => c.rule)).toEqual([...RULE_NAMES]);
    expect(detail[0]!.contributions.find((c) => c.rule === "roomOrder")).toMatchObject({ raw: 1, value: 1 });
  });
});
