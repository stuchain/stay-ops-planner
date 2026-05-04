import { Redis } from "ioredis";
import { log } from "../log/log.js";
import { yearMonthsAroundPivot, yearMonthsOverlappingUtcRange } from "./yearMonthBuckets.js";
export {
  addCalendarMonth,
  formatYearMonthInTimeZone,
  listYearMonthsInclusive,
  resolveAppTimeZone,
  subtractCalendarMonth,
  yearMonthsAroundPivot,
  yearMonthsOverlappingUtcRange,
} from "./yearMonthBuckets.js";

const KEY_PREFIX = "cal:month:v1:";

const redisByUrl = new Map<string, Redis>();

function getRedis(redisUrl: string): Redis {
  let r = redisByUrl.get(redisUrl);
  if (!r) {
    r = new Redis(redisUrl, { maxRetriesPerRequest: 3, enableReadyCheck: true });
    redisByUrl.set(redisUrl, r);
  }
  return r;
}

function cacheKey(timeZone: string, yearMonth: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(timeZone)}:${yearMonth}`;
}

export function getCalendarMonthCacheTtlSeconds(): number {
  const raw = typeof process !== "undefined" ? process.env?.CALENDAR_MONTH_CACHE_TTL_SEC : undefined;
  const n = typeof raw === "string" ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (Number.isFinite(n) && n >= 10 && n <= 3600) return n;
  return 120;
}

export async function getCachedCalendarMonthJson(
  redisUrl: string | undefined,
  timeZone: string,
  yearMonth: string,
): Promise<string | null> {
  if (!redisUrl?.trim()) return null;
  try {
    const r = getRedis(redisUrl.trim());
    return await r.get(cacheKey(timeZone, yearMonth));
  } catch (e) {
    log("warn", "calendar_month_cache_get_failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export async function setCachedCalendarMonthJson(
  redisUrl: string | undefined,
  timeZone: string,
  yearMonth: string,
  json: string,
): Promise<void> {
  if (!redisUrl?.trim()) return;
  try {
    const r = getRedis(redisUrl.trim());
    const ttl = getCalendarMonthCacheTtlSeconds();
    await r.set(cacheKey(timeZone, yearMonth), json, "EX", ttl);
  } catch (e) {
    log("warn", "calendar_month_cache_set_failed", {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function invalidateCalendarMonthKeys(
  redisUrl: string | undefined,
  timeZone: string,
  yearMonths: readonly string[],
): Promise<void> {
  if (!redisUrl?.trim() || yearMonths.length === 0) return;
  try {
    const r = getRedis(redisUrl.trim());
    const keys = yearMonths.map((ym) => cacheKey(timeZone, ym));
    await r.del(...keys);
  } catch (e) {
    log("warn", "calendar_month_cache_invalidate_failed", {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function invalidateCalendarMonthsForUtcRange(
  redisUrl: string | undefined,
  timeZone: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<void> {
  const months = yearMonthsOverlappingUtcRange(timeZone, fromUtc, toUtc);
  await invalidateCalendarMonthKeys(redisUrl, timeZone, months);
}

export async function invalidateCalendarMonthsAroundPivot(
  redisUrl: string | undefined,
  timeZone: string,
  pivot: Date,
  monthsBefore: number,
  monthsAfter: number,
): Promise<void> {
  const months = yearMonthsAroundPivot(timeZone, pivot, monthsBefore, monthsAfter);
  await invalidateCalendarMonthKeys(redisUrl, timeZone, months);
}

/** Import-error markers: invalidate the local month for `when` (typically `new Date()`). */
export async function invalidateCalendarForImportErrorInstant(
  redisUrl: string | undefined,
  timeZone: string,
  when: Date,
): Promise<void> {
  await invalidateCalendarMonthsForUtcRange(redisUrl, timeZone, when, when);
}
