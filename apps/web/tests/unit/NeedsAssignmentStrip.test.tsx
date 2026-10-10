import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { describe, expect, it, vi } from "vitest";
import {
  NeedsAssignmentDragCard,
  type OverviewUnassignedBooking,
} from "@/modules/calendar/NeedsAssignmentStrip";

const rooms = [{ id: "r1", label: "R1" }];

function renderCard(status: string) {
  const booking: OverviewUnassignedBooking = {
    bookingId: "b1",
    guestName: "Maria",
    guestTotal: null,
    guestAdults: null,
    guestChildren: null,
    guestInfants: null,
    channel: "direct",
    checkinDate: "2026-07-01",
    checkoutDate: "2026-07-05",
    status,
  };
  render(
    <DndContext>
      <NeedsAssignmentDragCard
        booking={booking}
        roomValue="r1"
        rooms={rooms}
        assigning={false}
        onRoomChange={vi.fn()}
        onAssign={vi.fn()}
      />
    </DndContext>,
  );
}

describe("NeedsAssignmentDragCard", () => {
  it("greys out a pending booking, disables Assign and dragging", () => {
    renderCard("pending");
    expect(screen.getByText("Αναμένει επιβεβαίωση")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    const handle = screen.getByRole("button", { name: /Drag booking Maria/ });
    expect(handle).toBeDisabled();
    expect(handle).not.toHaveAttribute("aria-roledescription");
    expect(screen.getByRole("article")).toHaveStyle({ opacity: "0.5" });
  });

  it("keeps a confirmed booking assignable and draggable", () => {
    renderCard("confirmed");
    expect(screen.queryByText("Αναμένει επιβεβαίωση")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Drag booking Maria/ })).toBeEnabled();
  });
});
