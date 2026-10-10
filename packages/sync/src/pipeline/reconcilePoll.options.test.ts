import { afterEach, describe, expect, it, vi } from "vitest";
import { nextPollCursor, resolveCalendarListOptions } from "./reconcilePoll.js";

describe("resolveCalendarListOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks Hosthub for every event, cancelled and hidden ones included, when nothing is set", () => {
    vi.stubEnv("HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE", "");
    expect(resolveCalendarListOptions().isVisible).toBe("all");
  });

  it("still lets the env var override the default", () => {
    vi.stubEnv("HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE", "true");
    expect(resolveCalendarListOptions().isVisible).toBe("true");
  });
});

describe("nextPollCursor", () => {
  const base = { previous: "100", runMaxUpdated: 300, failedMinUpdated: undefined, failedWithoutUpdated: false };

  it("advances to the newest row when nothing failed", () => {
    expect(nextPollCursor(base)).toBe("300");
  });

  it("stops at the oldest failed row so the next run fetches it again", () => {
    expect(nextPollCursor({ ...base, failedMinUpdated: 150 })).toBe("150");
  });

  it("keeps the old cursor when a failed row has no updated time", () => {
    expect(nextPollCursor({ ...base, failedMinUpdated: 150, failedWithoutUpdated: true })).toBe("100");
  });

  it("keeps the old cursor when the run saw no rows", () => {
    expect(nextPollCursor({ ...base, runMaxUpdated: undefined })).toBe("100");
  });
});
