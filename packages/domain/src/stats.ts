import { addDays, daysBetween, isoDate, type IsoDate } from "./stay.js";

export type StatsChannel = "airbnb" | "booking" | "direct";
export const STATS_CHANNELS: readonly StatsChannel[] = ["airbnb", "booking", "direct"];

/**
 * - `stay`: confirmed (or waiting for an apartment); its nights count.
 * - `cancelled`: no nights; any money paid out still counts as income.
 * - `pending`: a request not confirmed yet; counted on its own, nothing else.
 */
export type StatsKind = "stay" | "cancelled" | "pending";

/** One booking as the statistics read it (built on the server from the synced columns). */
export interface StatsBooking {
  readonly channel: StatsChannel;
  readonly kind: StatsKind;
  readonly checkin: IsoDate;
  readonly checkout: IsoDate;
  /** The apartment it sits in (the arrival one); null when not placed. */
  readonly roomId: string | null;
  /**
   * Every apartment of the stay with its nights, when the guest moved mid-stay. Left out, the whole stay counts
   * for `roomId`.
   */
  readonly pieces?: readonly { readonly roomId: string; readonly start: IsoDate; readonly end: IsoDate }[];
  /** Income that counts (the money page's rules); 0 when nothing counts. */
  readonly incomeCents: number;
  /** What reached the owner. */
  readonly payoutCents: number;
  /** The platform's cut, when known. */
  readonly feeCents: number | null;
  /** The day the booking was made, when Hosthub says. */
  readonly bookedOn: IsoDate | null;
  readonly adults: number | null;
  readonly children: number | null;
  readonly infants: number | null;
  /** Same key = same guest (phone, e-mail or full name); null when unknown. */
  readonly guestKey: string | null;
}

/** The days counted: `from` included, `to` not. */
export interface StatsPeriod {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export interface ChannelStats {
  readonly channel: StatsChannel;
  readonly bookings: number;
  readonly nights: number;
  readonly incomeCents: number;
  readonly payoutCents: number;
  readonly feeCents: number;
  readonly cancellations: number;
}

export interface RoomStats {
  readonly roomId: string;
  readonly bookings: number;
  readonly nights: number;
  readonly availableNights: number;
  /** The share of placed stays' income that falls on nights in the period. */
  readonly incomeCents: number;
}

export interface MonthStats {
  /** 1–12. */
  readonly month: number;
  /** Stays checking in this month. */
  readonly bookings: number;
  /** Nights slept this month (placed or not). */
  readonly nights: number;
  /** Nights slept in an apartment this month, for occupancy. */
  readonly placedNights: number;
  readonly availableNights: number;
  /** Income of the bookings checking in this month (as on the money page). */
  readonly incomeCents: number;
}

export interface YearStats {
  readonly period: StatsPeriod;
  /** Stays checking in during the period. */
  readonly bookings: number;
  /** Nights slept during the period. */
  readonly nights: number;
  readonly placedNights: number;
  readonly availableNights: number;
  /** Income of bookings checking in during the period (cancellations that paid included). */
  readonly incomeCents: number;
  readonly payoutCents: number;
  readonly feeCents: number;
  /** Income of the period's stays over their nights; null with no stays. */
  readonly averageNightCents: number | null;
  /** Income over every apartment night on offer; null with no apartments. */
  readonly incomePerAvailableNightCents: number | null;
  /** Whole percent; null with no apartments. */
  readonly occupancyPercent: number | null;
  /** One decimal; null with no stays. */
  readonly averageStayNights: number | null;
  /** Days between booking and check-in, one decimal; null when no stay says when it was booked. */
  readonly averageLeadDays: number | null;
  /** Adults and children per stay, one decimal; null when no stay says. */
  readonly averageGuests: number | null;
  readonly adults: number;
  readonly children: number;
  readonly infants: number;
  readonly cancellations: number;
  /** Whole percent of the period's bookings (stays + cancellations) that were cancelled; null with none. */
  readonly cancellationPercent: number | null;
  /** Paid out on cancellations (already inside the income). */
  readonly cancelledIncomeCents: number;
  readonly pending: number;
  /** Different guests among the period's stays (only those with a known key). */
  readonly distinctGuests: number;
  /** Stays by a guest who had stayed before. */
  readonly returningStays: number;
  readonly longestStayNights: number;
  readonly biggestBookingCents: number;
  readonly byChannel: readonly ChannelStats[];
  readonly byRoom: readonly RoomStats[];
  readonly byMonth: readonly MonthStats[];
  /** Stays by nights: 1, 2, 3, 4–6, 7–13, 14+. */
  readonly stayLength: readonly number[];
  /** Stays by days booked ahead: 0–6, 7–29, 30–89, 90–179, 180+. */
  readonly leadTime: readonly number[];
  /** Stays by party size (adults + children): 1, 2, 3, 4, 5+. */
  readonly partySize: readonly number[];
  /** Check-ins by weekday, Monday first. */
  readonly checkinWeekday: readonly number[];
}

export const STAY_LENGTH_BUCKETS = [1, 2, 3, 4, 7, 14] as const;
export const LEAD_TIME_BUCKETS = [0, 7, 30, 90, 180] as const;
export const PARTY_SIZE_BUCKETS = [1, 2, 3, 4, 5] as const;

/** Index of the last bucket whose lower bound is at most `value`. */
export function bucketOf(value: number, bounds: readonly number[]): number {
  let index = 0;
  for (let i = 0; i < bounds.length; i += 1) if (value >= bounds[i]!) index = i;
  return index;
}

const oneDecimal = (sum: number, count: number): number | null =>
  count > 0 ? Math.round((sum * 10) / count) / 10 : null;

const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part * 100) / whole) : null);

