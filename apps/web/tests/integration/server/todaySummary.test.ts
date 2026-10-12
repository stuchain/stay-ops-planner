/**
 * P2-2: today.summary (getTodaySummary) against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { getTodaySummary } from "../../../src/server/useCases/todaySummary";

const prisma = new PrismaClient();
// Midday on 10 June 2030 in Athens and UTC alike.
const NOON = new Date("2030-06-10T12:00:00Z");

let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users"
    RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, color: string | null = "#0F766E") {
  seq += 1;
  return prisma.room.create({
    data: { code: `r${seq}`, displayName: name, color, maxGuests: 4, isActive: true, calendarSortIndex: seq },
  });
}

async function booking(
  guestName: string,
  checkin: string,
  checkout: string,
  extra: { status?: BookingStatus; roomId?: string; adults?: number; children?: number } = {},
) {
  seq += 1;
  const created = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `ext-${seq}`,
      status: extra.status ?? BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 0,
      guestName,
      guestAdults: extra.adults ?? 2,
      guestChildren: extra.children ?? 0,
    },
  });
  if (extra.roomId) {
    await prisma.assignment.create({
      data: {
        bookingId: created.id,
        roomId: extra.roomId,
        startDate: created.checkinDate,
        endDate: created.checkoutDate,
      },
    });
  }
  return created;
}

const names = (stays: { guestName: string | null }[]) => stays.map((s) => s.guestName);

describe("getTodaySummary", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    seq = 0;
    await truncate();
  });

  it("returns an empty day", async () => {
    const summary = await getTodaySummary(NOON, "Europe/Athens");
    expect(summary).toEqual({
      today: "2030-06-10",
      tomorrow: "2030-06-11",
      arrivals: [],
      departures: [],
      tomorrowArrivals: [],
      tomorrowDepartures: [],
      needsApartment: 0,
      gaps: [],
    });
  });

  it("splits arrivals and departures of today and tomorrow, with apartment, nights and party", async () => {
    const onar = await room("Onar", "#0F766E");
    const cosmos = await room("Cosmos", null);
    const meltemi = await room("Meltemi", null);
    const zefiros = await room("Zefiros", null);
    const notos = await room("Notos", null);
    await booking("Arrives Today", "2030-06-10", "2030-06-13", { roomId: onar.id, adults: 2, children: 1 });
    await booking("Leaves Today", "2030-06-06", "2030-06-10", { roomId: cosmos.id });
    await booking("Arrives Tomorrow", "2030-06-11", "2030-06-12", { roomId: meltemi.id });
    await booking("Leaves Tomorrow", "2030-06-08", "2030-06-11", { roomId: zefiros.id });
    // Staying through: neither an arrival nor a departure.
    await booking("Stays Through", "2030-06-08", "2030-06-14", { roomId: notos.id });
    // Far away.
    await booking("Next Week", "2030-06-17", "2030-06-19", { roomId: onar.id });

    const summary = await getTodaySummary(NOON, "Europe/Athens");
    expect(names(summary.arrivals)).toEqual(["Arrives Today"]);
    expect(summary.arrivals[0]).toMatchObject({
      nights: 3,
      partySize: 3,
      status: "confirmed",
      checkin: "2030-06-10",
      checkout: "2030-06-13",
      room: { name: "Onar", color: "#0F766E" },
    });
    expect(names(summary.departures)).toEqual(["Leaves Today"]);
    expect(summary.departures[0]).toMatchObject({ nights: 4, room: { name: "Cosmos", color: null } });
    expect(names(summary.tomorrowArrivals)).toEqual(["Arrives Tomorrow"]);
    expect(names(summary.tomorrowDepartures)).toEqual(["Leaves Tomorrow"]);
    expect(summary.needsApartment).toBe(0);
  });

  it("leaves cancelled bookings out everywhere and keeps pending ones, marked pending", async () => {
    const onar = await room("Onar");
    await booking("Cancelled Arrival", "2030-06-10", "2030-06-12", { status: BookingStatus.cancelled });
    await booking("Cancelled Departure", "2030-06-08", "2030-06-10", {
      status: BookingStatus.cancelled,
      roomId: onar.id,
    });
    await booking("Cancelled Tomorrow", "2030-06-11", "2030-06-12", { status: BookingStatus.cancelled });
    await booking("Pending Arrival", "2030-06-10", "2030-06-12", { status: BookingStatus.pending });

    const summary = await getTodaySummary(NOON, "Europe/Athens");
    expect(names(summary.arrivals)).toEqual(["Pending Arrival"]);
    expect(summary.arrivals[0]?.status).toBe("pending");
    expect(summary.departures).toEqual([]);
    expect(summary.tomorrowArrivals).toEqual([]);
    expect(summary.needsApartment).toBe(1);
  });

  it("counts bookings that still need an apartment, as the calendar tray does", async () => {
    const onar = await room("Onar");
    await booking("Placed", "2030-06-12", "2030-06-14", { roomId: onar.id });
    await booking("Unplaced Soon", "2030-06-12", "2030-06-14");
    await booking("Unplaced Now", "2030-06-08", "2030-06-12");
    await booking("Unplaced Over Today", "2030-06-07", "2030-06-10");
    await booking("Unplaced Past", "2030-05-01", "2030-05-04");
    await booking("Unplaced Cancelled", "2030-06-12", "2030-06-14", { status: BookingStatus.cancelled });

    const summary = await getTodaySummary(NOON, "Europe/Athens");
    // Ends today or earlier does not count; unplaced arrivals show in the list with no apartment.
    expect(summary.needsApartment).toBe(2);
    expect(names(summary.departures)).toEqual(["Unplaced Over Today"]);
    expect(summary.departures[0]?.room).toBeNull();
  });

  it("decides the day in the business time zone, not UTC", async () => {
    await booking("Arrives 10th", "2030-06-10", "2030-06-12");
    await booking("Arrives 11th", "2030-06-11", "2030-06-13");

    // 22:30 UTC on the 10th is already 01:30 on the 11th in Athens (UTC+3 in summer).
    const lateEvening = new Date("2030-06-10T22:30:00Z");
    const athens = await getTodaySummary(lateEvening, "Europe/Athens");
    expect(athens.today).toBe("2030-06-11");
    expect(names(athens.arrivals)).toEqual(["Arrives 11th"]);
    expect(athens.tomorrow).toBe("2030-06-12");

    const utc = await getTodaySummary(lateEvening, "Etc/UTC");
    expect(utc.today).toBe("2030-06-10");
    expect(names(utc.arrivals)).toEqual(["Arrives 10th"]);
    expect(names(utc.tomorrowArrivals)).toEqual(["Arrives 11th"]);

    // 23:30 UTC on the 9th is 02:30 on the 10th in Athens.
    const earlyMorning = await getTodaySummary(new Date("2030-06-09T23:30:00Z"), "Europe/Athens");
    expect(earlyMorning.today).toBe("2030-06-10");
    expect(names(earlyMorning.arrivals)).toEqual(["Arrives 10th"]);
  });

  it("rolls over month and year ends for tomorrow", async () => {
    await booking("New Year Guest", "2031-01-01", "2031-01-03");
    const summary = await getTodaySummary(new Date("2030-12-31T12:00:00Z"), "Europe/Athens");
    expect(summary.tomorrow).toBe("2031-01-01");
    expect(names(summary.tomorrowArrivals)).toEqual(["New Year Guest"]);
  });
});
