/**
 * Multi-month timeline: map a contiguous YYYY-MM list to 1-based day columns
 * (same indexing idea as single-month grids, extended across months).
 */

import type { CalendarBookingItem } from "./calendarTypes";
import {
  barStartColumn,
  layoutEndExclusive,
  type BookingSpanInMonth,
  type StayNightSpanInMonth,
} from "./monthSpan";

function isoDateInMonth(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

function dayOfMonthIso(iso: string): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return d.getUTCDate();
}

export function daysInCalendarMonth(ym: string): number {
  const parts = ym.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  return new Date(y, m, 0).getDate();
}

export type MultiMonthRangeSpec = {
  months: string[];
  totalDayCount: number;
  /** 1-based column index → YYYY-MM-DD */
  columnToIso: (col: number) => string;
  /** YYYY-MM-DD (or longer ISO) → 1-based column, or null if outside range */
  isoToColumn: (iso: string) => number | null;
  /** 1-based columns where a new month starts (not including column 1) */
  monthBoundaryColumns: number[];
};

export function buildMultiMonthRange(months: string[]): MultiMonthRangeSpec {
  if (months.length === 0) {
    return {
      months: [],
      totalDayCount: 0,
      columnToIso: () => "",
      isoToColumn: () => null,
      monthBoundaryColumns: [],
    };
  }

  const colToIso: string[] = [];
  const boundaries: number[] = [];
  let col = 1;
  for (let mi = 0; mi < months.length; mi++) {
    const ym = months[mi]!;
    if (mi > 0) boundaries.push(col);
    const dc = daysInCalendarMonth(ym);
    for (let d = 1; d <= dc; d++) {
      colToIso[col] = isoDateInMonth(ym, d);
      col++;
    }
  }
  const totalDayCount = col - 1;

  const isoLookup = new Map<string, number>();
  for (let c = 1; c <= totalDayCount; c++) {
    isoLookup.set(colToIso[c]!, c);
  }

  return {
    months,
    totalDayCount,
    columnToIso: (c: number) => colToIso[c] ?? "",
    isoToColumn: (iso: string) => {
      const day = iso.slice(0, 10);
      return isoLookup.get(day) ?? null;
    },
    monthBoundaryColumns: boundaries,
  };
}

type StayNightSpanInRange = {
  nightStart: number;
  nightEndExclusive: number;
  checkoutColumn: number | null;
};

function stayNightSpanInRange(
  startDate: string,
  endDate: string,
  spec: MultiMonthRangeSpec,
): StayNightSpanInRange {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  const nights: number[] = [];
  for (let c = 1; c <= spec.totalDayCount; c++) {
    const iso = spec.columnToIso(c);
    if (iso >= start && iso < end) nights.push(c);
  }

  const checkoutCol = spec.isoToColumn(end);

  if (nights.length === 0) {
    if (checkoutCol != null) {
      return {
        nightStart: checkoutCol,
        nightEndExclusive: checkoutCol,
        checkoutColumn: checkoutCol,
      };
    }
    return { nightStart: 1, nightEndExclusive: 1, checkoutColumn: null };
  }

  const nightStart = nights[0]!;
  const nightEndExclusive = nights[nights.length - 1]! + 1;
  return { nightStart, nightEndExclusive, checkoutColumn: checkoutCol };
}

/** Same shape as single-month span; values are 1-based columns in the combined range. */
export function bookingSpanInRange(
  startDate: string,
  endDate: string,
  spec: MultiMonthRangeSpec,
): BookingSpanInMonth {
  const span = stayNightSpanInRange(startDate, endDate, spec);
  const asStay: StayNightSpanInMonth = {
    nightStart: span.nightStart,
    nightEndExclusive: span.nightEndExclusive,
    checkoutDayInMonth: span.checkoutColumn,
  };
  return {
    start: span.nightStart,
    endExclusive: span.nightEndExclusive,
    barStart: barStartColumn(asStay),
    layoutEndExclusive: layoutEndExclusive(asStay),
    checkoutDayInMonth: span.checkoutColumn,
  };
}

export function hasPriorCheckoutOnFirstNightDayRange(
  roomBookings: CalendarBookingItem[],
  selfId: string,
  spec: MultiMonthRangeSpec,
  firstNightStart: number,
): boolean {
  if (firstNightStart < 1) return false;
  for (const o of roomBookings) {
    if (o.id === selfId) continue;
    const s = bookingSpanInRange(o.startDate, o.endDate, spec);
    if (s.checkoutDayInMonth != null && s.checkoutDayInMonth === firstNightStart) return true;
  }
  return false;
}

