import { describe, expect, it } from "vitest";
import type { Channel } from "@stay-ops/db";
import {
  applyOverrides,
  buildAutoRow,
  computeTotals,
  formatPassportFallback,
  formatStayRange,
  guessRentalIndexFromTitle,
  hasExplicitOverride,
  hasMeaningfulOverride,
  mergeOverridePatch,
  splitLegacyNameGuests,
  type BookingForLedger,
  type LedgerRow,
} from "@/modules/excel/ledger";

function bookingFixture(p: Partial<BookingForLedger> & Pick<BookingForLedger, "channel">): BookingForLedger {
  const base: BookingForLedger = {
    channel: p.channel,
    checkinDate: p.checkinDate ?? new Date(Date.UTC(2026, 4, 1)),
    checkoutDate: p.checkoutDate ?? new Date(Date.UTC(2026, 4, 9)),
    nights: p.nights ?? 8,
    guestName: p.guestName ?? null,
    guestEmail: p.guestEmail ?? null,
    guestAdults: p.guestAdults ?? null,
    guestChildren: p.guestChildren ?? null,
    guestInfants: p.guestInfants ?? null,
    guestTotal: p.guestTotal ?? null,
    rawPayload: p.rawPayload ?? {},
    sourceListingTitle: p.sourceListingTitle ?? null,
    roomDisplayName: p.roomDisplayName ?? null,
    sourceListingRentalIndex: p.sourceListingRentalIndex ?? null,
  };
  return { ...base, ...p };
}

describe("guessRentalIndexFromTitle", () => {
  it("maps Iris Apartments Folegandros to slot 3", () => {
    expect(guessRentalIndexFromTitle("Iris Apartments Folegandros")).toBe(3);
  });

  it("returns null when no keyword", () => {
    expect(guessRentalIndexFromTitle("Random listing")).toBeNull();
  });
});

describe("formatStayRange", () => {
  it("same month includes trailing slash on month", () => {
    expect(formatStayRange(new Date(Date.UTC(2026, 4, 1)), new Date(Date.UTC(2026, 4, 9)))).toBe("1-9/5/");
  });

  it("same year cross-month", () => {
    expect(formatStayRange(new Date(Date.UTC(2026, 5, 3)), new Date(Date.UTC(2026, 5, 9)))).toBe("3-9/6/");
  });

  it("cross-year", () => {
    expect(formatStayRange(new Date(Date.UTC(2025, 11, 30)), new Date(Date.UTC(2026, 0, 2)))).toBe(
      "30/12/25-2/1/26",
    );
  });
});

describe("buildAutoRow", () => {
  it("Gitte Symus — Booking.com, Iris, payout from raw", () => {
    const b = bookingFixture({
      channel: "booking" as Channel,
      guestName: "Gitte Symus",
      guestTotal: 2,
      checkinDate: new Date(Date.UTC(2026, 4, 1)),
      checkoutDate: new Date(Date.UTC(2026, 4, 9)),
      nights: 8,
      rawPayload: {
        total_value: { cents: 988_00 },
        total_payout: { cents: 82583 },
      },
      sourceListingTitle: "Iris apartment",
      roomDisplayName: null,
      sourceListingRentalIndex: 3,
    });
    const r = buildAutoRow(b);
    expect(r.name).toBe("GITTE SYMUS");
    expect(r.guestCount).toBe(2);
    expect(r.dateRange).toBe("1-9/5/");
    expect(r.nights).toBe(8);
    expect(r.airbnbAmount).toBeNull();
    expect(r.bookingAmount).toBe(988);
    expect(r.payoutAmount).toBeCloseTo(825.83, 2);
    expect(r.rentalIndex).toBe(3);
    expect(r.rental3).toBe(988);
    expect(r.rental1).toBeNull();
    expect(r.rental2).toBeNull();
    expect(r.rental4).toBeNull();
  });

  it("Patrick Palmen — Airbnb, Cosmos", () => {
    const b = bookingFixture({
      channel: "airbnb" as Channel,
      guestName: "Patrick Palmen",
      guestTotal: 2,
      checkinDate: new Date(Date.UTC(2026, 5, 3)),
      checkoutDate: new Date(Date.UTC(2026, 5, 9)),
      nights: 6,
      rawPayload: {
        total_value: { cents: 800_00 },
        total_payout: { cents: 64624 },
      },
      sourceListingTitle: "Cosmos suite",
      roomDisplayName: null,
      sourceListingRentalIndex: 2,
    });
    const r = buildAutoRow(b);
    expect(r.name).toBe("PATRICK PALMEN");
    expect(r.guestCount).toBe(2);
    expect(r.dateRange).toBe("3-9/6/");
    expect(r.nights).toBe(6);
    expect(r.airbnbAmount).toBe(800);
    expect(r.bookingAmount).toBeNull();
    expect(r.payoutAmount).toBeCloseTo(646.24, 2);
    expect(r.rentalIndex).toBe(2);
    expect(r.rental2).toBe(800);
    expect(r.rental1).toBeNull();
    expect(r.rental3).toBeNull();
    expect(r.rental4).toBeNull();
  });

  it("Nentwig Olaf — direct / solo, Onar", () => {
    const b = bookingFixture({
      channel: "direct" as Channel,
      guestName: "Nentwig Olaf",
      guestTotal: 2,
      rawPayload: {
        total_value: { cents: 1680_00 },
      },
      sourceListingTitle: "Onar studio",
      roomDisplayName: null,
      sourceListingRentalIndex: 1,
    });
    const r = buildAutoRow(b);
    expect(r.name).toBe("NENTWIG OLAF");
    expect(r.guestCount).toBe(2);
    expect(r.soloAmount).toBe(1680);
    expect(r.payoutAmount).toBe(1680);
    expect(r.rentalIndex).toBe(1);
    expect(r.rental1).toBe(1680);
  });

  it("uses Hosthub rental binding only — Iris listing + Cosmos planner room stays slot 3", () => {
    const b = bookingFixture({
      channel: "booking" as Channel,
      guestName: "Gitte Symus",
      guestTotal: 2,
      rawPayload: {
        total_value: { cents: 988_00 },
        total_payout: { cents: 82583 },
      },
      sourceListingTitle: "Iris",
      roomDisplayName: "Cosmos",
      sourceListingRentalIndex: 3,
    });
    const r = buildAutoRow(b);
    expect(r.rentalIndex).toBe(3);
    expect(r.rental3).toBe(988);
    expect(r.rental2).toBeNull();
    expect(r.roomLocation).toBe("Cosmos");
  });
});

