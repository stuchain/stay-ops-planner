/**
 * Prints calendar month UTC bounds and EXPLAIN templates for Epic 12 baseline.
 *
 * Usage (repo root):
 *   node ./packages/db/scripts/explain-calendar-baseline.mjs 2026-03 Etc/UTC
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
config({ path: resolve(repoRoot, ".env.hosthub.local") });
config({ path: resolve(repoRoot, ".env") });

const yearMonth = process.argv[2] ?? "2026-03";
const timeZone = process.argv[3] ?? (process.env.APP_TIMEZONE?.trim() || "Etc/UTC");

const m = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
if (!m?.[1] || !m[2]) {
  console.error("Usage: node ./packages/db/scripts/explain-calendar-baseline.mjs YYYY-MM [IANA_timezone]");
  process.exit(1);
}

function calendarKey(utcMs, tz) {
  const d = new Date(utcMs);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const s = fmt.format(d);
  const parts = s.split("-").map((x) => parseInt(x, 10));
  const y = parts[0] ?? 0;
  const mo = parts[1] ?? 0;
  const day = parts[2] ?? 0;
  return y * 10_000 + mo * 100 + day;
}

function startOfLocalCalendarDay(year, month, day, tz) {
  const target = year * 10_000 + month * 100 + day;
  let lo = Date.UTC(year, month - 1, day - 2, 12, 0, 0);
  let hi = Date.UTC(year, month - 1, day + 2, 12, 0, 0);
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (calendarKey(mid, tz) < target) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo);
}

const year = parseInt(m[1], 10);
const month = parseInt(m[2], 10);
if (month < 1 || month > 12) {
  console.error("Invalid month");
  process.exit(1);
}

const monthStartUtc = startOfLocalCalendarDay(year, month, 1, timeZone);
const nextYear = month === 12 ? year + 1 : year;
const nextMonth = month === 12 ? 1 : month + 1;
const monthEndExclusiveUtc = startOfLocalCalendarDay(nextYear, nextMonth, 1, timeZone);

const isoDate = (d) => d.toISOString().slice(0, 10);

const monthStart = isoDate(monthStartUtc);
const monthEndEx = isoDate(monthEndExclusiveUtc);

console.log(
  JSON.stringify(
    {
      yearMonth,
      timeZone,
      monthStartUtc: monthStartUtc.toISOString(),
      monthEndExclusiveUtc: monthEndExclusiveUtc.toISOString(),
      monthStartDateForSql: monthStart,
      monthEndExclusiveDateForSql: monthEndEx,
      explainBookings: `EXPLAIN (ANALYZE, BUFFERS)
SELECT b.id
FROM bookings b
WHERE b.checkin_date < '${monthEndEx}'::date
  AND b.checkout_date > '${monthStart}'::date
  AND b.status <> 'cancelled'::"BookingStatus";`,
      explainManualBlocks: `EXPLAIN (ANALYZE, BUFFERS)
SELECT mb.id
FROM manual_blocks mb
WHERE mb.start_date < '${monthEndEx}'::date
  AND mb.end_date >= '${monthStart}'::date;`,
    },
    null,
    2,
  ),
);
