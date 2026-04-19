import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarMonthPayload } from "@/modules/calendar/calendarTypes";
import { MultiMonthTimeline } from "@/modules/calendar/MultiMonthTimeline";

function wrap(ui: ReactElement) {
  return <DndContext onDragEnd={() => {}}>{ui}</DndContext>;
}

const baseRoom = { id: "room_a", code: "A", name: "Alpha", isActive: true, maxGuests: null as number | null };

const july: CalendarMonthPayload = {
  month: "2026-07",
  timezone: "Etc/UTC",
  rooms: [baseRoom],
  items: [],
  markers: [],
  dailyRatesByRoomDay: {},
};

const august: CalendarMonthPayload = {
  month: "2026-08",
  timezone: "Etc/UTC",
  rooms: [baseRoom],
  items: [],
  markers: [],
  dailyRatesByRoomDay: {},
};

describe("MultiMonthTimeline", () => {
  it("renders combined title and a single Apartments header", () => {
    render(
      wrap(
        <MultiMonthTimeline
          monthsData={[july, august]}
          loading={false}
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
        />,
      ),
    );
    expect(screen.getByRole("heading", { name: "July – August 2026" })).toBeInTheDocument();
    expect(screen.getAllByText("Apartments")).toHaveLength(1);
  });
});
