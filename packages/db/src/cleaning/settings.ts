/**
 * Cleaning settings in one place: the clock the business runs on and the default stay times.
 * Everything that turns a calendar day into a moment (cleaning windows, the cleaner's day list) reads these.
 */

export const DEFAULT_TIME_ZONE = "Europe/Athens";

/** The time a guest leaves when nothing else is known (local, `HH:MM`). */
export const DEFAULT_CHECKOUT_TIME = "11:00";

/** The time the next guest arrives when nothing else is known (local, `HH:MM`). */
export const DEFAULT_CHECKIN_TIME = "15:00";

/** The business time zone (`APP_TIMEZONE`); an unset or unknown zone falls back to Athens. */
export function businessTimeZone(): string {
  const raw = process.env.APP_TIMEZONE?.trim();
  if (!raw) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant: local wall clock minus UTC. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads `day` (`YYYY-MM-DD`) at `time` (`HH:MM`).
 * Correct across the summer/winter clock change: a time that does not exist (spring forward) moves
 * forward by the gap, and one that happens twice (autumn) is the first occurrence.
 */
export function zonedTimeToUtc(day: string, time: string, timeZone: string = businessTimeZone()): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  const first = wall - zoneOffsetMs(wall, timeZone);
  const second = wall - zoneOffsetMs(first, timeZone);
  if (second === first) return new Date(first);
  // Near a change the offset at the first guess differs; the earlier of the two valid readings wins.
  const third = wall - zoneOffsetMs(second, timeZone);
  return new Date(third === second ? second : Math.min(first, second));
}

/** The calendar day (`YYYY-MM-DD`) an instant falls on in `timeZone`. */
export function utcToZonedDay(instant: Date, timeZone: string = businessTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** A Postgres DATE read by Prisma (UTC midnight) as `YYYY-MM-DD`. */
export function dateOnlyToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
