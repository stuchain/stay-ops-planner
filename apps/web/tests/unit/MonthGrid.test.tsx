import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarMonthPayload } from "@/modules/calendar/calendarTypes";
import { MonthGrid } from "@/modules/calendar/MonthGrid";

function wrap(ui: ReactElement) {
  return <DndContext onDragEnd={() => {}}>{ui}</DndContext>;
}

const payload: CalendarMonthPayload = {
  month: "2026-07",
  timezone: "Etc/UTC",
  rooms: [{ id: "room_a", code: "A", name: "Alpha", isActive: true }],
  items: [
    {
      kind: "booking",
      id: "b_un",
      roomId: null,
      startDate: "2026-07-10",
      endDate: "2026-07-14",
      guestName: "Unassigned guest",
      status: "confirmed",
      assignmentId: null,
      assignmentVersion: null,
      flags: ["unassigned"],
    },
  ],
  markers: [],
};

describe("MonthGrid", () => {
  it("renders month title, unassigned lane, room lane, and booking test ids", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      wrap(
        <MonthGrid
          data={payload}
          loading={false}
          error={null}
          onPrevMonth={onPrev}
          onNextMonth={onNext}
        />,
      ),
    );
    expect(screen.getByRole("heading", { name: "2026-07" })).toBeInTheDocument();
    expect(screen.getByTestId("ops-room-lane-unassigned")).toBeInTheDocument();
    expect(screen.getByTestId("ops-room-lane-A")).toBeInTheDocument();
    expect(screen.getByTestId("ops-booking-card-b_un")).toBeInTheDocument();
  });
});
