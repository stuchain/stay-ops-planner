import {
  invalidateCalendarMonthsAroundPivot,
  invalidateCalendarMonthsForUtcRange,
  resolveAppTimeZone,
} from "@stay-ops/shared/calendar-month-cache";
import { log } from "@/lib/logger";

function redisUrl(): string | undefined {
  return process.env.REDIS_URL?.trim();
}

/** Invalidate cached calendar months overlapping this stay (assignment or booking dates). */
export function fireInvalidateCalendarForBookingStay(checkin: Date, checkout: Date): void {
  const url = redisUrl();
  if (!url) return;
  const tz = resolveAppTimeZone();
  void invalidateCalendarMonthsForUtcRange(url, tz, checkin, checkout).catch((err: unknown) => {
    log("warn", "calendar_month_cache_invalidate_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Room sort / metadata changes affect all visible months — wide window around now. */
export function fireInvalidateCalendarWideForRoomMetadata(): void {
  const url = redisUrl();
  if (!url) return;
  const tz = resolveAppTimeZone();
  void invalidateCalendarMonthsAroundPivot(url, tz, new Date(), 24, 24).catch((err: unknown) => {
    log("warn", "calendar_month_cache_invalidate_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  });
}