/** Nights of a stay that fall inside [from, to). */
export function nightsWithin(checkin: IsoDate, checkout: IsoDate, from: IsoDate, to: IsoDate): number {
  const start = checkin > from ? checkin : from;
  const end = checkout < to ? checkout : to;
  return Math.max(0, daysBetween(start, end));
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(date: IsoDate): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The earliest check-in of each known guest's stays, to tell returning guests. */
export function firstStays(bookings: readonly StatsBooking[]): Map<string, IsoDate> {
  const first = new Map<string, IsoDate>();
  for (const b of bookings) {
    if (b.kind !== "stay" || b.guestKey === null) continue;
    const seen = first.get(b.guestKey);
    if (seen === undefined || b.checkin < seen) first.set(b.guestKey, b.checkin);
  }
  return first;
}

function monthBounds(period: StatsPeriod, year: number, month: number): StatsPeriod {
  const start = isoDate(`${year}-${String(month).padStart(2, "0")}-01`);
  const next =
    month === 12 ? isoDate(`${year + 1}-01-01`) : isoDate(`${year}-${String(month + 1).padStart(2, "0")}-01`);
  return {
    from: start > period.from ? start : period.from,
    to: next < period.to ? next : period.to,
  };
}

/**
 * Every statistic for one period (usually a year, or a year up to a day). Bookings count by their
 * check-in day; nights and occupancy count by the nights that fall inside the period. The period
 * must sit inside one calendar year. `roomIds` are the apartments on offer.
 */
export function yearStats(
  bookings: readonly StatsBooking[],
  period: StatsPeriod,
  roomIds: readonly string[],
  first: Map<string, IsoDate> = firstStays(bookings),
): YearStats {
  const year = Number(period.from.slice(0, 4));
  const days = Math.max(0, daysBetween(period.from, period.to));
  const months = Array.from({ length: 12 }, (_, i) => monthBounds(period, year, i + 1));
  const rooms = new Set(roomIds);
  const inPeriod = (d: IsoDate) => d >= period.from && d < period.to;

  const channel = new Map(
    STATS_CHANNELS.map((c) => [
      c,
      { channel: c, bookings: 0, nights: 0, incomeCents: 0, payoutCents: 0, feeCents: 0, cancellations: 0 },
    ]),
  );
  const room = new Map(
    roomIds.map((id) => [id, { roomId: id, bookings: 0, nights: 0, availableNights: days, incomeCents: 0 }]),
  );
  const month = months.map((m, i) => ({
    month: i + 1,
    bookings: 0,
    nights: 0,
    placedNights: 0,
    availableNights: Math.max(0, daysBetween(m.from, m.to)) * roomIds.length,
    incomeCents: 0,
  }));
  const stayLength = new Array<number>(STAY_LENGTH_BUCKETS.length).fill(0);
  const leadTime = new Array<number>(LEAD_TIME_BUCKETS.length).fill(0);
  const partySize = new Array<number>(PARTY_SIZE_BUCKETS.length).fill(0);
  const checkinWeekday = new Array<number>(7).fill(0);
  const guests = new Set<string>();

  let stays = 0;
  let nights = 0;
  let placedNights = 0;
  let incomeCents = 0;
  let payoutCents = 0;
  let feeCents = 0;
  let stayIncome = 0;
  let stayNights = 0;
  let leadSum = 0;
  let leadCount = 0;
  let guestSum = 0;
  let guestCount = 0;
  let adults = 0;
  let children = 0;
  let infants = 0;
  let cancellations = 0;
  let cancelledIncomeCents = 0;
  let pending = 0;
  let returningStays = 0;
  let longestStayNights = 0;
  let biggestBookingCents = 0;

  for (const b of bookings) {
    const length = Math.max(0, daysBetween(b.checkin, b.checkout));
    const c = channel.get(b.channel)!;
    if (b.kind === "stay" && length > 0) {
      const slept = nightsWithin(b.checkin, b.checkout, period.from, period.to);
      nights += slept;
      c.nights += slept;
      // Each apartment gets its own nights and the matching share of the income, so a guest who moved mid-stay
      // is never counted twice.
      const parts = (
        b.pieces && b.pieces.length > 0
          ? b.pieces
          : b.roomId !== null
            ? [{ roomId: b.roomId, start: b.checkin, end: b.checkout }]
            : []
      ).filter((p) => rooms.has(p.roomId));
      for (const p of parts) {
        const inPart = nightsWithin(p.start, p.end, period.from, period.to);
        placedNights += inPart;
        const r = room.get(p.roomId)!;
        r.nights += inPart;
        r.incomeCents += (b.incomeCents * inPart) / length;
      }
      months.forEach((m, i) => {
        month[i]!.nights += nightsWithin(b.checkin, b.checkout, m.from, m.to);
        for (const p of parts) month[i]!.placedNights += nightsWithin(p.start, p.end, m.from, m.to);
      });
    }
    if (!inPeriod(b.checkin)) continue;
    const m = month[Number(b.checkin.slice(5, 7)) - 1]!;
    if (b.kind === "pending") {
      pending += 1;
      continue;
    }
    incomeCents += b.incomeCents;
    payoutCents += b.payoutCents;
    feeCents += b.feeCents ?? 0;
    c.incomeCents += b.incomeCents;
    c.payoutCents += b.payoutCents;
    c.feeCents += b.feeCents ?? 0;
    m.incomeCents += b.incomeCents;
    if (b.kind === "cancelled") {
      cancellations += 1;
      cancelledIncomeCents += b.incomeCents;
      c.cancellations += 1;
      continue;
    }
    stays += 1;
    c.bookings += 1;
    m.bookings += 1;
    if (b.roomId !== null) {
      const r = room.get(b.roomId);
      if (r) r.bookings += 1;
    }
    stayIncome += b.incomeCents;
    stayNights += length;
    stayLength[bucketOf(length, STAY_LENGTH_BUCKETS)]! += 1;
    checkinWeekday[weekdayIndex(b.checkin)]! += 1;
    longestStayNights = Math.max(longestStayNights, length);
    biggestBookingCents = Math.max(biggestBookingCents, b.incomeCents);
    if (b.bookedOn !== null) {
      const lead = Math.max(0, daysBetween(b.bookedOn, b.checkin));
      leadSum += lead;
      leadCount += 1;
      leadTime[bucketOf(lead, LEAD_TIME_BUCKETS)]! += 1;
    }
    if (b.adults !== null || b.children !== null) {
      const party = (b.adults ?? 0) + (b.children ?? 0);
      guestSum += party;
      guestCount += 1;
      if (party > 0) partySize[bucketOf(party, PARTY_SIZE_BUCKETS)]! += 1;
    }
    adults += b.adults ?? 0;
    children += b.children ?? 0;
    infants += b.infants ?? 0;
    if (b.guestKey !== null) {
      guests.add(b.guestKey);
      const seen = first.get(b.guestKey);
      if (seen !== undefined && seen < b.checkin) returningStays += 1;
    }
  }

  const availableNights = days * roomIds.length;
  return {
    period,
    bookings: stays,
    nights,
    placedNights,
    availableNights,
    incomeCents,
    payoutCents,
    feeCents,
    averageNightCents: stayNights > 0 ? Math.round(stayIncome / stayNights) : null,
    incomePerAvailableNightCents: availableNights > 0 ? Math.round(incomeCents / availableNights) : null,
    occupancyPercent: percent(placedNights, availableNights),
    averageStayNights: oneDecimal(stayNights, stays),
    averageLeadDays: oneDecimal(leadSum, leadCount),
    averageGuests: oneDecimal(guestSum, guestCount),
    adults,
    children,
    infants,
    cancellations,
    cancellationPercent: percent(cancellations, stays + cancellations),
    cancelledIncomeCents,
    pending,
    distinctGuests: guests.size,
    returningStays,
    longestStayNights,
    biggestBookingCents,
    byChannel: STATS_CHANNELS.map((c) => channel.get(c)!),
    byRoom: roomIds.map((id) => {
      const r = room.get(id)!;
      return { ...r, incomeCents: Math.round(r.incomeCents) };
    }),
    byMonth: month,
    stayLength,
    leadTime,
    partySize,
    checkinWeekday,
  };
}

/**
 * The period for a year: the whole year, or from 1 January through the same month and day as
 * `through` (that day included). 29 February runs through 1 March in a year without it.
 */
export function statsPeriod(year: number, through: { month: number; day: number } | null): StatsPeriod {
  const from = isoDate(`${String(year).padStart(4, "0")}-01-01`);
  const end = isoDate(`${String(year + 1).padStart(4, "0")}-01-01`);
  if (through === null) return { from, to: end };
  const start = isoDate(`${String(year).padStart(4, "0")}-${String(through.month).padStart(2, "0")}-01`);
  const to = addDays(start, through.day);
  return { from, to: to < end ? to : end };
}

/** Change from `before` to `now` in whole percent; null when there is nothing to compare with. */
export function percentChange(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return Math.round(((now - before) * 100) / Math.abs(before));
}
