import { describe, expect, it } from "vitest";
import { isoDate } from "../stay.js";
import {
  bucketOf,
  firstStays,
  nightsWithin,
  percentChange,
  statsPeriod,
  weekdayIndex,
  yearStats,
  type StatsBooking,
} from "../stats.js";

const booking = (checkin: string, checkout: string, extra: Partial<StatsBooking> = {}): StatsBooking => ({
  channel: "airbnb",
  kind: "stay",
  checkin: isoDate(checkin),
  checkout: isoDate(checkout),
  roomId: "a",
  incomeCents: 30_000,
  payoutCents: 25_000,
  feeCents: 5_000,
  bookedOn: null,
  adults: null,
  children: null,
  infants: null,
  guestKey: null,
  ...extra,
});

const YEAR = statsPeriod(2026, null);

describe("statsPeriod", () => {
  it("is the whole year without a day", () => {
    expect(YEAR).toEqual({ from: "2026-01-01", to: "2027-01-01" });
  });
  it("runs through the given day", () => {
    expect(statsPeriod(2026, { month: 3, day: 15 })).toEqual({ from: "2026-01-01", to: "2026-03-16" });
    expect(statsPeriod(2026, { month: 12, day: 31 })).toEqual({ from: "2026-01-01", to: "2027-01-01" });
  });
  it("runs 29 February into March in a year without it", () => {
    expect(statsPeriod(2025, { month: 2, day: 29 }).to).toBe("2025-03-02");
  });
});

describe("helpers", () => {
  it("buckets values by lower bound", () => {
    expect(bucketOf(1, [1, 2, 3, 4, 7, 14])).toBe(0);
    expect(bucketOf(5, [1, 2, 3, 4, 7, 14])).toBe(3);
    expect(bucketOf(30, [1, 2, 3, 4, 7, 14])).toBe(5);
  });
  it("counts nights inside a window", () => {
    const d = isoDate;
    expect(nightsWithin(d("2026-01-30"), d("2026-02-03"), d("2026-02-01"), d("2026-03-01"))).toBe(2);
    expect(nightsWithin(d("2026-04-01"), d("2026-04-03"), d("2026-02-01"), d("2026-03-01"))).toBe(0);
  });
  it("numbers weekdays from Monday", () => {
    expect(weekdayIndex(isoDate("2026-10-12"))).toBe(0); // Monday
    expect(weekdayIndex(isoDate("2026-10-18"))).toBe(6); // Sunday
  });
  it("gives the percent change", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 4)).toBeNull();
    expect(percentChange(4, null)).toBeNull();
  });
  it("remembers each guest's first stay only", () => {
    const first = firstStays([
      booking("2026-05-01", "2026-05-03", { guestKey: "g" }),
      booking("2025-05-01", "2025-05-03", { guestKey: "g" }),
      booking("2026-06-01", "2026-06-03", { guestKey: "g" }),
      booking("2024-01-01", "2024-01-03", { guestKey: "g", kind: "cancelled" }),
      booking("2024-01-01", "2024-01-03"),
    ]);
    expect([...first]).toEqual([["g", "2025-05-01"]]);
  });
});

