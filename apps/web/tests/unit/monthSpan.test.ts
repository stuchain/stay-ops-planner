import { describe, expect, it } from "vitest";
import type { CalendarBookingItem } from "@/modules/calendar/calendarTypes";
import {
  barStartColumn,
  bookingSpanFromStayDates,
  hasNextCheckinOnCheckoutDay,
  hasPriorCheckoutOnFirstNightDay,
  isStayCheckoutAfterVisibleLastDay,
  layoutEndExclusive,
  stayNightSpanInMonth,
} from "@/modules/calendar/monthSpan";

function booking(
  partial: Omit<CalendarBookingItem, "kind" | "guestAdults" | "guestChildren" | "guestInfants"> &
    Partial<Pick<CalendarBookingItem, "guestAdults" | "guestChildren" | "guestInfants">>,
): CalendarBookingItem {
  return {
    kind: "booking",
    guestAdults: null,
    guestChildren: null,
    guestInfants: null,
    ...partial,
  };
}

describe("stayNightSpanInMonth", () => {
  it("Apr 28 → May 1: May has no nights, checkout on day 1 only", () => {
    const s = stayNightSpanInMonth("2026-04-28", "2026-05-01", "2026-05", 31);
    expect(s.nightStart).toBe(1);
    expect(s.nightEndExclusive).toBe(1);
    expect(s.checkoutDayInMonth).toBe(1);
  });

  it("Apr 28 → May 1: April has nights 28–30, no checkout in April", () => {
    const s = stayNightSpanInMonth("2026-04-28", "2026-05-01", "2026-04", 30);
    expect(s.nightStart).toBe(28);
    expect(s.nightEndExclusive).toBe(31);
    expect(s.checkoutDayInMonth).toBeNull();
  });

  it("May 1 → May 4: three nights in May, checkout day 4", () => {
    const s = stayNightSpanInMonth("2026-05-01", "2026-05-04", "2026-05", 31);
    expect(s.nightStart).toBe(1);
    expect(s.nightEndExclusive).toBe(4);
    expect(s.checkoutDayInMonth).toBe(4);
  });
});

describe("bookingSpanFromStayDates", () => {
  it("checkout-only May: layout ends after checkout column, bar starts at checkout day", () => {
    const b = bookingSpanFromStayDates("2026-04-28", "2026-05-01", "2026-05", 31);
    expect(b.start).toBe(1);
    expect(b.endExclusive).toBe(1);
    expect(b.barStart).toBe(1);
    expect(b.layoutEndExclusive).toBe(2);
    expect(b.checkoutDayInMonth).toBe(1);
  });

  it("normal stay: layout includes checkout column after last night", () => {
    const b = bookingSpanFromStayDates("2026-05-01", "2026-05-04", "2026-05", 31);
    expect(b.start).toBe(1);
    expect(b.endExclusive).toBe(4);
    expect(b.barStart).toBe(1);
    expect(b.layoutEndExclusive).toBe(5);
  });
});

describe("helpers", () => {
  it("layoutEndExclusive matches checkout column rule", () => {
    const span = stayNightSpanInMonth("2026-05-01", "2026-05-04", "2026-05", 31);
    expect(layoutEndExclusive(span)).toBe(5);
  });

  it("barStartColumn prefers first night column when nights exist", () => {
    const span = stayNightSpanInMonth("2026-05-10", "2026-05-15", "2026-05", 31);
    expect(barStartColumn(span)).toBe(10);
  });
});

describe("hasPriorCheckoutOnFirstNightDay", () => {
  const month = "2026-05";
  const monthDayCount = 31;

  it("is true when another booking checks out on the same calendar day as this stay’s first night", () => {
    const prior = booking({
      id: "a",
      roomId: "r1",
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      guestName: "Prior",
      guestTotal: null,
      channel: "direct",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    const incoming = booking({
      id: "b",
      roomId: "r1",
      startDate: "2026-05-03",
      endDate: "2026-05-06",
      guestName: "Next",
      guestTotal: null,
      channel: "direct",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    expect(
      hasPriorCheckoutOnFirstNightDay([prior, incoming], incoming.id, month, monthDayCount, 3),
    ).toBe(true);
  });

  it("is false when no other booking shares that checkout day", () => {
    const only = booking({
      id: "b",
      roomId: "r1",
      startDate: "2026-05-03",
      endDate: "2026-05-06",
      guestName: "Next",
      guestTotal: null,
      channel: "direct",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    expect(hasPriorCheckoutOnFirstNightDay([only], only.id, month, monthDayCount, 3)).toBe(false);
  });

  it("is false when another booking checks out on a different day than first night", () => {
    const prior = booking({
      id: "a",
      roomId: "r1",
      startDate: "2026-05-01",
      endDate: "2026-05-04",
      guestName: "Prior",
      guestTotal: null,
      channel: "direct",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    const incoming = booking({
      id: "b",
      roomId: "r1",
      startDate: "2026-05-03",
      endDate: "2026-05-06",
      guestName: "Next",
      guestTotal: null,
      channel: "direct",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    expect(
      hasPriorCheckoutOnFirstNightDay([prior, incoming], incoming.id, month, monthDayCount, 3),
    ).toBe(false);
  });
});

describe("hasNextCheckinOnCheckoutDay", () => {
  const month = "2026-07";
  const monthDayCount = 31;

  it("is true when another booking’s first night is on checkoutDay", () => {
    const outgoing = booking({
      id: "a",
      roomId: "r1",
      startDate: "2026-07-10",
      endDate: "2026-07-14",
      guestName: "Out",
      guestTotal: null,
      channel: "direct",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    const incoming = booking({
      id: "b",
      roomId: "r1",
      startDate: "2026-07-14",
      endDate: "2026-07-27",
      guestName: "In",
      guestTotal: null,
      channel: "booking",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    expect(
      hasNextCheckinOnCheckoutDay([outgoing, incoming], outgoing.id, month, monthDayCount, 14),
    ).toBe(true);
  });

  it("is false when checkoutDay is null", () => {
    const outgoing = booking({
      id: "a",
      roomId: "r1",
      startDate: "2026-07-10",
      endDate: "2026-07-14",
      guestName: "Out",
      guestTotal: null,
      channel: "direct",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    expect(hasNextCheckinOnCheckoutDay([outgoing], outgoing.id, month, monthDayCount, null)).toBe(
      false,
    );
  });

  it("is false when no other booking starts on checkoutDay", () => {
    const outgoing = booking({
      id: "a",
      roomId: "r1",
      startDate: "2026-07-10",
      endDate: "2026-07-14",
      guestName: "Out",
      guestTotal: null,
      channel: "direct",
      status: "ok",
      assignmentId: null,
      assignmentVersion: null,
      flags: [],
    });
    expect(hasNextCheckinOnCheckoutDay([outgoing], outgoing.id, month, monthDayCount, 14)).toBe(
      false,
    );
  });
});

describe("isStayCheckoutAfterVisibleLastDay", () => {
  it("is true when checkout is after the last visible calendar day", () => {
    expect(isStayCheckoutAfterVisibleLastDay("2026-08-10", "2026-07-31")).toBe(true);
  });

  it("is false when checkout is on or before the last visible day", () => {
    expect(isStayCheckoutAfterVisibleLastDay("2026-07-31", "2026-07-31")).toBe(false);
    expect(isStayCheckoutAfterVisibleLastDay("2026-07-15", "2026-07-31")).toBe(false);
  });
});
