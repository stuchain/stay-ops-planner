import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { CalendarClient } from "@/modules/calendar/CalendarClient";
import type { CalendarMonthPayload } from "@/modules/calendar/calendarTypes";

type Deferred = { resolve: (payload: CalendarMonthPayload) => void };

function monthWithBookingIn(roomId: string): CalendarMonthPayload {
  return {
    month: "2026-07",
    timezone: "Etc/UTC",
    rooms: [
      { id: "onar", code: "Onar", name: null, isActive: true, maxGuests: null },
      { id: "cosmos", code: "Cosmos", name: null, isActive: true, maxGuests: null },
    ],
    items: [
      {
        kind: "booking",
        id: "b1",
        roomId,
        startDate: "2026-07-05",
        endDate: "2026-07-08",
        guestName: "Guest One",
        guestTotal: 2,
        guestAdults: null,
        guestChildren: null,
        guestInfants: null,
        channel: "airbnb",
        status: "confirmed",
        assignmentId: "asg_b1",
        assignmentVersion: 1,
        flags: [],
      },
    ],
    markers: [],
    dailyRatesByRoomDay: {},
  };
}

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("CalendarClient loads", () => {
  let monthRequests: Deferred[];

  beforeEach(() => {
    monthRequests = [];
    window.localStorage.setItem("ops.calendar.month", "2026-07");
    window.localStorage.setItem("ops.calendar.displayMonths", "1");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/calendar/month")) {
          // Answers arrive only when the test says so, and ignore abort on purpose:
          // the screen itself must drop answers that are no longer the latest.
          return new Promise<Response>((resolve) => {
            monthRequests.push({ resolve: (payload) => resolve(json(payload)) });
          });
        }
        if (url.startsWith("/api/bookings/overview")) {
          return json({ rooms: [], unassigned: [] });
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  function laneOf(bookingId: string): string | null {
    const card = screen.getByTestId(`ops-booking-card-${bookingId}`);
    return card.closest("[data-testid^='ops-room-lane-']")?.getAttribute("data-testid") ?? null;
  }

  it("keeps the newer answer when two refreshes resolve in reverse order", async () => {
    render(
      <I18nProvider>
        <CalendarClient />
      </I18nProvider>,
    );
    await waitFor(() => expect(monthRequests).toHaveLength(1));
    await act(async () => monthRequests[0]!.resolve(monthWithBookingIn("onar")));
    await waitFor(() => expect(laneOf("b1")).toBe("ops-room-lane-Onar"));

    act(() => {
      window.dispatchEvent(new CustomEvent("ops:hosthub-sync-tick"));
    });
    await waitFor(() => expect(monthRequests).toHaveLength(2));
    act(() => {
      window.dispatchEvent(new CustomEvent("ops:hosthub-sync-tick"));
    });
    await waitFor(() => expect(monthRequests).toHaveLength(3));

    // The newer refresh answers first, then the older one arrives late.
    await act(async () => monthRequests[2]!.resolve(monthWithBookingIn("cosmos")));
    await waitFor(() => expect(laneOf("b1")).toBe("ops-room-lane-Cosmos"));
    await act(async () => monthRequests[1]!.resolve(monthWithBookingIn("onar")));

    expect(laneOf("b1")).toBe("ops-room-lane-Cosmos");
  });

  it("keeps the calendar on screen while it refreshes", async () => {
    render(
      <I18nProvider>
        <CalendarClient />
      </I18nProvider>,
    );
    await waitFor(() => expect(monthRequests).toHaveLength(1));
    await act(async () => monthRequests[0]!.resolve(monthWithBookingIn("onar")));
    await waitFor(() => expect(screen.getByTestId("ops-booking-card-b1")).toBeInTheDocument());

    act(() => {
      window.dispatchEvent(new CustomEvent("ops:hosthub-sync-tick"));
    });
    await waitFor(() => expect(monthRequests).toHaveLength(2));

    expect(screen.getByTestId("ops-booking-card-b1")).toBeInTheDocument();
    expect(screen.getByText("Updating…")).toBeInTheDocument();
  });
});
