/**
 * Sentry hooks on API error helper (Epic 2).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: (...args: unknown[]) => void; setUser: (...args: unknown[]) => void }) => void) => {
    fn({ setTag: vi.fn(), setUser: vi.fn() });
  },
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { apiError } from "@/lib/apiError";

describe("apiError + Sentry", () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureMessage).mockClear();
    vi.mocked(Sentry.captureException).mockClear();
  });

  it("sends captureMessage for 5xx without cause", () => {
    const req = new NextRequest("http://localhost/api/x", { headers: new Headers() });
    const res = apiError(req, "INTERNAL_ERROR", "boom", 500);
    expect(res.status).toBe(500);
    expect(Sentry.captureMessage).toHaveBeenCalledWith("INTERNAL_ERROR: boom", "error");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("sends captureException for 5xx with cause", () => {
    const req = new NextRequest("http://localhost/api/x", { headers: new Headers() });
    const cause = new Error("db down");
    apiError(req, "INTERNAL_ERROR", "boom", 500, undefined, { route: "/api/x", method: "GET" }, cause);
    expect(Sentry.captureException).toHaveBeenCalledWith(cause);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("does not capture for 4xx", () => {
    const req = new NextRequest("http://localhost/api/x", { headers: new Headers() });
    apiError(req, "VALIDATION_ERROR", "bad", 400);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
