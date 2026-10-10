import { describe, expect, it } from "vitest";
import { bookingDropTargetFromOverId } from "@/modules/calendar/dropTarget";

describe("bookingDropTargetFromOverId", () => {
  it("maps lane ids", () => {
    expect(bookingDropTargetFromOverId("lane-room-x")).toBe("x");
    expect(bookingDropTargetFromOverId("2026-10:lane-room-x")).toBe("x");
    expect(bookingDropTargetFromOverId("unified:lane-room-x")).toBe("x");
  });
  it("maps reorder rows to their room", () => {
    expect(bookingDropTargetFromOverId("room-order:x")).toBe("x");
    expect(bookingDropTargetFromOverId("2026-10:room-order:x")).toBe("x");
  });
  it("maps unassigned lanes", () => {
    expect(bookingDropTargetFromOverId("lane-unassigned")).toBe("unassigned");
    expect(bookingDropTargetFromOverId("2026-10:lane-unassigned")).toBe("unassigned");
  });
  it("returns null for junk", () => {
    expect(bookingDropTargetFromOverId("")).toBeNull();
    expect(bookingDropTargetFromOverId("room-order:")).toBeNull();
    expect(bookingDropTargetFromOverId("booking-b1")).toBeNull();
    expect(bookingDropTargetFromOverId("a:b:c")).toBeNull();
  });
});