export function hasNextCheckinOnCheckoutDayRange(
  roomBookings: CalendarBookingItem[],
  selfId: string,
  spec: MultiMonthRangeSpec,
  checkoutDay: number | null,
): boolean {
  if (checkoutDay == null || checkoutDay < 1) return false;
  for (const o of roomBookings) {
    if (o.id === selfId) continue;
    const s = bookingSpanInRange(o.startDate, o.endDate, spec);
    if (s.endExclusive > s.start && s.start === checkoutDay) return true;
  }
  return false;
}

export function layoutRowsInRange(
  items: CalendarBookingItem[],
  spec: MultiMonthRangeSpec,
): Array<{ item: CalendarBookingItem; lane: number }> {
  type LaneState = {
    end: number;
    lastSpan: BookingSpanInMonth;
  };

  function isCheckinCutIn(item: CalendarBookingItem, span: BookingSpanInMonth): boolean {
    if (span.endExclusive <= span.start) return false;
    const firstIso = spec.columnToIso(span.start);
    return firstIso === item.startDate.slice(0, 10);
  }

  function canReuseMateLane(
    lane: LaneState,
    span: BookingSpanInMonth,
    mateCandidate: boolean,
  ): boolean {
    if (!mateCandidate) return false;
    if (span.endExclusive <= span.start) return false;
    if (lane.lastSpan.checkoutDayInMonth !== span.start) return false;
    if (lane.lastSpan.endExclusive > span.start) return false;
    return lane.end === span.barStart + 1;
  }

  const sorted = [...items].sort((a, b) => {
    const A = bookingSpanInRange(a.startDate, a.endDate, spec);
    const B = bookingSpanInRange(b.startDate, b.endDate, spec);
    if (A.barStart !== B.barStart) return A.barStart - B.barStart;
    return A.layoutEndExclusive - B.layoutEndExclusive;
  });

  const lanes: LaneState[] = [];
  const out: Array<{ item: CalendarBookingItem; lane: number }> = [];

  for (const item of sorted) {
    const span = bookingSpanInRange(item.startDate, item.endDate, spec);
    const mateCandidate =
      isCheckinCutIn(item, span) &&
      hasPriorCheckoutOnFirstNightDayRange(items, item.id, spec, span.start);
    let lane = lanes.findIndex(
      (laneState) =>
        laneState.end <= span.barStart || canReuseMateLane(laneState, span, mateCandidate),
    );
    if (lane === -1) {
      lane = lanes.length;
      lanes.push({ end: span.layoutEndExclusive, lastSpan: span });
    } else {
      lanes[lane] = { end: span.layoutEndExclusive, lastSpan: span };
    }
    out.push({ item, lane });
  }
  return out;
}

/** Block nights: half-open [startDate, endDate) on calendar days. */
export function blockOccupiesColumn(
  col: number,
  roomId: string,
  blocks: import("./calendarTypes").CalendarBlockItem[],
  spec: MultiMonthRangeSpec,
): boolean {
  const iso = spec.columnToIso(col);
  for (const blk of blocks) {
    if (blk.roomId !== roomId) continue;
    const s = blk.startDate.slice(0, 10);
    const e = blk.endDate.slice(0, 10);
    if (iso >= s && iso < e) return true;
  }
  return false;
}

export function dayOccupiedByBookingRange(
  col: number,
  roomId: string,
  bookings: CalendarBookingItem[],
  spec: MultiMonthRangeSpec,
): boolean {
  for (const b of bookings) {
    if (b.roomId !== roomId) continue;
    const { start, endExclusive } = bookingSpanInRange(b.startDate, b.endDate, spec);
    if (col >= start && col < endExclusive) return true;
  }
  return false;
}

export function formatMultiMonthRangeTitle(months: string[]): string {
  if (months.length === 0) return "";
  if (months.length === 1) {
    const [yRaw, mRaw] = months[0]!.split("-");
    const y = Number(yRaw);
    const m = Number(mRaw);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return months[0]!;
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(y, m - 1, 1)),
    );
  }
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const fp = first.split("-").map(Number);
  const lp = last.split("-").map(Number);
  const fy = fp[0] ?? 1970;
  const fm = fp[1] ?? 1;
  const ly = lp[0] ?? 1970;
  const lm = lp[1] ?? 1;
  const startLabel = new Intl.DateTimeFormat("en", { month: "long" }).format(
    new Date(Date.UTC(fy, fm - 1, 1)),
  );
  const endLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(ly, lm - 1, 1)),
  );
  if (fy === ly) {
    return `${startLabel} – ${endLabel}`;
  }
  const startFull = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(fy, fm - 1, 1)),
  );
  return `${startFull} – ${endLabel}`;
}
