/** Calendar column spans for a stay within a single month grid (UTC YYYY-MM-DD strings). */

import type { CalendarBookingItem } from "./calendarTypes";

export type StayNightSpanInMonth = {
  /** Half-open [nightStart, nightEndExclusive): day columns that are stay *nights* in this month. */
  nightStart: number;
  nightEndExclusive: number;
  /** Checkout day-of-month when checkout falls in this month (for checkout nib). */
  checkoutDayInMonth: number | null;
};

function isoDateInMonth(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

function dayOfMonthIso(iso: string): number {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.getUTCDate();
}

/**
 * Which calendar days in `month` are stay nights: checkin <= date < checkout (half-open).
 */
export function stayNightSpanInMonth(
  startDate: string,
  endDate: string,
  month: string,
  monthDayCount: number,
): StayNightSpanInMonth {
  const checkoutDayInMonth = endDate.slice(0, 7) === month ? dayOfMonthIso(endDate) : null;

  const nights: number[] = [];
  for (let d = 1; d <= monthDayCount; d++) {
    const iso = isoDateInMonth(month, d);
    if (iso >= startDate && iso < endDate) {
      nights.push(d);
    }
  }

  if (nights.length === 0) {
    if (checkoutDayInMonth != null) {
      return {
        nightStart: checkoutDayInMonth,
        nightEndExclusive: checkoutDayInMonth,
        checkoutDayInMonth,
      };
    }
    return { nightStart: 1, nightEndExclusive: 1, checkoutDayInMonth: null };
  }

  const nightStart = nights[0]!;
  const nightEndExclusive = nights[nights.length - 1]! + 1;
  return { nightStart, nightEndExclusive, checkoutDayInMonth };
}

/** First column where the bar is drawn (nights, or checkout-only column). */
export function barStartColumn(span: StayNightSpanInMonth): number {
  if (span.nightEndExclusive > span.nightStart) return span.nightStart;
  return span.checkoutDayInMonth ?? span.nightStart;
}

/** Exclusive grid line after the last visual column (nights + optional checkout column). */
export function layoutEndExclusive(span: StayNightSpanInMonth): number {
  if (span.checkoutDayInMonth != null) {
    return Math.max(span.nightEndExclusive, span.checkoutDayInMonth + 1);
  }
  return span.nightEndExclusive;
}

export type BookingSpanInMonth = {
  /** Night occupancy columns [start, endExclusive) — may be empty (equal). */
  start: number;
  endExclusive: number;
  barStart: number;
  layoutEndExclusive: number;
  checkoutDayInMonth: number | null;
};

/** Checkout (`endDate`, exclusive) is strictly after the last calendar day shown in the grid — stay continues beyond the view. */
export function isStayCheckoutAfterVisibleLastDay(endDate: string, lastVisibleDayIso: string): boolean {
  return endDate.slice(0, 10) > lastVisibleDayIso;
}

export function bookingSpanFromStayDates(
  startDate: string,
  endDate: string,
  month: string,
  monthDayCount: number,
): BookingSpanInMonth {
  const span = stayNightSpanInMonth(startDate, endDate, month, monthDayCount);
  return {
    start: span.nightStart,
    endExclusive: span.nightEndExclusive,
    barStart: barStartColumn(span),
    layoutEndExclusive: layoutEndExclusive(span),
    checkoutDayInMonth: span.checkoutDayInMonth,
  };
}

/** True if another booking in the room checks out on the same calendar day as this stay's first night column (checkout nib aligns with check-in). */
export function hasPriorCheckoutOnFirstNightDay(
  roomBookings: CalendarBookingItem[],
  selfId: string,
  month: string,
  monthDayCount: number,
  firstNightStart: number,
): boolean {
  if (firstNightStart < 1) return false;
  for (const o of roomBookings) {
    if (o.id === selfId) continue;
    const s = bookingSpanFromStayDates(o.startDate, o.endDate, month, monthDayCount);
    if (s.checkoutDayInMonth != null && s.checkoutDayInMonth === firstNightStart) return true;
  }
  return false;
}

/** True if another booking in the room starts its stay (first night column) on `checkoutDay` (same calendar day as this booking's checkout). */
export function hasNextCheckinOnCheckoutDay(
  roomBookings: CalendarBookingItem[],
  selfId: string,
  month: string,
  monthDayCount: number,
  checkoutDay: number | null,
): boolean {
  if (checkoutDay == null || checkoutDay < 1) return false;
  for (const o of roomBookings) {
    if (o.id === selfId) continue;
    const s = bookingSpanFromStayDates(o.startDate, o.endDate, month, monthDayCount);
    if (s.endExclusive > s.start && s.start === checkoutDay) return true;
  }
  return false;
}
