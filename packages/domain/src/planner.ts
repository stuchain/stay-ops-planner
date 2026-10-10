import type { Occupant } from "./allocation.js";
import { rankRooms, type BookingToPlace, type RoomInfo } from "./recommender.js";
import { compareDates, compareIds, nights } from "./stay.js";

export interface PinnedPlacement {
  readonly roomId: string;
  readonly occupant: Occupant;
}

export interface PlanResult {
  /** bookingId to roomId for every booking the planner placed. */
  readonly assignments: ReadonlyMap<string, string>;
  /** Bookings that fit nowhere, in the order they were tried. */
  readonly unplaced: readonly string[];
}

/**
 * Place every booking in an apartment without double-booking, around what is pinned
 * (manual placements and closed periods). Bookings are taken in order of arrival and
 * each goes to the room `rankRooms` likes best among the free ones. Taking intervals
 * by start date and giving each any free room is optimal interval colouring, so when
 * nothing is pinned and no night has more stays than active rooms, everything fits.
 */
export function planAssignments(
  bookings: readonly BookingToPlace[],
  rooms: readonly RoomInfo[],
  pinned: readonly PinnedPlacement[],
): PlanResult {
  const timelines = new Map<string, Occupant[]>(rooms.map((r) => [r.id, []]));
  for (const p of pinned) timelines.get(p.roomId)?.push(p.occupant);

  const ordered = [...bookings].sort(
    (a, b) => compareDates(a.stay.checkin, b.stay.checkin) || nights(b.stay) - nights(a.stay) || compareIds(a.id, b.id),
  );

  const assignments = new Map<string, string>();
  const unplaced: string[] = [];
  for (const booking of ordered) {
    const best = rankRooms(booking, rooms, timelines)[0];
    if (best === undefined || !best.available) {
      unplaced.push(booking.id);
      continue;
    }
    assignments.set(booking.id, best.roomId);
    timelines.get(best.roomId)!.push({ kind: "booking", id: booking.id, stay: booking.stay });
  }
  return { assignments, unplaced };
}
