import type { StayPiece } from "@stay-ops/domain";
import { dbDateToIso } from "@/server/time";

/**
 * Where a booking sleeps, as stored: one assignment row per apartment, in date order. Most bookings have one;
 * a guest who moved apartment mid-stay has one per apartment. Use with `assignments: piecesArgs`.
 */
export const piecesArgs = {
  orderBy: { startDate: "asc" },
  select: { roomId: true, startDate: true, endDate: true, pinned: true },
} as const;

type PieceRow = { roomId: string; startDate: Date; endDate: Date };

export function toPieces(rows: readonly PieceRow[]): StayPiece[] {
  return rows.map((r) => ({ roomId: r.roomId, start: dbDateToIso(r.startDate), end: dbDateToIso(r.endDate) }));
}

/** The apartment the guest arrives in: arrival cards, messages, the money sheet's "stayed" apartment. */
export function arrivalPiece<T>(rows: readonly T[]): T | null {
  return rows[0] ?? null;
}

/** The apartment the guest leaves from: departures and the checkout cleaning. */
export function departurePiece<T>(rows: readonly T[]): T | null {
  return rows[rows.length - 1] ?? null;
}
