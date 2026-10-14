import type { IsoDate } from "./stay.js";

/**
 * One piece of a stay in one apartment: nights `[start, end)`. A booking is usually one piece; a guest who moved
 * apartment mid-stay has several, back to back from check-in to check-out.
 */
export type StayPiece = { readonly roomId: string; readonly start: IsoDate; readonly end: IsoDate };

const byStart = (a: StayPiece, b: StayPiece) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

/** Sorted by date, empty pieces dropped, and neighbours in the same apartment joined into one. */
export function normalizePieces(pieces: readonly StayPiece[]): StayPiece[] {
  const out: StayPiece[] = [];
  for (const p of [...pieces].sort(byStart)) {
    if (p.end <= p.start) continue;
    const last = out[out.length - 1];
    if (last && last.roomId === p.roomId && last.end === p.start) out[out.length - 1] = { ...last, end: p.end };
    else out.push(p);
  }
  return out;
}

/**
 * The nights `[from, to)` go to `roomId`; every other night keeps its apartment. Pieces in the same apartment
 * that end up next to each other become one again.
 */
export function placeNights(pieces: readonly StayPiece[], from: IsoDate, to: IsoDate, roomId: string): StayPiece[] {
  const kept = pieces.flatMap((p) => [
    { roomId: p.roomId, start: p.start, end: p.end < from ? p.end : from },
    { roomId: p.roomId, start: p.start > to ? p.start : to, end: p.end },
  ]);
  return normalizePieces([...kept, { roomId, start: from, end: to }]);
}

/**
 * Pieces after the booking's dates changed: cut to the new stay, with the first piece starting at check-in and
 * the last ending at check-out. When none of the old nights are left, the whole new stay goes to the apartment
 * the guest arrived in.
 */
export function fitPiecesToStay(pieces: readonly StayPiece[], checkin: IsoDate, checkout: IsoDate): StayPiece[] {
  const sorted = normalizePieces(pieces);
  const first = sorted[0];
  if (!first) return [];
  const inside = normalizePieces(
    sorted.map((p) => ({
      roomId: p.roomId,
      start: p.start < checkin ? checkin : p.start,
      end: p.end > checkout ? checkout : p.end,
    })),
  );
  if (inside.length === 0) return [{ roomId: first.roomId, start: checkin, end: checkout }];
  const out = [...inside];
  out[0] = { ...out[0]!, start: checkin };
  out[out.length - 1] = { ...out[out.length - 1]!, end: checkout };
  return out;
}

/** Same apartments on the same nights. */
export function samePieces(a: readonly StayPiece[], b: readonly StayPiece[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => p.roomId === b[i]!.roomId && p.start === b[i]!.start && p.end === b[i]!.end)
  );
}

/** The apartment for one night, or null when that night has none. */
export function roomOnNight(pieces: readonly StayPiece[], night: IsoDate): string | null {
  return pieces.find((p) => p.start <= night && night < p.end)?.roomId ?? null;
}
