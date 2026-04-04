import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HosthubClient } from "./client.js";

const validPage = {
  data: [
    {
      reservationId: "r1",
      listingId: "l1",
      status: "confirmed" as const,
      checkIn: "2026-05-01",
      checkOut: "2026-05-04",
    },
  ],
  nextCursor: null,
};

function client(fetchFn: typeof fetch) {
  return new HosthubClient({
    baseUrl: "https://example.test/api",
    apiToken: "test-token",
    fetchFn,
    maxRetries: 3,
    timeoutMs: 5000,
  });
}

describe("HosthubClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps 401 to HOSTHUB_AUTH_FAILED without retry", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), { status: 401, statusText: "Unauthorized" }),
    );
    const c = client(fetchFn);
    const result = await c.listReservationsUpdatedSince({ cursor: null });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("HOSTHUB_AUTH_FAILED");
    }
  });

  it("retries 500 then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 502, statusText: "Bad Gateway" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validPage), { status: 200, statusText: "OK" }),
      );
    const c = client(fetchFn);
    const p = c.listReservationsUpdatedSince({ cursor: null });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await p;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toHaveLength(1);
    }
  });

  it("retries 429 respecting Retry-After when present", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 429,
          statusText: "Too Many",
          headers: { "Retry-After": "1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validPage), { status: 200, statusText: "OK" }),
      );
    const c = client(fetchFn);
    const p = c.listReservationsUpdatedSince({ cursor: null });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await p;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("returns HOSTHUB_PARSE_ERROR for invalid JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }));
    const c = client(fetchFn);
    const result = await c.listReservationsUpdatedSince({ cursor: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("HOSTHUB_PARSE_ERROR");
    }
  });

  it("returns HOSTHUB_PARSE_ERROR for JSON that fails schema", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: "wrong" }), { status: 200 }),
    );
    const c = client(fetchFn);
    const result = await c.listReservationsUpdatedSince({ cursor: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("HOSTHUB_PARSE_ERROR");
    }
  });

  it("sends User-Agent and Bearer token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validPage), { status: 200 }),
    );
    const c = client(fetchFn);
    await c.listReservationsUpdatedSince({ cursor: null });
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("stay-ops-planner-sync");
  });
});
