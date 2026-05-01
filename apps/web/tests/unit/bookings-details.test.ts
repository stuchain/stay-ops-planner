import { describe, expect, it } from "vitest";
import {
  bookingDetailFromModel,
  readCentsFromField,
  type BookingWithDetailRelations,
} from "@/modules/bookings/details";

const GITTE_RAW = {
  id: "azpkxe5gmr",
  type: "Booking",
  object: "CalendarEvent",
  date_from: "2026-05-01",
  date_to: "2026-05-09",
  nights: 8,
  booking_value: { cents: 96000, currency: "EUR" },
  cleaning_fee: { cents: 2000, currency: "EUR" },
  other_fees: { cents: 0, currency: "EUR" },
  total_value: { cents: 98800, currency: "EUR" },
  total_payout: { cents: 82583, currency: "EUR" },
  guest_paid: { cents: 98800, currency: "EUR" },
  payment_charges: { cents: 1580, currency: "EUR" },
  service_fee_host: { cents: 14637, currency: "EUR" },
  service_fee_guest: { cents: 0, currency: "EUR" },
  taxes: { cents: 0, currency: "EUR" },
  tax_channel_collected_host_remitted: { cents: 12219, currency: "EUR" },
  tax_channel_collected_channel_remitted: { cents: 0, currency: "EUR" },
  tax_host_collected_host_remitted: { cents: 0, currency: "EUR" },
  tax_channel_sponsored: { cents: 0, currency: "EUR" },
};

const PATRICK_RAW = {
  id: "bh5d1bazr2pbr2",
  type: "Booking",
  object: "CalendarEvent",
  date_from: "2026-06-03",
  date_to: "2026-06-09",
  nights: 6,
  booking_value: { cents: 78000, currency: "EUR" },
  cleaning_fee: { cents: 2000, currency: "EUR" },
  other_fees: { cents: 0, currency: "EUR" },
  taxes: { cents: 0, currency: "EUR" },
  total_value: { cents: 80000, currency: "EUR" },
  total_payout: { cents: 64624, currency: "EUR" },
  guest_paid: { cents: 80000, currency: "EUR" },
  payment_charges: null,
  service_fee_host: { cents: 15376, currency: "EUR" },
  service_fee_guest: { cents: 0, currency: "EUR" },
  service_fee_host_base: { cents: 12400, currency: "EUR" },
  service_fee_host_vat: { cents: 2976, currency: "EUR" },
  tax_channel_collected_host_remitted: { cents: 0, currency: "EUR" },
  tax_channel_collected_channel_remitted: { cents: 0, currency: "EUR" },
};

function mkBooking(over: Partial<BookingWithDetailRelations>): BookingWithDetailRelations {
  const now = new Date("2026-01-15T12:00:00.000Z");
  return {
    id: "booking-test-id",
    sourceListingId: null,
    channel: "booking",
    externalBookingId: "azpkxe5gmr",
    status: "confirmed",
    checkinDate: new Date("2026-05-01"),
    checkoutDate: new Date("2026-05-09"),
    nights: 8,
    guestName: "Gitte Symus",
    guestEmail: null,
    guestPhone: null,
    guestAdults: 2,
    guestChildren: 0,
    guestInfants: null,
    guestTotal: 2,
    totalAmountCents: 96000,
    currency: "EUR",
    cleaningFeeCents: 2000,
    taxCents: 0,
    payoutAmountCents: 82583,
    guestPaidCents: 98800,
    action: null,
    notes: null,
    hosthubCalendarEventRaw: null,
    hosthubNotesRaw: null,
    hosthubGrTaxesRaw: null,
    rawPayload: GITTE_RAW,
    createdAt: now,
    updatedAt: now,
    assignment: null,
    sourceListing: null,
    ...over,
  } as BookingWithDetailRelations;
}

describe("readCentsFromField", () => {
  it("reads cents from Hosthub money object", () => {
    const raw = GITTE_RAW as Record<string, unknown>;
    expect(readCentsFromField(raw, "booking_value")).toBe(960);
    expect(readCentsFromField(raw, "payment_charges")).toBe(15.8);
  });
});

