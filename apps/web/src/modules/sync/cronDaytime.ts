import { getLocalHourInTimeZone, resolveAppTimeZone } from "@stay-ops/shared/calendar-month-cache";

function parseHourEnv(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || n > 23) return fallback;
  return n;
}

/** Inclusive local hour range in APP_TIMEZONE (default 08–20 per ship path). */
export function resolveCronDaytimeHours(): { startHour: number; endHourInclusive: number } {
  return {
    startHour: parseHourEnv("SYNC_CRON_LOCAL_START_HOUR", 8),
    endHourInclusive: parseHourEnv("SYNC_CRON_LOCAL_END_HOUR", 20),
  };
}

export function isWithinHosthubCronDaytimeWindow(now: Date = new Date()): boolean {
  const tz = resolveAppTimeZone();
  const { startHour, endHourInclusive } = resolveCronDaytimeHours();
  const localHour = getLocalHourInTimeZone(now, tz);
  return localHour >= startHour && localHour <= endHourInclusive;
}
