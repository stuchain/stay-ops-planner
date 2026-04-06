import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnassignedDrawer } from "@/modules/bookings/UnassignedDrawer";
import {
  applyBookingSuggestionMutation,
  performBookingAssignmentMutation,
} from "@/modules/calendar/assignmentMutations";

vi.mock("@/modules/calendar/assignmentMutations", () => ({
  performBookingAssignmentMutation: vi.fn().mockResolvedValue(undefined),
  applyBookingSuggestionMutation: vi.fn().mockResolvedValue(undefined),
}));

describe("UnassignedDrawer", () => {
  const rooms = [{ id: "r1", code: "R1", name: null, isActive: true }];

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/bookings/unassigned")) {
        return new Response(
          JSON.stringify({
            data: {
              bookings: [
                {
                  id: "b1",
                  channel: "direct",
                  externalBookingId: "keep-me",
                  checkinDate: "2026-07-01",
                  checkoutDate: "2026-07-05",
                  nights: 4,
                },
                {
                  id: "b2",
                  channel: "direct",
                  externalBookingId: "filter-me-out",
                  checkinDate: "2026-07-06",
                  checkoutDate: "2026-07-08",
                  nights: 2,
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/bookings/b1/suggestions")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                roomId: "r1",
                score: 90,
                reasonCodes: ["ROOM_AVAILABLE", "CLEANING_WINDOW_FITS"],
                breakdown: { availability: 60, cleaningFit: 30, tieBreaker: 0 },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/bookings/b2/suggestions")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads rows and filters list after debounced search", async () => {
    const user = userEvent.setup();
    render(
      <UnassignedDrawer
        open
        month="2026-07"
        rooms={rooms}
        onClose={vi.fn()}
        onAssigned={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(screen.getByText(/keep-me/)).toBeInTheDocument();
    expect(screen.getByText(/filter-me-out/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Id, channel, external ref/i), "keep");
    await waitFor(() => expect(screen.queryByText(/filter-me-out/)).not.toBeInTheDocument(), {
      timeout: 800,
    });
    expect(screen.getByText(/keep-me/)).toBeInTheDocument();
  });

  it("renders suggestion cards and calls apply mutation", async () => {
    const user = userEvent.setup();
    render(
      <UnassignedDrawer
        open
        month="2026-07"
        rooms={rooms}
        onClose={vi.fn()}
        onAssigned={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(screen.getByText(/Score 90/)).toBeInTheDocument();
    expect(screen.getByText(/Room is free for the full booking window/i)).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Apply suggestion/i })[0]!);
    expect(applyBookingSuggestionMutation).toHaveBeenCalledWith("b1", "r1", 0);
    expect(performBookingAssignmentMutation).not.toHaveBeenCalled();
  });
});
