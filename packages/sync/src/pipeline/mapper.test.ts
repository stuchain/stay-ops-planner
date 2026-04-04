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
