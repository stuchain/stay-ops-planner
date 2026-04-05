import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnassignedDrawer } from "@/modules/bookings/UnassignedDrawer";

vi.mock("@/modules/calendar/assignmentMutations", () => ({
  performBookingAssignmentMutation: vi.fn().mockResolvedValue(undefined),
}));

describe("UnassignedDrawer", () => {
  const rooms = [{ id: "r1", code: "R1", name: null, isActive: true }];

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
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
      ),
    ) as typeof fetch;
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
});
