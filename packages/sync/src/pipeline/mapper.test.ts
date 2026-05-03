import { describe, expect, it } from "vitest";
import { BookingStatus, Channel } from "@stay-ops/db";
import { mapHosthubListingChannel } from "./mapChannel.js";
import { mapHosthubBookingStatus } from "./bookingStatus.js";
import { extractHosthubReservationDto } from "./extractReservation.js";
import { nightsBetweenCheckinCheckout, parseDateOnlyUtc } from "./dates.js";

describe("mapHosthubListingChannel", () => {
  it("maps airbnb variants", () => {
    expect(mapHosthubListingChannel("Airbnb")).toBe(Channel.airbnb);
    expect(mapHosthubListingChannel("airbnb_extra")).toBe(Channel.airbnb);
  });
  it("maps booking variants", () => {
    expect(mapHosthubListingChannel("Booking.com")).toBe(Channel.booking);
    expect(mapHosthubListingChannel("booking.com")).toBe(Channel.booking);
    expect(mapHosthubListingChannel("BOOKING.COM")).toBe(Channel.booking);
    expect(mapHosthubListingChannel("booking")).toBe(Channel.booking);
    expect(mapHosthubListingChannel("Hotel booking")).toBe(Channel.booking);
  });
  it("does not map direct+booking phrases to booking.com (avoids distinct row collapse)", () => {
    expect(mapHosthubListingChannel("Direct booking")).toBe(Channel.direct);
    expect(mapHosthubListingChannel("Direct bookings")).toBe(Channel.direct);
    expect(mapHosthubListingChannel("Website bookings")).toBe(Channel.direct);
    expect(mapHosthubListingChannel("directbooking")).toBe(Channel.direct);
    expect(mapHosthubListingChannel("direct_booking")).toBe(Channel.direct);
  });
  it("keeps Booking.com even when the label also mentions website", () => {
    expect(mapHosthubListingChannel("Booking.com website")).toBe(Channel.booking);
  });
  it("defaults unknown to direct", () => {
    expect(mapHosthubListingChannel(undefined)).toBe(Channel.direct);
    expect(mapHosthubListingChannel("vrbo")).toBe(Channel.direct);
  });
});

describe("mapHosthubBookingStatus", () => {
  it("maps lifecycle values", () => {
    expect(mapHosthubBookingStatus("cancelled")).toBe(BookingStatus.cancelled);
    expect(mapHosthubBookingStatus("pending")).toBe(BookingStatus.pending);
    expect(mapHosthubBookingStatus("confirmed")).toBe(BookingStatus.confirmed);
  });
});

describe("extractHosthubReservationDto", () => {
  const row = {
    reservationId: "r1",
    listingId: "l1",
    status: "confirmed" as const,
    checkIn: "2026-05-01",
    checkOut: "2026-05-04",
  };

  it("parses top-level DTO", () => {
    expect(extractHosthubReservationDto(row)).toEqual(row);
  });

  it("parses nested reservation", () => {
    expect(extractHosthubReservationDto({ reservation: row })).toEqual(row);
  });

  it("parses snake_case nested reservation", () => {
    const snake = {
      reservation_id: "r-snake",
      listing_id: "l-snake",
      status: "confirmed",
      check_in: "2026-09-01",
      check_out: "2026-09-04",
    };
    expect(extractHosthubReservationDto({ reservation: snake })).toMatchObject({
      reservationId: "r-snake",
      listingId: "l-snake",
      checkIn: "2026-09-01",
      checkOut: "2026-09-04",
    });
  });

  it("parses nested calendar_event (Hosthub webhook shape)", () => {
    const cal = {
      id: "cal-nested-1",
      type: "Booking",
      date_from: "2026-10-01",
      date_to: "2026-10-05",
      rental: { id: "l-nested" },
      source: { name: "Airbnb" },
    };
    expect(extractHosthubReservationDto({ calendar_event: cal })).toMatchObject({
      reservationId: "cal-nested-1",
      listingId: "l-nested",
      checkIn: "2026-10-01",
      checkOut: "2026-10-05",
      listingChannel: "Airbnb",
    });
  });
});

describe("dates", () => {
  it("parses UTC date-only", () => {
    const d = parseDateOnlyUtc("2026-05-01");
    expect(d.toISOString().startsWith("2026-05-01")).toBe(true);
  });

  it("computes nights for checkout exclusive", () => {
    const inD = parseDateOnlyUtc("2026-05-01");
    const outD = parseDateOnlyUtc("2026-05-04");
    expect(nightsBetweenCheckinCheckout(inD, outD)).toBe(3);
  });
});
