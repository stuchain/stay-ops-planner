import { describe, expect, it } from "vitest";
import { convertLegacyOverrides } from "@/server/money/legacyOverrides";

describe("convertLegacyOverrides", () => {
  it("turns euro floats into cents and keeps text and counts", () => {
    expect(
      convertLegacyOverrides({
        airbnbAmount: 560.5,
        payoutAmount: 490.75,
        rental2: 0.1 + 0.2,
        prepayment: 1.005,
        name: "PAPADOPOULOS",
        nights: 4,
        rentalIndex: 2,
      }),
    ).toEqual({
      overrides: {
        airbnbCents: 56_050,
        payoutCents: 49_075,
        rental2Cents: 30,
        prepaymentCents: 101,
        name: "PAPADOPOULOS",
        nights: 4,
        rentalIndex: 2,
      },
      dropped: [],
    });
  });

  it("splits the legacy combined name column unless the new columns are set", () => {
    expect(convertLegacyOverrides({ nameAndGuests: "Smith 3" }).overrides).toEqual({ name: "SMITH", guestCount: 3 });
    expect(convertLegacyOverrides({ nameAndGuests: "Smith" }).overrides).toEqual({ name: "SMITH", guestCount: null });
    expect(convertLegacyOverrides({ nameAndGuests: "Smith 3", name: "JONES" }).overrides).toEqual({
      name: "JONES",
      guestCount: 3,
    });
  });

  it("reports what it cannot read", () => {
    expect(
      convertLegacyOverrides({
        airbnbAmount: "12",
        rentalIndex: 9,
        nights: -1,
        passport: 5,
        extra: 1,
        nameAndGuests: 4,
        x: null,
      }),
    ).toEqual({
      overrides: {},
      dropped: ["airbnbAmount", "rentalIndex", "nights", "passport", "extra", "nameAndGuests"],
    });
    expect(convertLegacyOverrides(null)).toEqual({ overrides: {}, dropped: [] });
    expect(convertLegacyOverrides([1])).toEqual({ overrides: {}, dropped: [] });
  });
});
