import { describe, expect, it } from "vitest";
import {
  allowedNextStatuses,
  assertBookingStatusTransition,
} from "@/modules/booking/statusTransition";
import { bookingStatusLabel, statusChoicesFor } from "@/modules/bookings/bookingStatusLabel";

const ALL = ["pending", "confirmed", "cancelled", "needs_reassignment"] as const;

function isLegal(from: (typeof ALL)[number], to: (typeof ALL)[number]): boolean {
  try {
    assertBookingStatusTransition(from, to);
    return true;
  } catch {
    return false;
  }
}

describe("statusChoicesFor", () => {
  it.each(ALL)("offers current plus legal next statuses for %s", (current) => {
    const choices = statusChoicesFor(current);
    expect(choices[0]).toBe(current);
    for (const to of ALL) {
      const expected = to === current || (isLegal(current, to) && to !== "needs_reassignment");
      expect(choices.includes(to), `${current} -> ${to}`).toBe(expected);
    }
  });

  it("never offers needs_reassignment as a target", () => {
    for (const s of ["pending", "confirmed", "cancelled"] as const) {
      expect(statusChoicesFor(s)).not.toContain("needs_reassignment");
    }
    expect(allowedNextStatuses("confirmed")).toContain("needs_reassignment");
  });

  it("has a Greek label for every status", () => {
    for (const s of ALL) expect(bookingStatusLabel(s)).toMatch(/[Α-Ωα-ω]/);
    expect(statusChoicesFor("cancelled")).toEqual(["cancelled"]);
  });
});
