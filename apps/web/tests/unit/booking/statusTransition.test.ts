import { describe, expect, it } from "vitest";
import { BookingStatus } from "@stay-ops/db";
import {
  assertBookingStatusTransition,
  InvalidBookingStatusTransitionError,
} from "@/modules/booking/statusTransition";

describe("assertBookingStatusTransition", () => {
  it("allows no-op when status unchanged", () => {
    expect(() => assertBookingStatusTransition(BookingStatus.confirmed, BookingStatus.confirmed)).not.toThrow();
  });

  it("rejects cancelled to any non-cancelled", () => {
    expect(() => assertBookingStatusTransition(BookingStatus.cancelled, BookingStatus.confirmed)).toThrow(
      InvalidBookingStatusTransitionError,
    );
  });

  it("allows pending to confirmed and cancelled", () => {
    expect(() => assertBookingStatusTransition(BookingStatus.pending, BookingStatus.confirmed)).not.toThrow();
    expect(() => assertBookingStatusTransition(BookingStatus.pending, BookingStatus.cancelled)).not.toThrow();
    expect(() => assertBookingStatusTransition(BookingStatus.pending, BookingStatus.needs_reassignment)).toThrow();
  });

  it("allows confirmed to cancelled and needs_reassignment", () => {
    expect(() => assertBookingStatusTransition(BookingStatus.confirmed, BookingStatus.cancelled)).not.toThrow();
    expect(() => assertBookingStatusTransition(BookingStatus.confirmed, BookingStatus.needs_reassignment)).not.toThrow();
    expect(() => assertBookingStatusTransition(BookingStatus.confirmed, BookingStatus.pending)).toThrow();
  });

  it("allows needs_reassignment to confirmed and cancelled", () => {
    expect(() =>
      assertBookingStatusTransition(BookingStatus.needs_reassignment, BookingStatus.confirmed),
    ).not.toThrow();
    expect(() =>
      assertBookingStatusTransition(BookingStatus.needs_reassignment, BookingStatus.cancelled),
    ).not.toThrow();
    expect(() =>
      assertBookingStatusTransition(BookingStatus.needs_reassignment, BookingStatus.pending),
    ).toThrow();
  });
});
