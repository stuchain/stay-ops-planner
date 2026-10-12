import { compareDates, daysBetween, type IsoDate } from "./stay.js";

/** Gaps of this many empty nights or fewer between two stays are hard to sell. */
export const GAP_MAX_NIGHTS = 2;

/** How far ahead the Today screen lists gap nights. */
export const GAP_LOOKAHEAD_DAYS = 60;

/** Something that takes an apartment for `[start, end)`: a placed stay or a closed period. */
export interface Occupied {
  /** The booking or closed period, so a gap can point at its neighbours. */
  readonly id: string;
  readonly roomId: string;
  readonly start: IsoDate;
  readonly end: IsoDate;
}

/** Empty nights `[start, end)` in one apartment, between two things that take it. */
export interface GapNights {
  readonly roomId: string;
  readonly start: IsoDate;
  readonly end: IsoDate;
  readonly nights: number;
  /** What ends where the gap starts, and what starts where it ends. */
  readonly beforeId: string;
  readonly afterId: string;
}

/**
 * Short empty gaps (1 to `maxNights` nights) between stays or closed periods in the same apartment.
 * Overlapping or back-to-back stays leave no gap; the open time before the first and after the last stay
 * is not a gap. Only gaps that end after `after` (usually today) are returned, by apartment then date.
 */
export function shortGaps(
  occupied: readonly Occupied[],
  opts: { after?: IsoDate; maxNights?: number } = {},
): GapNights[] {
  const maxNights = opts.maxNights ?? GAP_MAX_NIGHTS;
  const byRoom = new Map<string, Occupied[]>();
  for (const o of occupied) {
    if (compareDates(o.start, o.end) >= 0) continue;
    byRoom.set(o.roomId, [...(byRoom.get(o.roomId) ?? []), o]);
  }
  const out: GapNights[] = [];
  for (const [roomId, list] of [...byRoom.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    list.sort((a, b) => compareDates(a.start, b.start));
    let last = list[0]!;
    for (const o of list.slice(1)) {
      const nights = daysBetween(last.end, o.start);
      if (nights >= 1 && nights <= maxNights && (opts.after === undefined || compareDates(o.start, opts.after) > 0)) {
        out.push({ roomId, start: last.end, end: o.start, nights, beforeId: last.id, afterId: o.id });
      }
      if (compareDates(o.end, last.end) > 0) last = o;
    }
  }
  return out;
}
