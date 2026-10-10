import { isoDate, type IsoDate } from "@stay-ops/domain";

const DEFAULT_TIME_ZONE = "Europe/Athens";

/** The business time zone (edge case E1-32). An unset or unknown zone falls back to Athens. */
export function appTimeZone(): string {
  const raw = process.env.APP_TIMEZONE?.trim();
  if (!raw) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Today's date in the business time zone, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date(), timeZone: string = appTimeZone()): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return isoDate(parts);
}

/** A Postgres DATE read by Prisma (UTC midnight) as `YYYY-MM-DD`. */
export function dbDateToIso(date: Date): IsoDate {
  return isoDate(date.toISOString().slice(0, 10));
}

/** `YYYY-MM-DD` as the UTC-midnight Date Prisma writes to a DATE column. */
export function isoToDbDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
