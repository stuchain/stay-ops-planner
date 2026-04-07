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
  nextPageUrl: null as string | null,
  skipped: 0,
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
    const result = await c.listCalendarEventsPage({ nextPageUrl: null });
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
    const p = c.listCalendarEventsPage({ nextPageUrl: null });
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
    const p = c.listCalendarEventsPage({ nextPageUrl: null });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await p;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("returns HOSTHUB_PARSE_ERROR for invalid JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }));
    const c = client(fetchFn);
    const result = await c.listCalendarEventsPage({ nextPageUrl: null });
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
    const result = await c.listCalendarEventsPage({ nextPageUrl: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("HOSTHUB_PARSE_ERROR");
    }
  });

  it("sends User-Agent and raw API key (no Bearer prefix)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validPage), { status: 200 }),
    );
    const c = client(fetchFn);
    await c.listCalendarEventsPage({ nextPageUrl: null });
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "test-token",
    });
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("stay-ops-planner-sync");
  });

  it("first page uses /calendar-events and optional updated_gte", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validPage), { status: 200 }),
    );
    const c = client(fetchFn);
    await c.listCalendarEventsPage({ nextPageUrl: null, updatedGte: 1712345678 });
    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toBe("https://example.test/api/calendar-events?updated_gte=1712345678");
  });

  it("follows navigation.next URL verbatim on second request", async () => {
    const nextUrl = "https://example.test/api/calendar-events?cursor_gt=abc";
    const page1 = {
      object: "CalendarEvent",
      data: [],
      navigation: { next: nextUrl, previous: null },
    };
    const page2 = {
      data: [
        {
          id: "r1",
          rental_id: "l1",
          type: "Booking",
          date_from: "2026-05-01",
          date_to: "2026-05-04",
        },
      ],
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
    const c = client(fetchFn);
    const first = await c.listCalendarEventsPage({ nextPageUrl: null });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.nextPageUrl).toBe(nextUrl);
    await c.listCalendarEventsPage({ nextPageUrl: nextUrl });
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe(nextUrl);
  });

  it("resolves root-relative next path under API base prefix", async () => {
    const page1 = {
      data: [],
      navigation: { next: "/calendar-events?cursor_gt=abc", previous: null },
    };
    const page2 = {
      data: [
        {
          id: "r1",
          rental_id: "l1",
          type: "Booking",
          date_from: "2026-05-01",
          date_to: "2026-05-04",
        },
      ],
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
    const c = client(fetchFn);
    const first = await c.listCalendarEventsPage({ nextPageUrl: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await c.listCalendarEventsPage({ nextPageUrl: first.value.nextPageUrl });
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe("https://example.test/api/calendar-events?cursor_gt=abc");
  });

  it("keeps API-prefixed root-relative next path intact", async () => {
    const page1 = {
      data: [],
      navigation: { next: "/api/2019-03-01/calendar-events?cursor_gt=abc", previous: null },
    };
    const page2 = {
      data: [
        {
          id: "r1",
          rental_id: "l1",
          type: "Booking",
          date_from: "2026-05-01",
          date_to: "2026-05-04",
        },
      ],
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
    const c = client(fetchFn);
    const first = await c.listCalendarEventsPage({ nextPageUrl: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await c.listCalendarEventsPage({ nextPageUrl: first.value.nextPageUrl });
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe(
      "https://example.test/api/2019-03-01/calendar-events?cursor_gt=abc",
    );
  });

  it("supports query-only next values", async () => {
    const page1 = {
      data: [],
      navigation: { next: "?cursor_gt=abc", previous: null },
    };
    const page2 = {
      data: [
        {
          id: "r1",
          rental_id: "l1",
          type: "Booking",
          date_from: "2026-05-01",
          date_to: "2026-05-04",
        },
      ],
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
    const c = client(fetchFn);
    const first = await c.listCalendarEventsPage({ nextPageUrl: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await c.listCalendarEventsPage({ nextPageUrl: first.value.nextPageUrl });
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe("https://example.test/api/calendar-events?cursor_gt=abc");
  });

  it("accepts reservations[] with snake_case rows (Hosthub-style list payloads)", async () => {
    const altPage = {
      reservations: [
        {
          id: "rX",
          rental_id: "lX",
          status: "confirmed",
          check_in: "2026-05-01",
          check_out: "2026-05-04",
        },
      ],
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(altPage), { status: 200 }));
    const c = client(fetchFn);
    const result = await c.listCalendarEventsPage({ nextPageUrl: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toHaveLength(1);
      expect(result.value.data[0]?.reservationId).toBe("rX");
      expect(result.value.data[0]?.listingId).toBe("lX");
    }
  });

  it("uses listReservationsPath for the first-page request URL", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validPage), { status: 200 }),
    );
    const c = new HosthubClient({
      baseUrl: "https://example.test/api",
      apiToken: "test-token",
      fetchFn,
      listReservationsPath: "/bookings",
    });
    await c.listCalendarEventsPage({ nextPageUrl: null });
    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toContain("/bookings");
  });
});
