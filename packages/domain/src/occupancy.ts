import { daysBetween, isoDate, type IsoDate } from "./stay.js";

/** A stay that counts for occupancy: confirmed and placed in an apartment. */
export interface OccupancyStay {
  readonly roomId: string;
  readonly checkin: IsoDate;
  readonly checkout: IsoDate;
  /** What the guest paid for the whole stay. */
  readonly grossCents: number;
}

export interface MonthOccupancy {
  /** Nights slept in this apartment in this month. */
  readonly nights: number;
  readonly daysInMonth: number;
  /** The share of the stays' gross that falls on those nights. */
  readonly revenueCents: number;
}

export interface RoomOccupancy {
  readonly roomId: string;
  /** January to December. */
  readonly months: readonly MonthOccupancy[];
}

function monthStart(year: number, month: number): IsoDate {
  return isoDate(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`);
}

/**
 * Nights and revenue per apartment per month for one year. A stay is split by night across
 * the months it spans (the checkout day is not a night), and its gross is shared equally
 * between its nights. Stays of apartments not in `roomIds` are ignored.
 */
export function occupancyByRoom(
  stays: readonly OccupancyStay[],
  year: number,
  roomIds: readonly string[],
): RoomOccupancy[] {
  const bounds = Array.from({ length: 13 }, (_, i) => (i === 12 ? monthStart(year + 1, 1) : monthStart(year, i + 1)));
  const nights = new Map(roomIds.map((id) => [id, new Array<number>(12).fill(0)]));
  const revenue = new Map(roomIds.map((id) => [id, new Array<number>(12).fill(0)]));
  for (const stay of stays) {
    const n = nights.get(stay.roomId);
    const r = revenue.get(stay.roomId);
    const total = daysBetween(stay.checkin, stay.checkout);
    if (!n || !r || total <= 0) continue;
    for (let m = 0; m < 12; m += 1) {
      const from = stay.checkin > bounds[m]! ? stay.checkin : bounds[m]!;
      const to = stay.checkout < bounds[m + 1]! ? stay.checkout : bounds[m + 1]!;
      const inMonth = Math.max(0, daysBetween(from, to));
      n[m]! += inMonth;
      r[m]! += (stay.grossCents * inMonth) / total;
    }
  }
  return roomIds.map((roomId) => ({
    roomId,
    months: bounds.slice(0, 12).map((start, m) => ({
      nights: nights.get(roomId)![m]!,
      daysInMonth: daysBetween(start, bounds[m + 1]!),
      revenueCents: Math.round(revenue.get(roomId)![m]!),
    })),
  }));
}

/** The twelve months added up. */
export function occupancyTotal(months: readonly MonthOccupancy[]): MonthOccupancy {
  return months.reduce(
    (sum, m) => ({
      nights: sum.nights + m.nights,
      daysInMonth: sum.daysInMonth + m.daysInMonth,
      revenueCents: sum.revenueCents + m.revenueCents,
    }),
    { nights: 0, daysInMonth: 0, revenueCents: 0 },
  );
}

/** Whole percent of the nights taken; 0 when there are no days. */
export function occupancyPercent(m: Pick<MonthOccupancy, "nights" | "daysInMonth">): number {
  return m.daysInMonth > 0 ? Math.round((m.nights * 100) / m.daysInMonth) : 0;
}

/** Average gross per night, in cents; null when no night was stayed. */
export function averageNightCents(m: Pick<MonthOccupancy, "nights" | "revenueCents">): number | null {
  return m.nights > 0 ? Math.round(m.revenueCents / m.nights) : null;
}

/** Percentage points this year is above (+) or below (-) last year, from the shown whole percents. */
export function occupancyChange(now: MonthOccupancy, before: MonthOccupancy): number {
  return occupancyPercent(now) - occupancyPercent(before);
}
