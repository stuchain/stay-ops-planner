import { describe, expect, it } from "vitest";
import { bookingStatusLabel, isPendingBooking } from "@/modules/bookings/bookingStatusLabel";

describe("bookingStatusLabel", () => {
  it("maps known statuses to Greek wording", () => {
    expect(bookingStatusLabel("confirmed")).toBe("Επιβεβαιωμένη");
    expect(bookingStatusLabel("pending")).toBe("Αναμένει επιβεβαίωση");
    expect(bookingStatusLabel("cancelled")).toBe("Ακυρωμένη");
    expect(bookingStatusLabel("needs_reassignment")).toBe("Χρειάζεται νέο διαμέρισμα");
  });

  it("returns unknown values unchanged", () => {
    expect(bookingStatusLabel("something_else")).toBe("something_else");
    expect(bookingStatusLabel("toString")).toBe("toString");
  });

  it("detects pending", () => {
    expect(isPendingBooking("pending")).toBe(true);
    expect(isPendingBooking("confirmed")).toBe(false);
    expect(isPendingBooking(undefined)).toBe(false);
  });
});
