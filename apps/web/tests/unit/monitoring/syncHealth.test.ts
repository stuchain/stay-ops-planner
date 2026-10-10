import { describe, expect, it } from "vitest";
import {
  athensHour,
  evaluateSyncHealth,
  hasConsecutiveFailures,
  isAthensDaytime,
  type SyncRunSummary,
} from "../../../src/server/monitoring/syncHealth";

// Athens is UTC+3 in summer (EEST) and UTC+2 in winter (EET).
const noon = new Date("2026-07-15T09:00:00Z"); // 12:00 Athens
const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000);
const run = (status: string | null, minsAgo = 0): SyncRunSummary => ({
  status,
  startedAt: new Date(noon.getTime() - minsAgo * 60_000),
});

describe("athens daytime", () => {
  it("uses Athens local time, summer and winter", () => {
    expect(athensHour(new Date("2026-07-15T05:00:00Z"))).toBe(8);
    expect(athensHour(new Date("2026-01-15T06:00:00Z"))).toBe(8);
  });
  it("is daytime from 08:00 up to but excluding 22:00", () => {
    expect(isAthensDaytime(new Date("2026-07-15T04:59:00Z"))).toBe(false); // 07:59
    expect(isAthensDaytime(new Date("2026-07-15T05:00:00Z"))).toBe(true); // 08:00
    expect(isAthensDaytime(new Date("2026-07-15T18:59:00Z"))).toBe(true); // 21:59
    expect(isAthensDaytime(new Date("2026-07-15T19:00:00Z"))).toBe(false); // 22:00
  });
});

describe("hasConsecutiveFailures", () => {
  it("needs two failures in a row", () => {
    expect(hasConsecutiveFailures([run("failed"), run("failed")])).toBe(true);
    expect(hasConsecutiveFailures([run("failed"), run("completed")])).toBe(false);
    expect(hasConsecutiveFailures([run("completed"), run("failed"), run("failed")])).toBe(false);
    expect(hasConsecutiveFailures([run("failed")])).toBe(false);
    expect(hasConsecutiveFailures([])).toBe(false);
  });
  it("ignores a run that is still going", () => {
    expect(hasConsecutiveFailures([run(null), run("failed"), run("failed")])).toBe(true);
    expect(hasConsecutiveFailures([run(null), run("failed"), run("completed")])).toBe(false);
  });
});

describe("evaluateSyncHealth", () => {
  it("is fine when the last success is recent", () => {
    expect(
      evaluateSyncHealth({ now: noon, lastSuccessAt: hoursAgo(noon, 1), recentRuns: [run("completed")] }),
    ).toEqual([]);
  });

  it("exactly 3 hours old is not yet stale, just over is", () => {
    expect(evaluateSyncHealth({ now: noon, lastSuccessAt: hoursAgo(noon, 3), recentRuns: [] })).toEqual([]);
    const over = new Date(hoursAgo(noon, 3).getTime() - 1);
    const problems = evaluateSyncHealth({ now: noon, lastSuccessAt: over, recentRuns: [] });
    expect(problems.map((p) => p.key)).toEqual(["sync_stale"]);
  });

  it("does not flag staleness at night", () => {
    const night = new Date("2026-07-15T00:30:00Z"); // 03:30 Athens
    expect(
      evaluateSyncHealth({ now: night, lastSuccessAt: hoursAgo(night, 9), recentRuns: [run("completed")] }),
    ).toEqual([]);
  });

  it("flags two failed runs even at night", () => {
    const night = new Date("2026-07-15T00:30:00Z");
    const problems = evaluateSyncHealth({
      now: night,
      lastSuccessAt: hoursAgo(night, 1),
      recentRuns: [run("failed"), run("failed", 30)],
    });
    expect(problems.map((p) => p.key)).toEqual(["sync_failing"]);
  });

  it("reports both problems together", () => {
    const problems = evaluateSyncHealth({
      now: noon,
      lastSuccessAt: hoursAgo(noon, 5),
      recentRuns: [run("failed"), run("failed", 60)],
    });
    expect(problems.map((p) => p.key).sort()).toEqual(["sync_failing", "sync_stale"]);
  });

  it("a fresh install that never tried to sync does not alert; one that tried and never succeeded does", () => {
    expect(evaluateSyncHealth({ now: noon, lastSuccessAt: null, recentRuns: [] })).toEqual([]);
    const problems = evaluateSyncHealth({ now: noon, lastSuccessAt: null, recentRuns: [run("failed")] });
    expect(problems.map((p) => p.key)).toEqual(["sync_stale"]);
  });
});
