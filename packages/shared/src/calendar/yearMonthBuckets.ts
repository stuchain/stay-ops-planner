/**
 * Derives `YYYY-MM` buckets in an IANA timezone for cache invalidation (Epic 12).
 * Must stay consistent with calendar month boundaries used by the web app (`zonedMonthRangeUtc`).
 */

export function resolveAppTimeZone(): string {
  const raw = typeof process !== "undefined" ? process.env?.APP_TIMEZONE : undefined;
  const t = typeof raw === "string" ? raw.trim() : "";
  return t.length > 0 ? t : "Etc/UTC";
}

export function formatYearMonthInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  let y = "";
  let mo = "";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    if (p.type === "month") mo = p.value;
  }
  return `${y}-${mo}`;
}

export function addCalendarMonth(yearMonth: string): string {
  const [ys, ms] = yearMonth.split("-");
  const y = parseInt(ys ?? "0", 10);
  const m = parseInt(ms ?? "0", 10);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function subtractCalendarMonth(yearMonth: string): string {
  const [ys, ms] = yearMonth.split("-");
  let y = parseInt(ys ?? "0", 10);
  let m = parseInt(ms ?? "0", 10);
  if (m === 1) {
    y -= 1;
    m = 12;
  } else {
    m -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function compareYearMonth(a: string, b: string): number {
  return a.localeCompare(b);
}

export function listYearMonthsInclusive(fromYm: string, toYm: string): string[] {
  let start = fromYm;
  let end = toYm;
  if (compareYearMonth(start, end) > 0) {
    const t = start;
    start = end;
    end = t;
  }
  const out: string[] = [];
  let cur = start;
  for (;;) {
    out.push(cur);
    if (cur === end) break;
    cur = addCalendarMonth(cur);
  }
  return out;
}

/** All `YYYY-MM` local months that overlap the UTC instant range `[fromUtc, toUtc]` (inclusive). */
export function yearMonthsOverlappingUtcRange(timeZone: string, fromUtc: Date, toUtc: Date): string[] {
  let a = fromUtc;
  let b = toUtc;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  const startYm = formatYearMonthInTimeZone(a, timeZone);
  const endYm = formatYearMonthInTimeZone(b, timeZone);
  return listYearMonthsInclusive(startYm, endYm);
}

/**
 * Months to invalidate when room ordering or other global calendar metadata changes.
 * `monthsBefore` / `monthsAfter` are applied relative to `pivot`'s local month.
 */
export function yearMonthsAroundPivot(
  timeZone: string,
  pivot: Date,
  monthsBefore: number,
  monthsAfter: number,
): string[] {
  let startYm = formatYearMonthInTimeZone(pivot, timeZone);
  for (let i = 0; i < monthsBefore; i += 1) {
    startYm = subtractCalendarMonth(startYm);
  }
  let endYm = formatYearMonthInTimeZone(pivot, timeZone);
  for (let i = 0; i < monthsAfter; i += 1) {
    endYm = addCalendarMonth(endYm);
  }
  return listYearMonthsInclusive(startYm, endYm);
}