describe("bookingDetailFromModel — Booking.com Hosthub money", () => {
  it("maps Gitte Symus-shaped payload and breakdowns", () => {
    const detail = bookingDetailFromModel(mkBooking({}));
    const { money } = detail;

    expect(money.bookingValue).toBe(960);
    expect(money.totalValue).toBe(988);
    expect(money.total).toBe(988);
    expect(money.extraTaxesByChannel).toBe(122.19);
    expect(money.serviceFeeHost).toBe(146.37);
    expect(money.paymentCharges).toBe(15.8);
    expect(money.payout).toBe(825.83);
    expect(money.guestPaid).toBe(988);
    expect(money.serviceFeeGuest).toBe(0);
    expect(money.cleaningFee).toBe(20);
    expect(money.otherFees).toBe(0);

    const nonZeroTax = money.taxBreakdown.filter((t) => t.amount !== 0);
    expect(nonZeroTax).toHaveLength(1);
    expect(nonZeroTax[0]?.key).toBe("tax_channel_collected_host_remitted");
    expect(nonZeroTax[0]?.amount).toBe(122.19);
    const taxSum = money.taxBreakdown.reduce((s, t) => s + t.amount, 0);
    expect(taxSum).toBeCloseTo(money.extraTaxesByChannel ?? 0, 5);

    expect(money.dailyBreakdown).toHaveLength(8);
    const dailySum = money.dailyBreakdown.reduce((s, d) => s + d.amount, 0);
    expect(dailySum).toBeCloseTo(960, 5);
    expect(money.dailyBreakdown[0]?.date).toBe("2026-05-01");
    expect(money.dailyBreakdown[7]?.date).toBe("2026-05-08");

    expect(money.extrasIncluded).toHaveLength(1);
    expect(money.extrasIncluded[0]?.label).toContain("Cleaning fee");
    expect(money.extrasIncluded[0]?.label).toContain("20.00");
  });

  it("leaves Hosthub-specific money fields empty for direct (non-Hosthub calendar) channel", () => {
    const detail = bookingDetailFromModel(
      mkBooking({
        channel: "direct",
        rawPayload: GITTE_RAW,
      }),
    );
    expect(detail.money.bookingValue).toBeNull();
    expect(detail.money.extraTaxesByChannel).toBeNull();
    expect(detail.money.serviceFeeGuest).toBeNull();
    expect(detail.money.taxBreakdown).toEqual([]);
    expect(detail.money.dailyBreakdown).toEqual([]);
    expect(detail.money.extrasIncluded).toEqual([]);
    expect(detail.money.totalValue).toBeNull();
  });
});

describe("bookingDetailFromModel — Airbnb Hosthub money", () => {
  it("maps Patrick Palmen-shaped payload", () => {
    const detail = bookingDetailFromModel(
      mkBooking({
        channel: "airbnb",
        externalBookingId: "bh5d1bazr2pbr2",
        guestName: "Patrick Palmen",
        checkinDate: new Date("2026-06-03"),
        checkoutDate: new Date("2026-06-09"),
        nights: 6,
        totalAmountCents: 78000,
        cleaningFeeCents: 2000,
        taxCents: 0,
        payoutAmountCents: 64624,
        guestPaidCents: 80000,
        rawPayload: PATRICK_RAW,
      }),
    );
    const { money } = detail;

    expect(money.bookingValue).toBe(780);
    expect(money.totalValue).toBe(800);
    expect(money.total).toBe(800);
    expect(money.taxes).toBe(0);
    expect(money.serviceFeeHost).toBe(153.76);
    expect(money.serviceFeeHostBase).toBe(124);
    expect(money.serviceFeeHostVat).toBe(29.76);
    expect(money.payout).toBe(646.24);
    expect(money.guestPaid).toBe(800);
    expect(money.serviceFeeGuest).toBe(0);
    expect(money.extraTaxesByChannel).toBeNull();
    expect(money.dailyBreakdown).toEqual([]);
    expect(money.taxBreakdown.every((t) => t.amount === 0)).toBe(true);
    expect(money.extrasIncluded).toHaveLength(1);
    expect(money.extrasIncluded[0]?.label).toContain("Cleaning fee");
    expect(money.extrasIncluded[0]?.label).toContain("20.00");
    expect((money.serviceFeeHostBase ?? 0) + (money.serviceFeeHostVat ?? 0)).toBeCloseTo(money.serviceFeeHost ?? 0, 5);
  });
});
