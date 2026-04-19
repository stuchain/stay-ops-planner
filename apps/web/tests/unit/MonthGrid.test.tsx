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
  rooms: [{ id: "room_a", code: "A", name: "Alpha", isActive: true, maxGuests: null }],
  items: [
    {
      kind: "booking",
      id: "b_un",
      roomId: null,
      startDate: "2026-07-10",
      endDate: "2026-07-14",
      guestName: "Unassigned guest",
      guestTotal: null,
      guestAdults: null,
      guestChildren: null,
      guestInfants: null,
      channel: "booking",
      status: "confirmed",
      assignmentId: null,
      assignmentVersion: null,
      flags: ["unassigned"],
    },
  ],
  markers: [],
  dailyRatesByRoomDay: {},
};

describe("MonthGrid", () => {
  it("renders month title, room lane, and booking test ids", () => {
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
    expect(screen.getByRole("heading", { name: "July 2026" })).toBeInTheDocument();
    expect(screen.getByTestId("ops-room-lane-A")).toBeInTheDocument();
    expect(screen.queryByTestId("ops-booking-card-b_un")).not.toBeInTheDocument();
  });

  it("keeps same-day checkout/check-in mate on the same row", () => {
    const matePayload: CalendarMonthPayload = {
      ...payload,
      items: [
        {
          kind: "booking",
          id: "b_prior",
          roomId: "room_a",
          startDate: "2026-07-01",
          endDate: "2026-07-03",
          guestName: "Prior guest",
          guestTotal: null,
          guestAdults: null,
          guestChildren: null,
          guestInfants: null,
          channel: "booking",
          status: "confirmed",
          assignmentId: null,
          assignmentVersion: null,
          flags: [],
        },
        {
          kind: "booking",
          id: "b_next",
          roomId: "room_a",
          startDate: "2026-07-03",
          endDate: "2026-07-05",
          guestName: "Next guest",
          guestTotal: null,
          guestAdults: null,
          guestChildren: null,
          guestInfants: null,
          channel: "direct",
          status: "confirmed",
          assignmentId: null,
          assignmentVersion: null,
          flags: [],
        },
      ],
    };
    render(
      wrap(
        <MonthGrid
          data={matePayload}
          loading={false}
          error={null}
          onPrevMonth={() => {}}
          onNextMonth={() => {}}
        />,
      ),
    );
    expect(screen.getByTestId("ops-booking-card-b_prior")).toHaveStyle({ gridRow: "1" });
    expect(screen.getByTestId("ops-booking-card-b_next")).toHaveStyle({ gridRow: "1" });
  });

  it("still stacks bookings when nights truly overlap", () => {
    const overlapPayload: CalendarMonthPayload = {
      ...payload,
      items: [
        {
          kind: "booking",
          id: "b_first",
          roomId: "room_a",
          startDate: "2026-07-01",
          endDate: "2026-07-04",
          guestName: "First guest",
          guestTotal: null,
          guestAdults: null,
          guestChildren: null,
          guestInfants: null,
          channel: "booking",
          status: "confirmed",
          assignmentId: null,
          assignmentVersion: null,
          flags: [],
        },
        {
          kind: "booking",
          id: "b_overlap",
          roomId: "room_a",
          startDate: "2026-07-03",
          endDate: "2026-07-06",
          guestName: "Overlap guest",
          guestTotal: null,
          guestAdults: null,
          guestChildren: null,
          guestInfants: null,
          channel: "direct",
          status: "confirmed",
          assignmentId: null,
          assignmentVersion: null,
          flags: [],
        },
      ],
    };
    render(
      wrap(
        <MonthGrid
          data={overlapPayload}
          loading={false}
          error={null}
          onPrevMonth={() => {}}
          onNextMonth={() => {}}
        />,
      ),
    );
    expect(screen.getByTestId("ops-booking-card-b_first")).toHaveStyle({ gridRow: "1" });
    expect(screen.getByTestId("ops-booking-card-b_overlap")).toHaveStyle({ gridRow: "2" });
  });
});
