import { describe, expect, it } from "vitest";
import {
  coerceHosthubDateField,
  mapStatusRaw,
  normalizeHosthubReservationPagePayload,
  normalizeHosthubReservationRecord,
  parseHosthubGenericDataList,
} from "./normalize.js";

describe("coerceHosthubDateField", () => {
  it("strips time from ISO strings", () => {
    expect(coerceHosthubDateField("2026-05-01T14:00:00.000Z")).toBe("2026-05-01");
  });
});

describe("normalizeHosthubReservationRecord", () => {
  it("maps snake_case Hosthub-style objects", () => {
    const row = normalizeHosthubReservationRecord({
      id: "res-1",
      rental_id: "list-9",
      status: "cancelled",
      check_in: "2026-07-01T00:00:00Z",
      check_out: "2026-07-05",
      channel: "airbnb",
    });
    expect(row).toEqual({
      reservationId: "res-1",
      listingId: "list-9",
      status: "cancelled",
      checkIn: "2026-07-01",
      checkOut: "2026-07-05",
      listingChannel: "airbnb",
    });
  });

  it("prefers calendar event id over reservation_id", () => {
    const row = normalizeHosthubReservationRecord({
      id: "evt-hosthub",
      reservation_id: "ch-999",
      type: "Booking",
      date_from: "2026-06-10",
      date_to: "2026-06-14",
      rental: { id: "rent-1", object: "Rental" },
      source: { name: "Booking.com", channel_type_code: "booking.com" },
    });
    expect(row).toMatchObject({
      reservationId: "evt-hosthub",
      listingId: "rent-1",
      checkIn: "2026-06-10",
      checkOut: "2026-06-14",
      listingChannel: "Booking.com",
    });
  });

  it("prefers listing.rental.id when top-level rental is absent", () => {
    const row = normalizeHosthubReservationRecord({
      id: "evt-2",
      type: "Booking",
      date_from: "2026-08-01",
      date_to: "2026-08-05",
      listing: { rental: { id: "rent-nested" }, listingId: "channel-listing-9" },
      source: { name: "Airbnb" },
    });
    expect(row).toMatchObject({
      listingId: "rent-nested",
    });
  });

  it("uses listing.rental_id when nested rental object has no id", () => {
    const row = normalizeHosthubReservationRecord({
      id: "evt-3",
      type: "Booking",
      date_from: "2026-09-01",
      date_to: "2026-09-03",
      listing: { rental_id: "rent-from-listing" },
      source: { name: "Booking.com" },
    });
    expect(row).toMatchObject({
      listingId: "rent-from-listing",
    });
  });

  it("returns null for Hold type", () => {
    expect(
      normalizeHosthubReservationRecord({
        id: "h1",
        type: "Hold",
        date_from: "2026-01-01",
        date_to: "2026-01-03",
        rental: { id: "r1" },
      }),
    ).toBeNull();
  });

  it("maps different reservation and listing id casing to the same canonical values", () => {
    const base = {
      type: "Booking",
      date_from: "2026-06-20",
      date_to: "2026-07-01",
      rental: { id: "rent-List-1" },
      source: { name: "Booking.com" },
    };
    const upperMix = normalizeHosthubReservationRecord({ ...base, id: "qamrr2jAmw" });
    const lower = normalizeHosthubReservationRecord({ ...base, id: "qamrr2jamw" });
    expect(upperMix).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(upperMix?.reservationId).toBe("qamrr2jamw");
    expect(upperMix?.reservationId).toBe(lower?.reservationId);
    expect(upperMix?.listingId).toBe("rent-list-1");
    expect(upperMix?.listingId).toBe(lower?.listingId);

    const listingCaseA = normalizeHosthubReservationRecord({
      ...base,
      id: "same-id",
      rental: { id: "Rent-ABC" },
    });
    const listingCaseB = normalizeHosthubReservationRecord({
      ...base,
      id: "same-id",
      rental: { id: "rent-abc" },
    });
    expect(listingCaseA?.listingId).toBe("rent-abc");
    expect(listingCaseA?.listingId).toBe(listingCaseB?.listingId);
  });

  it("maps is_visible false and cancelled_at to cancelled", () => {
    const hidden = normalizeHosthubReservationRecord({
      id: "b1",
      type: "Booking",
      date_from: "2026-02-01",
      date_to: "2026-02-05",
      rental: { id: "l1" },
      is_visible: false,
    });
    expect(hidden?.status).toBe("cancelled");

    const cancelledAt = normalizeHosthubReservationRecord({
      id: "b2",
      type: "Booking",
      date_from: "2026-02-01",
      date_to: "2026-02-05",
      rental: { id: "l1" },
      cancelled_at: "2026-01-15T10:00:00Z",
    });
    expect(cancelledAt?.status).toBe("cancelled");
  });
});