describe("formatPassportFallback", () => {
  it("reads guest_identification_number", () => {
    expect(formatPassportFallback({ guest_identification_number: "AB123456" }, null)).toBe("AB123456");
  });
});

describe("splitLegacyNameGuests", () => {
  it("splits trailing guest count", () => {
    expect(splitLegacyNameGuests("LUTZ TANTOW 2")).toEqual({ name: "LUTZ TANTOW", guestCount: 2 });
  });
});

describe("applyOverrides & mergeOverridePatch", () => {
  const auto: LedgerRow = {
    name: "A",
    guestCount: 2,
    passport: "",
    roomLocation: "",
    dateRange: "1/1/",
    nights: 3,
    airbnbAmount: null,
    bookingAmount: 100,
    contractAmount: null,
    soloAmount: null,
    prepayment: null,
    payoutAmount: 80,
    rentalIndex: 2,
    rental1: null,
    rental2: 100,
    rental3: null,
    rental4: null,
  };

  it("applyOverrides replaces only overridden keys", () => {
    const merged = applyOverrides(auto, { bookingAmount: 200, passport: "X" });
    expect(merged.bookingAmount).toBe(200);
    expect(merged.passport).toBe("X");
    expect(merged.nights).toBe(3);
    expect(merged.rental2).toBe(100);
    expect(merged.name).toBe("A");
    expect(merged.guestCount).toBe(2);
  });

  it("applyOverrides reads legacy nameAndGuests when name/guestCount absent", () => {
    const merged = applyOverrides(auto, { nameAndGuests: "B 3" });
    expect(merged.name).toBe("B");
    expect(merged.guestCount).toBe(3);
  });

  it("mergeOverridePatch clears with null", () => {
    const next = mergeOverridePatch({ bookingAmount: 200, passport: "X" }, { bookingAmount: null });
    expect(next.bookingAmount).toBeUndefined();
    expect((next as { passport?: string }).passport).toBe("X");
  });

  it("hasExplicitOverride", () => {
    expect(hasExplicitOverride({ nights: 5 }, "nights")).toBe(true);
    expect(hasExplicitOverride({}, "nights")).toBe(false);
  });

  it("hasMeaningfulOverride is false when override equals auto", () => {
    expect(hasMeaningfulOverride(auto, { name: "A" }, "name")).toBe(false);
    expect(hasMeaningfulOverride(auto, { bookingAmount: 100 }, "bookingAmount")).toBe(false);
  });

  it("hasMeaningfulOverride is true when value differs", () => {
    expect(hasMeaningfulOverride(auto, { name: "Z" }, "name")).toBe(true);
    expect(hasMeaningfulOverride(auto, { bookingAmount: 50 }, "bookingAmount")).toBe(true);
  });
});

describe("computeTotals", () => {
  it("sums rentals, J, L and applies tax formulas", () => {
    const rows: LedgerRow[] = [
      {
        name: "X",
        guestCount: 1,
        passport: "",
        roomLocation: "",
        dateRange: "",
        nights: 1,
        airbnbAmount: null,
        bookingAmount: null,
        contractAmount: null,
        soloAmount: 10,
        prepayment: null,
        payoutAmount: 5,
        rentalIndex: 1,
        rental1: 1000,
        rental2: 2000,
        rental3: 3000,
        rental4: 4000,
      },
      {
        name: "Y",
        guestCount: 1,
        passport: "",
        roomLocation: "",
        dateRange: "",
        nights: 1,
        airbnbAmount: null,
        bookingAmount: null,
        contractAmount: null,
        soloAmount: 20,
        prepayment: null,
        payoutAmount: 15,
        rentalIndex: 1,
        rental1: 100,
        rental2: 200,
        rental3: 300,
        rental4: 400,
      },
      {
        name: "Z",
        guestCount: null,
        passport: "",
        roomLocation: "",
        dateRange: "",
        nights: 1,
        airbnbAmount: null,
        bookingAmount: null,
        contractAmount: null,
        soloAmount: 0,
        prepayment: null,
        payoutAmount: 0,
        rentalIndex: 1,
        rental1: 0,
        rental2: 0,
        rental3: 0,
        rental4: 0,
      },
    ];
    const t = computeTotals(rows);
    expect(t.sumByRental).toEqual([1100, 2200, 3300, 4400]);
    expect(t.grandTotal).toBe(1100 + 2200 + 3300 + 4400);
    expect(t.sumJ).toBe(30);
    expect(t.sumL).toBe(20);
    const R = t.grandTotal;
    expect(t.topBracketTax).toBeCloseTo(9850 + (R - 35000) * 0.45, 5);
    expect(t.perRentalBracketTax[0]).toBeCloseTo(1800 + (1100 - 12000) * 0.35, 5);
    expect(t.perRentalBracketTax[1]).toBeCloseTo(1800 + (2200 - 12000) * 0.35, 5);
  });
});
