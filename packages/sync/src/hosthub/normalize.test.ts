import { describe, expect, it } from "vitest";
import {
  coerceHosthubDateField,
  normalizeHosthubReservationPagePayload,
  normalizeHosthubReservationRecord,
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
    expect(page?.nextCursor).toBe("next");
  });
});
