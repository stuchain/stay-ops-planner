import { canPlace, singleNightGapsCreated, type Occupant, type RoomTimeline } from "./allocation.js";
import { compareIds, partySize, type Party, type Stay } from "./stay.js";

export interface RoomInfo {
  readonly id: string;
  /** Position on the calendar; the final tie-break. */
  readonly sortOrder: number;
  /** Beds for adults and children. Null when not set up yet. */
  readonly capacity: number | null;
  /** Cosmos and Helios: the apartments that suit parties of 3 or 4. */
  readonly preferredForLargeParty: boolean;
  readonly isActive: boolean;
}

export interface BookingToPlace {
  readonly id: string;
  readonly stay: Stay;
  /** Null when Hosthub did not say how many guests are coming. */
  readonly party: Party | null;
  /** The apartment the guest booked on the channel, when known. */
  readonly bookedRoomId?: string | null | undefined;
}

/**
 * Why a room ranks where it does. The UI turns each code into Greek,
 * for example `FITS_PARTY` into "χωράει 4 άτομα".
 */
export type ReasonCode =
  | "FREE"
  | "ROOM_TAKEN"
  | "ROOM_CLOSED"
  | "ROOM_INACTIVE"
  | "FITS_PARTY"
  | "OVER_CAPACITY"
  | "LARGE_PARTY_ROOM"
  | "SMALL_PARTY_ROOM"
  | "BOOKED_THIS_ROOM"
  | "NO_GAP"
  | "LEAVES_GAP";

export interface RankedRoom {
  readonly roomId: string;
  /** False when the room cannot take the stay; `blockedBy` then says who or what is there. */
  readonly available: boolean;
  readonly blockedBy: Occupant | null;
  /** Only the first available room is recommended. */
  readonly recommended: boolean;
  readonly reasons: readonly ReasonCode[];
  /** Placing here is allowed but the person should be told (edge case E1-2). */
  readonly warnings: readonly "OVER_CAPACITY"[];
}

export type Timelines = ReadonlyMap<string, RoomTimeline>;

const LARGE_PARTY_MIN = 3;

interface Scored {
  room: RoomInfo;
  available: boolean;
  blockedBy: Occupant | null;
  reasons: ReasonCode[];
  warnings: "OVER_CAPACITY"[];
  /** Rule scores in priority order; lower is better. Compared element by element. */
  key: number[];
}

function score(booking: BookingToPlace, room: RoomInfo, timeline: RoomTimeline): Scored {
  const reasons: ReasonCode[] = [];
  const warnings: "OVER_CAPACITY"[] = [];
  const options = { ignoreBookingId: booking.id };

  // Rule 1: free for the whole stay (and the room is in use at all).
  let blockedBy: Occupant | null = null;
  let available = room.isActive;
  if (!room.isActive) {
    reasons.push("ROOM_INACTIVE");
  } else {
    const placed = canPlace(booking.stay, timeline, options);
    if (placed.ok) {
      reasons.push("FREE");
    } else {
      available = false;
      if (placed.reason !== "INVALID_STAY") {
        blockedBy = placed.clash;
        reasons.push(placed.reason);
      }
    }
  }

  const size = booking.party === null ? null : partySize(booking.party);
  const knownSize = size !== null && size > 0 ? size : null;

  // Rule 2: capacity. Too small is allowed, with a warning, but ranks lower.
  let capacityRank = 1;
  if (knownSize !== null && room.capacity !== null) {
    if (knownSize <= room.capacity) {
      capacityRank = 0;
      reasons.push("FITS_PARTY");
    } else {
      capacityRank = 2;
      reasons.push("OVER_CAPACITY");
      warnings.push("OVER_CAPACITY");
    }
  }

  // Rules 3 and 4: large parties prefer the large-party rooms, small parties the others.
  let partyRoomRank = 0;
  if (knownSize !== null) {
    const wantsLarge = knownSize >= LARGE_PARTY_MIN;
    if (wantsLarge === room.preferredForLargeParty) {
      reasons.push(wantsLarge ? "LARGE_PARTY_ROOM" : "SMALL_PARTY_ROOM");
    } else {
      partyRoomRank = 1;
    }
  }

  // Rule 5: the apartment the guest booked.
  const bookedHere = booking.bookedRoomId === room.id;
  if (bookedHere) reasons.push("BOOKED_THIS_ROOM");

  // Rule 6: fewest single empty nights left behind.
  const gaps = available ? singleNightGapsCreated(booking.stay, timeline, options) : 0;
  if (available) reasons.push(gaps === 0 ? "NO_GAP" : "LEAVES_GAP");

  return {
    room,
    available,
    blockedBy,
    reasons,
    warnings,
    // Rule 7 (room order) is the last element.
    key: [available ? 0 : 1, capacityRank, partyRoomRank, bookedHere ? 0 : 1, gaps, room.sortOrder],
  };
}

function compareKeys(a: Scored, b: Scored): number {
  for (let i = 0; i < a.key.length; i++) {
    const diff = a.key[i]! - b.key[i]!;
    if (diff !== 0) return diff;
  }
  return compareIds(a.room.id, b.room.id);
}

/**
 * Every room, best first, each with the reasons behind its place in the list.
 * Rules, in order: free for the whole stay; fits the party (adults + children);
 * parties of 3 or more prefer large-party rooms and parties of 1 or 2 the others;
 * the apartment the guest booked; fewest single empty nights created; room order.
 */
export function rankRooms(booking: BookingToPlace, rooms: readonly RoomInfo[], timelines: Timelines): RankedRoom[] {
  const scored = rooms.map((room) => score(booking, room, timelines.get(room.id) ?? []));
  scored.sort(compareKeys);
  return scored.map((s, index) => ({
    roomId: s.room.id,
    available: s.available,
    blockedBy: s.blockedBy,
    recommended: index === 0 && s.available,
    reasons: s.reasons,
    warnings: s.warnings,
  }));
}