describe("parseHosthubGenericDataList", () => {
  it("reads rentals-style envelope with navigation.next", () => {
    const out = parseHosthubGenericDataList({
      object: "Rental",
      data: [{ id: "r1", name: "Cosmos" }],
      navigation: { next: "https://app.hosthub.com/api/2019-03-01/rentals?cursor_gt=abc" },
    });
    expect(out).not.toBeNull();
    expect(out?.data).toHaveLength(1);
    expect(out?.nextPageUrl).toContain("cursor_gt=abc");
  });
});

describe("normalizeHosthubReservationPagePayload", () => {
  it("reads reservations[] wrapper", () => {
    const page = normalizeHosthubReservationPagePayload({
      reservations: [
        {
          reservation_id: "a",
          listing_id: "b",
          status: "pending",
          check_in: "2026-01-01",
          check_out: "2026-01-03",
        },
      ],
      next_cursor: "next",
    });
    expect(page?.data).toHaveLength(1);
    expect(page?.data[0]?.reservationId).toBe("a");
    expect(page?.nextPageUrl).toBeNull();
    expect(page?.skipped).toBe(0);
  });

  it("reads navigation.next as nextPageUrl", () => {
    const page = normalizeHosthubReservationPagePayload({
      data: [],
      navigation: {
        next: "https://app.hosthub.com/api/2019-03-01/calendar-events?cursor_gt=x",
        previous: null,
      },
    });
    expect(page?.nextPageUrl).toBe(
      "https://app.hosthub.com/api/2019-03-01/calendar-events?cursor_gt=x",
    );
    expect(page?.skipped).toBe(0);
  });

  it("counts skipped rows (e.g. Hold)", () => {
    const page = normalizeHosthubReservationPagePayload({
      data: [
        {
          id: "b1",
          type: "Booking",
          date_from: "2026-01-01",
          date_to: "2026-01-03",
          rental: { id: "l1" },
        },
        {
          id: "h1",
          type: "Hold",
          date_from: "2026-02-01",
          date_to: "2026-02-02",
          rental: { id: "l1" },
        },
      ],
    });
    expect(page?.data).toHaveLength(1);
    expect(page?.skipped).toBe(1);
  });

  it("computes maxUpdated from raw items", () => {
    const page = normalizeHosthubReservationPagePayload({
      data: [
        {
          id: "b1",
          type: "Booking",
          date_from: "2026-01-01",
          date_to: "2026-01-03",
          rental: { id: "l1" },
          updated: 1700,
        },
        {
          id: "b2",
          type: "Booking",
          date_from: "2026-02-01",
          date_to: "2026-02-03",
          rental: { id: "l1" },
          updated: 1800,
        },
      ],
    });
    expect(page?.maxUpdated).toBe(1800);
  });
});

describe("mapStatusRaw", () => {
  const table: Array<[string, "confirmed" | "pending" | "cancelled"]> = [
    ["confirmed", "confirmed"],
    ["accepted", "confirmed"],
    ["Confirmed", "confirmed"],
    ["pending", "pending"],
    ["request", "pending"],
    ["requested", "pending"],
    ["inquiry", "pending"],
    ["awaiting_confirmation", "pending"],
    ["cancelled", "cancelled"],
    ["canceled", "cancelled"],
    ["declined", "cancelled"],
    ["expired", "cancelled"],
    ["rejected", "cancelled"],
    ["no-show-by-host", "cancelled"],
    ["cancelled_by_guest", "cancelled"],
    ["canceled_by_host", "cancelled"],
  ];
  it.each(table)("maps %s to %s without flagging", (raw, expected) => {
    expect(mapStatusRaw(raw)).toEqual({ status: expected });
  });

  it("maps an unknown value to pending and flags it", () => {
    expect(mapStatusRaw("checked_in_maybe")).toEqual({
      status: "pending",
      unknownStatusRaw: "checked_in_maybe",
    });
  });

  it("carries the flag onto the normalized record, but not when cancelled by other fields", () => {
    const base = { id: "r1", rental_id: "l1", check_in: "2026-07-01", check_out: "2026-07-05" };
    expect(normalizeHosthubReservationRecord({ ...base, status: "weird" })).toMatchObject({
      status: "pending",
      unknownStatusRaw: "weird",
    });
    const hidden = normalizeHosthubReservationRecord({ ...base, status: "weird", is_visible: false });
    expect(hidden?.status).toBe("cancelled");
    expect(hidden?.unknownStatusRaw).toBeUndefined();
  });
});
