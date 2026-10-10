/**
 * Pure decision logic for sync health alerts (P2-8). No I/O: give it the sync state, the latest
 * runs and "now", get back the problems that should be reported.
 */

export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
export const CONSECUTIVE_FAILURES = 2;
export const ALERT_TIME_ZONE = "Europe/Athens";
export const DAYTIME_START_HOUR = 8;
/** Exclusive: 22:00 is already night. */
export const DAYTIME_END_HOUR = 22;

export type SyncProblemKey = "sync_stale" | "sync_failing";

export type SyncProblem = { key: SyncProblemKey; detail: string };

export type SyncRunSummary = {
  startedAt: Date;
  /** `completed`, `failed`, or null/other while a run is still going. */
  status: string | null;
};

export type SyncHealthInput = {
  now: Date;
  lastSuccessAt: Date | null;
  /** Newest first. */
  recentRuns: SyncRunSummary[];
};

/** Local hour (0-23) in Athens. */
export function athensHour(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ALERT_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export function isAthensDaytime(now: Date): boolean {
  const h = athensHour(now);
  return h >= DAYTIME_START_HOUR && h < DAYTIME_END_HOUR;
}

/** True when the newest finished runs (ignoring one still running) are `CONSECUTIVE_FAILURES` failures. */
export function hasConsecutiveFailures(recentRuns: SyncRunSummary[]): boolean {
  const finished = recentRuns.filter((r) => r.status === "completed" || r.status === "failed");
  if (finished.length < CONSECUTIVE_FAILURES) return false;
  return finished.slice(0, CONSECUTIVE_FAILURES).every((r) => r.status === "failed");
}

export function evaluateSyncHealth(input: SyncHealthInput): SyncProblem[] {
  const problems: SyncProblem[] = [];

  if (hasConsecutiveFailures(input.recentRuns)) {
    problems.push({
      key: "sync_failing",
      detail: `The last ${CONSECUTIVE_FAILURES} Hosthub syncs failed.`,
    });
  }

  if (isAthensDaytime(input.now)) {
    const last = input.lastSuccessAt;
    if (last === null) {
      // Never synced: only a problem once there has been an attempt, otherwise a fresh install would alert.
      if (input.recentRuns.length > 0) {
        problems.push({ key: "sync_stale", detail: "Hosthub has never synced successfully." });
      }
    } else if (input.now.getTime() - last.getTime() > STALE_AFTER_MS) {
      const hours = Math.floor((input.now.getTime() - last.getTime()) / (60 * 60 * 1000));
      problems.push({
        key: "sync_stale",
        detail: `The last successful Hosthub sync was ${hours} hours ago (at ${last.toISOString()}).`,
      });
    }
  }

  return problems;
}
