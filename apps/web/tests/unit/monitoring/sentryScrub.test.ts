import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubSentryEvent, scrubText, scrubUrl } from "../../../sentry.common";

describe("Sentry scrubbing", () => {
  it("drops query strings and path tokens from URLs", () => {
    expect(scrubUrl("https://x.app/app/search?q=6912345678")).toBe("https://x.app/app/search?[filtered]");
    expect(scrubUrl("/feed/abc123def.ics")).toBe("/feed/[token]");
    expect(scrubUrl("GET /c/v1.abc.def")).toBe("GET /c/[token]");
    expect(scrubUrl("/app/calendar")).toBe("/app/calendar");
  });

  it("masks phones and e-mails in free text", () => {
    expect(scrubText("no guest +30 691 234 5678 or maria@example.com")).toBe("no guest [phone] or [email]");
  });

  it("scrubs request, exception, breadcrumbs and spans", () => {
    const event = scrubSentryEvent({
      transaction: "GET /api/trpc/booking.search?input=%7B%22text%22%3A%22Maria%22%7D",
      request: {
        url: "https://x.app/feed/secret.ics",
        query_string: "q=Maria",
        cookies: { stayops_session: "x" },
        headers: { Referer: "https://x.app/app/search?q=Maria" },
      },
      exception: { values: [{ value: "Booking for maria@example.com failed" }] },
      breadcrumbs: [{ message: "fetch /api/trpc/booking.search?input=Maria", data: { url: "/app/search?q=Maria" } }],
      spans: [{ description: "GET /c/token123", data: { "http.query": "?q=Maria" } }],
      extra: { guestPhone: "6912345678" },
    });
    expect(event.transaction).toBe("GET /api/trpc/booking.search?[filtered]");
    expect(event.request?.url).toBe("https://x.app/feed/[token]");
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers?.Referer).toBe("https://x.app/app/search?[filtered]");
    expect(event.exception?.values?.[0]?.value).toBe("Booking for [email] failed");
    expect(event.breadcrumbs?.[0]?.message).toBe("fetch /api/trpc/booking.search?[filtered]");
    expect(event.breadcrumbs?.[0]?.data?.url).toBe("/app/search?[filtered]");
    expect(event.spans?.[0]?.description).toBe("GET /c/[token]");
    expect(event.spans?.[0]?.data?.["http.query"]).toBe("?[filtered]");
    expect(event.extra?.guestPhone).toBe("[REDACTED]");
  });

  it("leaves a plain breadcrumb readable", () => {
    expect(scrubBreadcrumb({ message: "Navigated to /app/today" }).message).toBe("Navigated to /app/today");
  });
});
