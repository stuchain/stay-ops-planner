import { addDays, daysBetween, isoDate, type IsoDate } from "@stay-ops/domain";

/** Day column width per zoom level (tokens.size.dayWidth). */
export const DAY_WIDTH = { week: 132, month: 44 } as const;
export type Zoom = keyof typeof DAY_WIDTH;

/** Data loads in blocks of this many months; the blocks near the visible part are fetched. */
export const BLOCK_MONTHS = 3;
const MONTHS_BEFORE = 24;
const MONTHS_AFTER = 18;

export function monthStart(date: IsoDate): IsoDate {
  return isoDate(`${date.slice(0, 7)}-01`);
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return isoDate(`${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`);
}

/** The scrollable span: 2 years back (past stays stay visible) to 18 months ahead of this month. */
export type Span = { origin: IsoDate; end: IsoDate; days: number; blocks: { from: IsoDate; to: IsoDate }[] };

export function spanAround(today: IsoDate): Span {
  const origin = addMonths(monthStart(today), -MONTHS_BEFORE);
  const end = addMonths(monthStart(today), MONTHS_AFTER);
  const blocks: { from: IsoDate; to: IsoDate }[] = [];
  for (let m = 0; m < MONTHS_BEFORE + MONTHS_AFTER; m += BLOCK_MONTHS) {
    blocks.push({ from: addMonths(origin, m), to: addMonths(origin, m + BLOCK_MONTHS) });
  }
  return { origin, end, days: daysBetween(origin, end), blocks };
}

export function dayIndex(span: Span, date: IsoDate): number {
  return daysBetween(span.origin, date);
}

export function dateAt(span: Span, index: number): IsoDate {
  return addDays(span.origin, index);
}

/** Blocks overlapping the visible days, plus one either side so scrolling finds data ready. */
export function blocksToLoad(span: Span, firstDay: number, lastDay: number): number[] {
  const out: number[] = [];
  span.blocks.forEach((block, i) => {
    const from = dayIndex(span, block.from);
    const to = dayIndex(span, block.to);
    if (to > firstDay - 31 && from < lastDay + 31) out.push(i);
  });
  return out;
}

/** Months in `[first, last]` days, for the sticky month labels. */
export function monthsBetween(
  span: Span,
  firstDay: number,
  lastDay: number,
): { start: IsoDate; startDay: number; endDay: number }[] {
  const out: { start: IsoDate; startDay: number; endDay: number }[] = [];
  let start = monthStart(dateAt(span, Math.max(0, firstDay)));
  while (dayIndex(span, start) <= lastDay && dayIndex(span, start) < span.days) {
    const next = addMonths(start, 1);
    out.push({ start, startDay: dayIndex(span, start), endDay: Math.min(dayIndex(span, next), span.days) });
    start = next;
  }
  return out;
}

/** Drawn days move in steps of this many days, so scrolling redraws the grid only now and then. */
export const DRAW_STEP_DAYS = 14;
/** Days drawn beyond each edge of the screen, so a quick scroll never shows an empty edge. */
export const DRAW_OVERSCAN_DAYS = 42;

/**
 * The day columns to draw for a scroll position: what is on screen, rounded out to whole steps, plus the overscan.
 * The answer only changes every `DRAW_STEP_DAYS`, which keeps scrolling smooth.
 */
export function drawnDays(
  scrollLeft: number,
  viewWidth: number,
  dayWidth: number,
  labelWidth: number,
): { firstDay: number; lastDay: number } {
  const firstVisible = Math.floor(scrollLeft / dayWidth);
  const lastVisible = Math.ceil((scrollLeft + Math.max(0, viewWidth - labelWidth)) / dayWidth);
  return {
    firstDay: Math.floor(firstVisible / DRAW_STEP_DAYS) * DRAW_STEP_DAYS - DRAW_OVERSCAN_DAYS,
    lastDay: Math.ceil(lastVisible / DRAW_STEP_DAYS) * DRAW_STEP_DAYS + DRAW_OVERSCAN_DAYS,
  };
}

export type DrawnDays = { firstDay: number; lastDay: number };

/**
 * The drawn days, kept outside React state: the grid subscribes to it, so a new step redraws only the grid
 * (not the whole screen, whose drag-and-drop context would redraw every booking bar).
 */
export type DrawnDaysStore = {
  get: () => DrawnDays;
  set: (next: DrawnDays) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createDrawnDaysStore(initial: DrawnDays): DrawnDaysStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next.firstDay === value.firstDay && next.lastDay === value.lastDay) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
