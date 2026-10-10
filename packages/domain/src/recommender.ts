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

/**
 * The ranking rules, by name. Each gives a room a score (0 is best) and rooms are compared
 * on the rules in the configured order.
 */
export const RULE_NAMES = ["free", "capacity", "partyRoom", "bookedRoom", "gaps", "roomOrder"] as const;
export type RuleName = (typeof RULE_NAMES)[number];

export interface RuleSetting {
  readonly rule: RuleName;
  /** Multiplies the rule's score. 0 switches the rule off, a negative number reverses it. */
  readonly weight: number;
}

/** The order the rules are applied in (first rule decides first) and how much each counts. */
export interface RecommenderConfig {
  readonly rules: readonly RuleSetting[];
}

/** Today's behaviour: free, capacity, party size, booked room, fewest gaps, room order. */
export const DEFAULT_RECOMMENDER_CONFIG: RecommenderConfig = {
  rules: RULE_NAMES.map((rule) => ({ rule, weight: 1 })),
};

/** What one rule contributed to one room's place in the list. */
export interface RuleContribution {
  readonly rule: RuleName;
  /** The rule's own score for the room; 0 is best. */
  readonly raw: number;
  /** `raw` times the rule's weight: the number the rooms are compared on. */
  readonly value: number;
}

export type RankedRoomDetail = RankedRoom & { readonly contributions: readonly RuleContribution[] };

const LARGE_PARTY_MIN = 3;

interface Scored {
  room: RoomInfo;
  available: boolean;
  blockedBy: Occupant | null;
  reasons: ReasonCode[];
  warnings: "OVER_CAPACITY"[];
  /** Raw rule scores by rule name; lower is better. */
  scores: Record<RuleName, number>;
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
    // Rule 7 (room order) is the last rule by default.
    scores: {
      free: available ? 0 : 1,
      capacity: capacityRank,
      partyRoom: partyRoomRank,
      bookedRoom: bookedHere ? 0 : 1,
      gaps,
      roomOrder: room.sortOrder,
    },
  };
}

function contributionsOf(s: Scored, config: RecommenderConfig): RuleContribution[] {
  return config.rules.map(({ rule, weight }) => ({ rule, raw: s.scores[rule], value: s.scores[rule] * weight }));
}

/**
 * Every room, best first, each with the reasons behind its place in the list.
 * Rules, in order: free for the whole stay; fits the party (adults + children);
 * parties of 3 or more prefer large-party rooms and parties of 1 or 2 the others;
 * the apartment the guest booked; fewest single empty nights created; room order.
 * `config` changes the order and weight of the rules; the default is the order above.
 */
export function rankRooms(
  booking: BookingToPlace,
  rooms: readonly RoomInfo[],
  timelines: Timelines,
  config: RecommenderConfig = DEFAULT_RECOMMENDER_CONFIG,
): RankedRoom[] {
  return rankRoomsDetailed(booking, rooms, timelines, config).map((r) => {
    const { contributions, ...room } = r;
    void contributions;
    return room;
  });
}

/** Like `rankRooms`, plus what every rule contributed to every room (for the Dev mode debug screen). */
export function rankRoomsDetailed(
  booking: BookingToPlace,
  rooms: readonly RoomInfo[],
  timelines: Timelines,
  config: RecommenderConfig = DEFAULT_RECOMMENDER_CONFIG,
): RankedRoomDetail[] {
  const scored = rooms.map((room) => {
    const s = score(booking, room, timelines.get(room.id) ?? []);
    return { s, contributions: contributionsOf(s, config) };
  });
  scored.sort((a, b) => {
    for (let i = 0; i < a.contributions.length; i++) {
      const diff = a.contributions[i]!.value - b.contributions[i]!.value;
      if (diff !== 0) return diff;
    }
    return compareIds(a.s.room.id, b.s.room.id);
  });
  return scored.map(({ s, contributions }, index) => ({
    roomId: s.room.id,
    available: s.available,
    blockedBy: s.blockedBy,
    recommended: index === 0 && s.available,
    reasons: s.reasons,
    warnings: s.warnings,
    contributions,
  }));
}