describe("yearStats", () => {
  it("shares a stay that moved apartment between the apartments by night, counting it once", () => {
    const s = yearStats(
      [
        booking("2026-07-08", "2026-07-11", {
          pieces: [
            { roomId: "a", start: isoDate("2026-07-08"), end: isoDate("2026-07-09") },
            { roomId: "b", start: isoDate("2026-07-09"), end: isoDate("2026-07-11") },
          ],
        }),
      ],
      YEAR,
      ["a", "b"],
    );
    expect(s).toMatchObject({ bookings: 1, nights: 3, placedNights: 3, incomeCents: 30_000 });
    expect(s.byRoom).toEqual([
      { roomId: "a", bookings: 1, nights: 1, availableNights: 365, incomeCents: 10_000 },
      { roomId: "b", bookings: 0, nights: 2, availableNights: 365, incomeCents: 20_000 },
    ]);
    expect(s.byMonth[6]).toMatchObject({ nights: 3, placedNights: 3 });
  });

  it("adds up stays, nights, money and occupancy", () => {
    const s = yearStats(
      [
        booking("2026-07-01", "2026-07-04", { bookedOn: isoDate("2026-06-01"), adults: 2, children: 1, infants: 1 }),
        booking("2026-07-10", "2026-07-11", { roomId: "b", channel: "booking", adults: 1 }),
        booking("2026-08-01", "2026-08-08", { roomId: null, channel: "direct", feeCents: null, incomeCents: 70_000 }),
      ],
      YEAR,
      ["a", "b"],
    );
    expect(s).toMatchObject({
      bookings: 3,
      nights: 11,
      placedNights: 4,
      availableNights: 730,
      incomeCents: 130_000,
      payoutCents: 75_000,
      feeCents: 10_000,
      averageNightCents: Math.round(130_000 / 11),
      incomePerAvailableNightCents: Math.round(130_000 / 730),
      occupancyPercent: 1,
      averageStayNights: 3.7,
      averageLeadDays: 30,
      averageGuests: 2,
      adults: 3,
      children: 1,
      infants: 1,
      longestStayNights: 7,
      biggestBookingCents: 70_000,
      cancellations: 0,
      cancellationPercent: 0,
    });
    expect(s.byChannel.map((c) => [c.channel, c.bookings, c.nights])).toEqual([
      ["airbnb", 1, 3],
      ["booking", 1, 1],
      ["direct", 1, 7],
    ]);
    expect(s.byRoom).toEqual([
      { roomId: "a", bookings: 1, nights: 3, availableNights: 365, incomeCents: 30_000 },
      { roomId: "b", bookings: 1, nights: 1, availableNights: 365, incomeCents: 30_000 },
    ]);
    expect(s.byMonth[6]).toEqual({
      month: 7,
      bookings: 2,
      nights: 4,
      placedNights: 4,
      availableNights: 62,
      incomeCents: 60_000,
    });
    expect(s.byMonth[7]).toMatchObject({ bookings: 1, nights: 7, placedNights: 0, incomeCents: 70_000 });
    expect(s.stayLength).toEqual([1, 0, 1, 0, 1, 0]);
    expect(s.leadTime).toEqual([0, 0, 1, 0, 0]);
    expect(s.partySize).toEqual([1, 0, 1, 0, 0]);
    expect(s.checkinWeekday).toEqual([0, 0, 1, 0, 1, 1, 0]); // Wed, Fri, Sat
  });

  it("splits a stay across the year edge by night, and counts it by check-in", () => {
    const s = yearStats([booking("2025-12-30", "2026-01-02")], YEAR, ["a"]);
    expect(s).toMatchObject({ bookings: 0, nights: 1, incomeCents: 0 });
    expect(s.byRoom[0]).toMatchObject({ nights: 1, bookings: 0, incomeCents: 10_000 });
  });

  it("keeps cancellations and pending requests apart", () => {
    const s = yearStats(
      [
        booking("2026-03-01", "2026-03-03"),
        booking("2026-03-05", "2026-03-07", { kind: "cancelled", incomeCents: 5_000, payoutCents: 5_000 }),
        booking("2026-03-08", "2026-03-09", { kind: "pending" }),
        booking("2025-03-08", "2025-03-09", { kind: "pending" }),
      ],
      YEAR,
      ["a"],
    );
    expect(s).toMatchObject({
      bookings: 1,
      nights: 2,
      cancellations: 1,
      cancellationPercent: 50,
      cancelledIncomeCents: 5_000,
      incomeCents: 35_000,
      pending: 1,
    });
    expect(s.byChannel[0]).toMatchObject({ bookings: 1, cancellations: 1, incomeCents: 35_000 });
  });

  it("tells returning guests and counts each guest once", () => {
    const rows = [
      booking("2024-05-01", "2024-05-03", { guestKey: "maria" }),
      booking("2026-05-01", "2026-05-03", { guestKey: "maria" }),
      booking("2026-06-01", "2026-06-03", { guestKey: "maria" }),
      booking("2026-07-01", "2026-07-03", { guestKey: "nikos" }),
      booking("2026-08-01", "2026-08-03"),
    ];
    const s = yearStats(rows, YEAR, ["a"]);
    expect(s).toMatchObject({ distinctGuests: 2, returningStays: 2 });
    const firstYear = yearStats(rows, statsPeriod(2024, null), ["a"], new Map());
    expect(firstYear.returningStays).toBe(0);
  });

  it("only counts placed nights for apartments on offer, and skips empty stays", () => {
    const s = yearStats(
      [
        booking("2026-02-01", "2026-02-03", { roomId: "gone" }),
        booking("2026-02-05", "2026-02-05", { adults: 0, children: 0 }),
        booking("2026-09-05", "2026-09-06", { roomId: null, children: 1 }),
      ],
      YEAR,
      ["a"],
    );
    expect(s).toMatchObject({ nights: 3, placedNights: 0, bookings: 3, averageGuests: 0.5 });
    expect(s.partySize).toEqual([1, 0, 0, 0, 0]);
    expect(s.byRoom[0]!.bookings).toBe(1);
  });

  it("returns nulls when there is nothing to average", () => {
    const s = yearStats([], YEAR, []);
    expect(s).toMatchObject({
      averageNightCents: null,
      incomePerAvailableNightCents: null,
      occupancyPercent: null,
      averageStayNights: null,
      averageLeadDays: null,
      averageGuests: null,
      cancellationPercent: null,
    });
  });

  it("cuts the year at the given day", () => {
    const period = statsPeriod(2026, { month: 3, day: 15 });
    const s = yearStats([booking("2026-03-14", "2026-03-18"), booking("2026-04-01", "2026-04-03")], period, ["a"]);
    expect(s).toMatchObject({ bookings: 1, nights: 2, availableNights: 74 });
    expect(s.byMonth[2]!.availableNights).toBe(15);
    expect(s.byMonth[3]).toMatchObject({ availableNights: 0, nights: 0, bookings: 0 });
    // A booked-on day after check-in counts as 0 days ahead.
    const late = yearStats([booking("2026-03-01", "2026-03-02", { bookedOn: isoDate("2026-03-05") })], period, []);
    expect(late.averageLeadDays).toBe(0);
  });
});
