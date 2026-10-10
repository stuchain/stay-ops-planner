import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findConflicts, overbookedNights } from "../allocation.js";
import { planAssignments } from "../planner.js";
import { rankRooms, type BookingToPlace, type RoomInfo } from "../recommender.js";
import { addDays, isoDate } from "../stay.js";

const START = isoDate("2026-01-01");

const roomsArb = fc
  .array(
    fc.record({
      capacity: fc.option(fc.integer({ min: 1, max: 6 }), { nil: null }),
      preferredForLargeParty: fc.boolean(),
    }),
    { minLength: 1, maxLength: 5 },
  )
  .map((list): RoomInfo[] => list.map((r, i) => ({ id: `room-${i}`, sortOrder: i, isActive: true, ...r })));

const bookingsArb = fc
  .array(
    fc.record({
      start: fc.integer({ min: 0, max: 60 }),
      length: fc.integer({ min: 1, max: 14 }),
      adults: fc.integer({ min: 0, max: 4 }),
      children: fc.integer({ min: 0, max: 3 }),
      infants: fc.integer({ min: 0, max: 2 }),
    }),
    { maxLength: 30 },
  )
  .map((list): BookingToPlace[] =>
    list.map((b, i) => ({
      id: `b-${i}`,
      stay: { checkin: addDays(START, b.start), checkout: addDays(START, b.start + b.length) },
      party: { adults: b.adults, children: b.children, infants: b.infants },
    })),
  );

describe("domain properties", () => {
  it("no plan ever double-books", () => {
    fc.assert(
      fc.property(bookingsArb, roomsArb, (bookings, rooms) => {
        const plan = planAssignments(bookings, rooms, []);
        const byId = new Map(bookings.map((b) => [b.id, b]));
        const placements = [...plan.assignments].map(([bookingId, roomId]) => ({
          roomId,
          occupant: { kind: "booking" as const, id: bookingId, stay: byId.get(bookingId)!.stay },
        }));
        expect(findConflicts({ placements })).toEqual([]);
        expect(plan.assignments.size + plan.unplaced.length).toBe(bookings.length);
      }),
    );
  });

  it("if no night has more stays than rooms and nothing is pinned, a plan exists", () => {
    fc.assert(
      fc.property(bookingsArb, roomsArb, (bookings, rooms) => {
        const overbooked = overbookedNights(
          bookings.map((b) => b.stay),
          rooms.length,
          START,
          addDays(START, 120),
        );
        fc.pre(overbooked.length === 0);
        expect(planAssignments(bookings, rooms, []).unplaced).toEqual([]);
      }),
    );
  });

  it("a party of 4 is never recommended a room for 2 when a bigger free room exists", () => {
    fc.assert(
      fc.property(bookingsArb, roomsArb, (bookings, rooms) => {
        const sized = rooms.map((r, i) => ({ ...r, capacity: i === 0 ? 2 : r.capacity }));
        const plan = planAssignments(bookings, sized, []);
        const timelines = new Map(
          sized.map((r) => [r.id, [] as { kind: "booking"; id: string; stay: BookingToPlace["stay"] }[]]),
        );
        for (const b of bookings) {
          const roomId = plan.assignments.get(b.id);
          if (roomId) timelines.get(roomId)!.push({ kind: "booking", id: b.id, stay: b.stay });
        }
        const four: BookingToPlace = {
          id: "four",
          stay: { checkin: START, checkout: addDays(START, 3) },
          party: { adults: 4, children: 0, infants: 0 },
        };
        const ranked = rankRooms(four, sized, timelines);
        const best = ranked[0]!;
        const biggerFree = ranked.some(
          (r) => r.available && r.warnings.length === 0 && sized.find((s) => s.id === r.roomId)!.capacity !== null,
        );
        if (biggerFree) expect(best.roomId).not.toBe("room-0");
      }),
    );
  });

  it("ranking is deterministic and does not depend on input order", () => {
    fc.assert(
      fc.property(bookingsArb, roomsArb, fc.integer({ min: 0, max: 60 }), (bookings, rooms, offset) => {
        const timelines = new Map(
          rooms.map((r) => [r.id, [] as { kind: "booking"; id: string; stay: BookingToPlace["stay"] }[]]),
        );
        bookings.forEach((b, i) =>
          timelines.get(rooms[i % rooms.length]!.id)!.push({ kind: "booking", id: b.id, stay: b.stay }),
        );
        const target: BookingToPlace = {
          id: "target",
          stay: { checkin: addDays(START, offset), checkout: addDays(START, offset + 2) },
          party: { adults: 3, children: 0, infants: 0 },
        };
        const a = rankRooms(target, rooms, timelines);
        const b = rankRooms(target, [...rooms].reverse(), timelines);
        expect(b).toEqual(a);
      }),
    );
  });
});
