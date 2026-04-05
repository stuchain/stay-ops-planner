/**
 * Calendar month window in an IANA timezone, expressed as UTC instants for DB queries.
 * monthStartUtc: first local midnight of the month; monthEndExclusiveUtc: first local midnight of the next month.
 */

function calendarKey(utcMs: number, timeZone: string): number {
  const d = new Date(utcMs);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const s = fmt.format(d);
  const parts = s.split("-").map((x) => parseInt(x, 10));
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const day = parts[2] ?? 0;
  return y * 10_000 + m * 100 + day;
}

function startOfLocalCalendarDay(year: number, month: number, day: number, timeZone: string): Date {
  const target = year * 10_000 + month * 100 + day;
  let lo = Date.UTC(year, month - 1, day - 2, 12, 0, 0);
  let hi = Date.UTC(year, month - 1, day + 2, 12, 0, 0);
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (calendarKey(mid, timeZone) < target) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo);
}

export function parseYearMonthParam(yearMonth: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!m?.[1] || !m[2]) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function zonedMonthRangeUtc(
  yearMonth: string,
  timeZone: string,
): { monthStartUtc: Date; monthEndExclusiveUtc: Date } {
  const parsed = parseYearMonthParam(yearMonth);
  if (!parsed) {
    throw new Error("INVALID_MONTH");
  }
  const { year, month } = parsed;
  const monthStartUtc = startOfLocalCalendarDay(year, month, 1, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const monthEndExclusiveUtc = startOfLocalCalendarDay(nextYear, nextMonth, 1, timeZone);
  return { monthStartUtc, monthEndExclusiveUtc };
}
