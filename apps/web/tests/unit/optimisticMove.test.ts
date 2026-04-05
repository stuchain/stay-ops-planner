import { describe, expect, it } from "vitest";
import type { CalendarMonthPayload } from "@/modules/calendar/calendarTypes";
import {
  applyOptimisticBookingMove,
  bookingItemToDragPayload,
  formatAllocationError,
  parseLaneDropTarget,
} from "@/modules/calendar/optimisticMove";

const basePayload = (): CalendarMonthPayload => ({
  month: "2026-07",
  timezone: "Etc/UTC",
  rooms: [{ id: "r1", code: "A", name: null, isActive: true }],
  items: [
    {
      kind: "booking",
      id: "b1",
      roomId: null,
      startDate: "2026-07-05",
      endDate: "2026-07-10",
      guestName: "Guest A",
      status: "confirmed",
      assignmentId: null,
      assignmentVersion: null,
      flags: ["unassigned"],
    },
    {
      kind: "booking",
      id: "b2",
      roomId: "r1",
      startDate: "2026-07-12",
      endDate: "2026-07-15",
      guestName: "Guest B",
      status: "confirmed",
      assignmentId: "asg_2",
      assignmentVersion: 3,
      flags: [],
    },
    {
      kind: "block",
      id: "blk_1",
      roomId: "r1",
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      reason: "Maint",
    },
  ],
  markers: [],
});

describe("applyOptimisticBookingMove", () => {
  it("moves a booking to a room and clears unassigned flag", () => {
    const p = basePayload();
    const next = applyOptimisticBookingMove(p, "b1", "r1");
    const b1 = next.items.find((i) => i.kind === "booking" && i.id === "b1");
    expect(b1 && b1.kind === "booking").toBe(true);
    if (b1?.kind !== "booking") return;
    expect(b1.roomId).toBe("r1");
    expect(b1.flags).not.toContain("unassigned");
    expect(b1.assignmentId).toBeNull();
    expect(b1.assignmentVersion).toBeNull();
  });

  it("moves assigned booking to another room id and preserves assignment fields until server responds", () => {
    const p = basePayload();
    const next = applyOptimisticBookingMove(p, "b2", "r_other");
    const b2 = next.items.find((i) => i.kind === "booking" && i.id === "b2");
    expect(b2?.kind).toBe("booking");
    if (b2?.kind !== "booking") return;
    expect(b2.roomId).toBe("r_other");
    expect(b2.assignmentId).toBe("asg_2");
    expect(b2.assignmentVersion).toBe(3);
  });

  it("sends booking to unassigned lane: null room, clears assignment ids, adds unassigned flag", () => {
    const p = basePayload();
    const next = applyOptimisticBookingMove(p, "b2", null);
    const b2 = next.items.find((i) => i.kind === "booking" && i.id === "b2");
    expect(b2?.kind).toBe("booking");
    if (b2?.kind !== "booking") return;
    expect(b2.roomId).toBeNull();
    expect(b2.assignmentId).toBeNull();
    expect(b2.assignmentVersion).toBeNull();
    expect(b2.flags).toContain("unassigned");
  });

  it("leaves other bookings and blocks unchanged", () => {
    const p = basePayload();
    const next = applyOptimisticBookingMove(p, "b1", "r1");
    const block = next.items.find((i) => i.kind === "block");
    expect(block?.kind).toBe("block");
    if (block?.kind !== "block") return;
    expect(block.id).toBe("blk_1");
    const b2 = next.items.find((i) => i.kind === "booking" && i.id === "b2");
    expect(b2?.kind).toBe("booking");
    if (b2?.kind !== "booking") return;
    expect(b2.roomId).toBe("r1");
  });
});

describe("formatAllocationError", () => {
  it("maps Appendix A codes", () => {
    expect(formatAllocationError("CONFLICT_ASSIGNMENT", "x")).toBe(
      "That room is already booked for those nights.",
    );
    expect(formatAllocationError("CONFLICT_BLOCK", "x")).toBe("That room is blocked for maintenance.");
    expect(formatAllocationError("ROOM_INACTIVE", "x")).toBe("That room is not active.");
  });

  it("returns server message when code unknown", () => {
    expect(formatAllocationError(undefined, "Something else")).toBe("Something else");
    expect(formatAllocationError("OTHER", "Raw")).toBe("Raw");
  });
});

describe("parseLaneDropTarget", () => {
  it("parses unassigned and room lanes", () => {
    expect(parseLaneDropTarget("lane-unassigned")).toBe("unassigned");
    expect(parseLaneDropTarget("lane-room-r1")).toBe("r1");
    expect(parseLaneDropTarget("unknown")).toBeNull();
  });
});

describe("bookingItemToDragPayload", () => {
  it("builds drag payload from calendar item", () => {
    const item = basePayload().items[0];
    expect(item.kind).toBe("booking");
    if (item.kind !== "booking") return;
    expect(bookingItemToDragPayload(item)).toEqual({
      type: "booking",
      bookingId: "b1",
      assignmentId: null,
      assignmentVersion: null,
      fromRoomId: null,
    });
  });
});
