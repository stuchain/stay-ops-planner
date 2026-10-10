import { describe, expect, it } from "vitest";
import { planAssignments } from "../planner.js";
import type { BookingToPlace, RoomInfo } from "../recommender.js";
import { stay } from "../stay.js";

const rooms: RoomInfo[] = [
  { id: "onar", sortOrder: 1, capacity: 3, preferredForLargeParty: false, isActive: true },
  { id: "cosmos", sortOrder: 2, capacity: 4, preferredForLargeParty: true, isActive: true },
];
const b = (id: string, from: string, to: string, adults = 2): BookingToPlace => ({
  id,
  stay: stay(from, to),
  party: { adults, children: 0, infants: 0 },
});

describe("planAssignments", () => {
  it("places bookings by arrival with the recommender's choice", () => {
    const result = planAssignments(
      [
        b("late", "2026-10-05", "2026-10-07"),
        b("big", "2026-10-01", "2026-10-04", 4),
        b("couple", "2026-10-02", "2026-10-06"),
      ],
      rooms,
      [],
    );
    expect(Object.fromEntries(result.assignments)).toEqual({ big: "cosmos", couple: "onar", late: "cosmos" });
    expect(result.unplaced).toEqual([]);
  });

  it("works around pinned placements and reports what does not fit", () => {
    const result = planAssignments([b("x", "2026-10-02", "2026-10-03"), b("y", "2026-10-02", "2026-10-03")], rooms, [
      { roomId: "onar", occupant: { kind: "block", id: "closed", stay: stay("2026-10-01", "2026-10-05") } },
      { roomId: "gone", occupant: { kind: "block", id: "ignored", stay: stay("2026-10-01", "2026-10-05") } },
    ]);
    expect(Object.fromEntries(result.assignments)).toEqual({ x: "cosmos" });
    expect(result.unplaced).toEqual(["y"]);
  });

  it("orders same-day arrivals longest first, then by id", () => {
    const result = planAssignments(
      [b("b", "2026-10-01", "2026-10-02"), b("a", "2026-10-01", "2026-10-02"), b("long", "2026-10-01", "2026-10-09")],
      rooms,
      [],
    );
    expect(result.unplaced).toEqual(["b"]);
  });

  it("returns the ranked pick with reasons for each placement", () => {
    const result = planAssignments([b("big", "2026-10-01", "2026-10-04", 4)], rooms, []);
    const pick = result.picks.get("big");
    expect(pick?.roomId).toBe("cosmos");
    expect(pick?.reasons).toContain("LARGE_PARTY_ROOM");
    expect(result.picks.size).toBe(1);
  });

  it("follows the given recommender config", () => {
    // Room order first: the 4-person party goes to the first room despite the large-party rule.
    const config = { rules: [{ rule: "roomOrder" as const, weight: 1 }] };
    const result = planAssignments([b("big", "2026-10-01", "2026-10-04", 4)], rooms, [], config);
    expect(result.assignments.get("big")).toBe("onar");
  });

  it("places nothing when there are no rooms", () => {
    expect(planAssignments([b("x", "2026-10-01", "2026-10-02")], [], []).unplaced).toEqual(["x"]);
  });
});
