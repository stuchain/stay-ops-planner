import { describe, expect, it } from "vitest";
import { effectiveGuestCount, roomAcceptsParty } from "@/modules/bookings/effectiveGuestCount";

describe("effectiveGuestCount", () => {
  it("prefers guestTotal when positive", () => {
    expect(
      effectiveGuestCount({
        guestTotal: 3,
        guestAdults: 9,
        guestChildren: 0,
        guestInfants: 0,
      }),
    ).toBe(3);
  });

  it("sums adults, children, infants when guestTotal missing", () => {
    expect(
      effectiveGuestCount({
        guestTotal: null,
        guestAdults: 2,
        guestChildren: 1,
        guestInfants: 0,
      }),
    ).toBe(3);
  });

  it("returns null when party size unknown", () => {
    expect(effectiveGuestCount({ guestTotal: null, guestAdults: null })).toBeNull();
  });
});

describe("roomAcceptsParty", () => {
  it("allows unknown party size", () => {
    expect(roomAcceptsParty(2, null)).toBe(true);
  });

  it("allows when maxGuests unset", () => {
    expect(roomAcceptsParty(null, 5)).toBe(true);
  });

  it("rejects when over capacity", () => {
    expect(roomAcceptsParty(2, 3)).toBe(false);
  });
});
