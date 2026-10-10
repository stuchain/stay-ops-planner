/**
 * Stays are half-open ranges of calendar dates: the guest sleeps the nights from
 * `checkin` up to (not including) `checkout`, so the checkout day is free for the
 * next guest. Dates are plain `YYYY-MM-DD` strings, never `Date` objects, so time
 * zones cannot shift a stay by a day.
 */

declare const isoDateBrand: unique symbol;

export type IsoDate = string & { readonly [isoDateBrand]: "IsoDate" };

export interface Stay {
  readonly checkin: IsoDate;
  readonly checkout: IsoDate;
}

/** Who is in the party. Infants do not take a bed and never count towards capacity. */
export interface Party {
  readonly adults: number;
  readonly children: number;
  readonly infants: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True only for a real calendar date: `2026-02-30` is rejected, not rolled into March. */
export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.toISOString().slice(0, 10) === value;
}

export function isoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`Not a calendar date: ${value}`);
  return value;
}

function toUtcMs(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10) as IsoDate;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** `YYYY-MM-DD` strings sort lexically in date order. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Plain code-unit order for ids, independent of the locale. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function stay(checkin: string, checkout: string): Stay {
  const result = { checkin: isoDate(checkin), checkout: isoDate(checkout) };
  if (!isValidStay(result)) throw new RangeError(`Checkout must be after checkin: ${checkin} to ${checkout}`);
  return result;
}

export function isValidStay(s: Stay): boolean {
  return s.checkout > s.checkin;
}

export function nights(s: Stay): number {
  return daysBetween(s.checkin, s.checkout);
}

/** Half-open overlap: a stay that checks out on the day another checks in does not clash. */
export function overlaps(a: Stay, b: Stay): boolean {
  return a.checkin < b.checkout && b.checkin < a.checkout;
}

/** Each night slept, by the date the night starts. */
export function eachNight(s: Stay): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = s.checkin; d < s.checkout; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Adults plus children; infants do not count. */
export function partySize(party: Party): number {
  return party.adults + party.children;
}
