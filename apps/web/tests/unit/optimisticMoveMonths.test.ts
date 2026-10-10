import { describe, expect, it } from "vitest";
import type { CalendarBookingItem, CalendarMonthPayload } from "@/modules/calendar/calendarTypes";
import {
  applyConfirmedAssignmentToMonths,
  applyOptimisticBookingMoveToMonths,
  restoreBookingInMonths,
  snapshotBookingInMonths,
  type CalendarDataByMonth,
} from "@/modules/calendar/optimisticMove";

function booking(id: string, roomId: string | null, startDate: string, endDate: string): CalendarBookingItem {
  return {
    kind: "booking",
    id,
    roomId,
    startDate,
    endDate,
    guestName: id,
    guestTotal: 2,
    guestAdults: null,
    guestChildren: null,
    guestInfants: null,
    channel: "airbnb",
    status: "confirmed",
    assignmentId: roomId ? `asg_${id}` : null,
    assignmentVersion: roomId ? 1 : null,
    flags: roomId ? [] : ["unassigned"],
  };
}

function month(ym: string, items: CalendarBookingItem[]): CalendarMonthPayload {
  return {
    month: ym,
    timezone: "Etc/UTC",
    rooms: [
      { id: "onar", code: "Onar", name: null, isActive: true, maxGuests: null },
      { id: "cosmos", code: "Cosmos", name: null, isActive: true, maxGuests: null },
    ],
    items,
    markers: [],
    dailyRatesByRoomDay: {},
  };
}

/** 28 Oct to 3 Nov in Onar appears in both months; another booking only in November. */
function twoMonths(): CalendarDataByMonth {
  return {
    "2026-10": month("2026-10", [booking("span", "onar", "2026-10-28", "2026-11-03")]),
    "2026-11": month("2026-11", [
      booking("span", "onar", "2026-10-28", "2026-11-03"),
      booking("other", "cosmos", "2026-11-10", "2026-11-12"),
    ]),
  };
}

function roomOf(data: CalendarDataByMonth, ym: string, id: string): string | null | undefined {
  const item = data[ym]?.items.find((i) => i.kind === "booking" && i.id === id);
  return item?.kind === "booking" ? item.roomId : undefined;
}

describe("applyOptimisticBookingMoveToMonths", () => {
  it("moves every copy of a booking that spans two months", () => {
    const next = applyOptimisticBookingMoveToMonths(twoMonths(), "span", "cosmos");
    expect(roomOf(next, "2026-10", "span")).toBe("cosmos");
    expect(roomOf(next, "2026-11", "span")).toBe("cosmos");
    expect(roomOf(next, "2026-11", "other")).toBe("cosmos");
  });

  it("returns the same object when the booking is not loaded", () => {
    const data = twoMonths();
    expect(applyOptimisticBookingMoveToMonths(data, "missing", "cosmos")).toBe(data);
  });
});

describe("restoreBookingInMonths", () => {
  it("puts back only the refused booking, keeping a different successful move", () => {
    let data = twoMonths();
    const spanSnapshot = snapshotBookingInMonths(data, "span");
    data = applyOptimisticBookingMoveToMonths(data, "span", "cosmos");
    data = applyOptimisticBookingMoveToMonths(data, "other", "onar");
    data = restoreBookingInMonths(data, "span", spanSnapshot, "cosmos");
    expect(roomOf(data, "2026-10", "span")).toBe("onar");
    expect(roomOf(data, "2026-11", "span")).toBe("onar");
    expect(roomOf(data, "2026-11", "other")).toBe("onar");
  });

  it("leaves a copy alone when it no longer shows the refused move", () => {
    let data = twoMonths();
    const snapshot = snapshotBookingInMonths(data, "span");
    data = applyOptimisticBookingMoveToMonths(data, "span", "cosmos");
    // A newer move of the same booking already replaced it.
    data = applyOptimisticBookingMoveToMonths(data, "span", null);
    data = restoreBookingInMonths(data, "span", snapshot, "cosmos");
    expect(roomOf(data, "2026-10", "span")).toBeNull();
    expect(roomOf(data, "2026-11", "span")).toBeNull();
  });
});

describe("applyConfirmedAssignmentToMonths", () => {
  it("writes the new assignment id and version into every copy", () => {
    const next = applyConfirmedAssignmentToMonths(twoMonths(), "span", {
      id: "asg_new",
      roomId: "cosmos",
      version: 2,
    });
    for (const ym of ["2026-10", "2026-11"]) {
      const item = next[ym]?.items.find((i) => i.kind === "booking" && i.id === "span");
      expect(item).toMatchObject({ roomId: "cosmos", assignmentId: "asg_new", assignmentVersion: 2 });
    }
  });

  it("clears the assignment after an unassign", () => {
    const next = applyConfirmedAssignmentToMonths(twoMonths(), "span", null);
    const item = next["2026-11"]?.items.find((i) => i.kind === "booking" && i.id === "span");
    expect(item).toMatchObject({ roomId: null, assignmentId: null, assignmentVersion: null });
    expect(item?.kind === "booking" && item.flags).toContain("unassigned");
  });
});
