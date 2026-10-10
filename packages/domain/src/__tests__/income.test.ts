import { describe, expect, it } from "vitest";
import { incomeFor, isRentalIndex, rentalBucketFor, taxableCents, type BookingMoney } from "../income.js";

const booking = (over: Partial<BookingMoney> = {}): BookingMoney => ({
  channel: "airbnb",
  status: "confirmed",
  totalValueCents: 56_000,
  bookingValueCents: 52_000,
  payoutCents: 49_075,
  cleaningFeeCents: 4000,
  currency: "EUR",
  ...over,
});

describe("incomeFor", () => {
  it("platform bookings: gross is the total, payout is the payout", () => {
    expect(incomeFor(booking())).toEqual({
      kind: "confirmed",
      grossCents: 56_000,
      payoutCents: 49_075,
      channelFeeCents: 6925,
      cleaningFeeCents: 4000,
      counts: true,
      foreignCurrency: false,
    });
  });

  it("platform bookings without a payout use the total", () => {
    const income = incomeFor(booking({ channel: "booking", payoutCents: null }));
    expect(income.payoutCents).toBe(56_000);
    expect(income.channelFeeCents).toBeNull();
  });

  it("falls back to the accommodation value, then to the payout", () => {
    expect(incomeFor(booking({ totalValueCents: null })).grossCents).toBe(52_000);
    expect(incomeFor(booking({ totalValueCents: null, bookingValueCents: null })).grossCents).toBe(49_075);
    const empty = incomeFor(booking({ totalValueCents: null, bookingValueCents: null, payoutCents: null }));
    expect(empty.grossCents).toBe(0);
    expect(empty.payoutCents).toBe(0);
  });

  it("direct bookings use the total for both", () => {
    const income = incomeFor(booking({ channel: "direct", payoutCents: 1, cleaningFeeCents: null }));
    expect(income.grossCents).toBe(56_000);
    expect(income.payoutCents).toBe(56_000);
    expect(income.channelFeeCents).toBeNull();
    expect(income.cleaningFeeCents).toBeNull();
  });

  it("cancelled bookings count only what was paid out", () => {
    const paid = incomeFor(booking({ status: "cancelled", payoutCents: 12_000 }));
    expect(paid).toMatchObject({ kind: "cancelled_paid", grossCents: 12_000, payoutCents: 12_000, counts: true });
    const unpaid = incomeFor(booking({ status: "cancelled", payoutCents: null }));
    expect(unpaid).toMatchObject({ kind: "cancelled_unpaid", grossCents: 0, payoutCents: 0, counts: false });
    expect(incomeFor(booking({ status: "cancelled", payoutCents: 0 })).kind).toBe("cancelled_unpaid");
  });

  it("pending requests are shown but never counted", () => {
    expect(incomeFor(booking({ status: "pending" }))).toMatchObject({ kind: "pending", counts: false });
  });

  it("bookings waiting for an apartment still count", () => {
    expect(incomeFor(booking({ status: "needs_reassignment" }))).toMatchObject({ kind: "confirmed", counts: true });
  });

  it("flags amounts that are not in euros", () => {
    expect(incomeFor(booking({ currency: "usd" })).foreignCurrency).toBe(true);
    expect(incomeFor(booking({ currency: " eur " })).foreignCurrency).toBe(false);
    expect(incomeFor(booking({ currency: null })).foreignCurrency).toBe(false);
  });

  it("taxes gross or payout per the year's rules", () => {
    const income = incomeFor(booking());
    expect(taxableCents(income, "gross")).toBe(56_000);
    expect(taxableCents(income, "payout")).toBe(49_075);
  });
});

describe("rentalBucketFor", () => {
  it("platform bookings count for the listing booked, with the stayed-in apartment alongside", () => {
    expect(rentalBucketFor({ channel: "airbnb", listingRentalIndex: 2, stayedRentalIndex: 4 })).toEqual({
      index: 2,
      source: "listing",
      stayedIndex: 4,
    });
  });

  it("platform bookings with an unmapped listing count nowhere", () => {
    expect(rentalBucketFor({ channel: "booking", listingRentalIndex: null, stayedRentalIndex: 1 })).toEqual({
      index: null,
      source: "none",
      stayedIndex: 1,
    });
  });

  it("direct bookings count for the apartment they stayed in", () => {
    expect(rentalBucketFor({ channel: "direct", listingRentalIndex: 3, stayedRentalIndex: 1 })).toMatchObject({
      index: 1,
      source: "stayed",
    });
    expect(rentalBucketFor({ channel: "direct", listingRentalIndex: 3, stayedRentalIndex: null })).toMatchObject({
      index: null,
      source: "none",
    });
  });

  it("a correction wins", () => {
    expect(
      rentalBucketFor({ channel: "airbnb", listingRentalIndex: 2, stayedRentalIndex: 9, overrideRentalIndex: 3 }),
    ).toEqual({ index: 3, source: "override", stayedIndex: null });
  });

  it("knows the four apartments", () => {
    expect([0, 1, 2, 3, 4, 5, "1", null].map(isRentalIndex)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
