import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { BookingCard } from "@/modules/calendar/BookingCard";
import type { CalendarBookingItem } from "@/modules/calendar/calendarTypes";

function wrap(ui: ReactElement) {
  return <DndContext onDragEnd={() => {}}>{ui}</DndContext>;
}

const baseItem: CalendarBookingItem = {
  kind: "booking",
  id: "bk_1",
  roomId: null,
  startDate: "2026-07-03",
  endDate: "2026-07-07",
  guestName: "River Tam",
  guestTotal: null,
  guestAdults: null,
  guestChildren: null,
  guestInfants: null,
  channel: "airbnb",
  status: "confirmed",
  assignmentId: null,
  assignmentVersion: null,
  flags: ["unassigned"],
};

describe("BookingCard", () => {
  it("shows guest, dates, and booking test id", () => {
    render(wrap(<BookingCard item={baseItem} />));
    expect(screen.getByTestId("ops-booking-card-bk_1")).toBeInTheDocument();
    expect(screen.getByText("River Tam")).toBeInTheDocument();
    expect(screen.getByText(/2026-07-03/)).toBeInTheDocument();
  });

  it("renders quick assign on mobile and calls handler", async () => {
    const user = userEvent.setup();
    const onQuick = vi.fn();
    render(wrap(<BookingCard item={baseItem} isMobile onQuickAssign={onQuick} />));
    await user.click(screen.getByTestId("ops-assign-quick-bk_1"));
    expect(onQuick).toHaveBeenCalledTimes(1);
  });
});
