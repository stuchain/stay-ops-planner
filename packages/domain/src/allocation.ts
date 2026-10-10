import { addDays, compareDates, eachNight, isValidStay, overlaps, type IsoDate, type Stay } from "./stay.js";

/** Something that occupies an apartment: a placed booking or a closed period. */
export type Occupant =
  | { readonly kind: "booking"; readonly id: string; readonly stay: Stay; readonly guestName?: string | undefined }
  | { readonly kind: "block"; readonly id: string; readonly stay: Stay; readonly reason?: string | undefined };

/** Everything already in one apartment. Order does not matter. */
export type RoomTimeline = readonly Occupant[];

export type CannotPlaceReason = "INVALID_STAY" | "ROOM_TAKEN" | "ROOM_CLOSED";

export type PlaceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "INVALID_STAY" }
  | { readonly ok: false; readonly reason: "ROOM_TAKEN" | "ROOM_CLOSED"; readonly clash: Occupant };

export interface PlaceOptions {
  /** Ignore this booking when it is already in the timeline (moving it within or back to its room). */
  readonly ignoreBookingId?: string | undefined;
}

/** The earliest occupant that clashes with `stay`, or null when the stay fits. */
export function firstClash(stay: Stay, timeline: RoomTimeline, options: PlaceOptions = {}): Occupant | null {
  let clash: Occupant | null = null;
  for (const occupant of timeline) {
    if (occupant.kind === "booking" && occupant.id === options.ignoreBookingId) continue;
    if (!overlaps(stay, occupant.stay)) continue;
    if (clash === null || compareDates(occupant.stay.checkin, clash.stay.checkin) < 0) clash = occupant;
  }
  return clash;
}

export function canPlace(stay: Stay, timeline: RoomTimeline, options: PlaceOptions = {}): PlaceResult {
  if (!isValidStay(stay)) return { ok: false, reason: "INVALID_STAY" };
  const clash = firstClash(stay, timeline, options);
  if (clash === null) return { ok: true };
  return { ok: false, reason: clash.kind === "booking" ? "ROOM_TAKEN" : "ROOM_CLOSED", clash };
}

/** A whole plan: who is in which apartment. */
export interface Plan {
  readonly placements: readonly { readonly roomId: string; readonly occupant: Occupant }[];
}

export interface Conflict {
  readonly roomId: string;
  readonly a: Occupant;
  readonly b: Occupant;
}

/** Every pair of occupants that share a night in the same apartment. */
export function findConflicts(plan: Plan): Conflict[] {
  const byRoom = new Map<string, Occupant[]>();
  for (const { roomId, occupant } of plan.placements) {
    const list = byRoom.get(roomId) ?? [];
    list.push(occupant);
    byRoom.set(roomId, list);
  }
  const conflicts: Conflict[] = [];
  for (const [roomId, occupants] of byRoom) {
    const sorted = [...occupants].sort((x, y) => compareDates(x.stay.checkin, y.stay.checkin));
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]!;
        if (b.stay.checkin >= a.stay.checkout) break;
        conflicts.push({ roomId, a, b });
      }
    }
  }
  return conflicts;
}

/**
 * Nights where more stays want a bed than there are apartments (edge case E1-6).
 * `stays` are the confirmed stays, placed or not; only nights inside `[from, to)` are returned.
 */
export function overbookedNights(stays: readonly Stay[], activeRooms: number, from: IsoDate, to: IsoDate): IsoDate[] {
  const counts = new Map<IsoDate, number>();
  for (const s of stays) {
    for (const night of eachNight(s)) {
      if (night < from || night >= to) continue;
      counts.set(night, (counts.get(night) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count > activeRooms)
    .map(([night]) => night)
    .sort(compareDates);
}

/**
 * Single empty nights that placing `stay` would leave next to its neighbours in the timeline.
 * A one-night gap is hard to sell, so the recommender prefers rooms where this is 0.
 */
export function singleNightGapsCreated(stay: Stay, timeline: RoomTimeline, options: PlaceOptions = {}): number {
  let gaps = 0;
  const others = timeline.filter((o) => !(o.kind === "booking" && o.id === options.ignoreBookingId));
  const dayBefore = addDays(stay.checkin, -1);
  const dayAfter = addDays(stay.checkout, 1);
  const before = others.some((o) => o.stay.checkout === dayBefore);
  const beforeTouching = others.some((o) => o.stay.checkout > dayBefore && o.stay.checkin < stay.checkin);
  if (before && !beforeTouching) gaps++;
  const after = others.some((o) => o.stay.checkin === dayAfter);
  const afterTouching = others.some((o) => o.stay.checkin < dayAfter && o.stay.checkout > stay.checkout);
  if (after && !afterTouching) gaps++;
  return gaps;
}
