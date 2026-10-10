/**
 * P4-9: checkAvailability ("Ποιο είναι ελεύθερο;") against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import type { IsoDate } from "@stay-ops/domain";
import { checkAvailability } from "../../../src/server/useCases/availability";

const prisma = new PrismaClient();
const d = (s: string) => s as IsoDate;

let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users"
    RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, maxGuests = 4, extra: { isActive?: boolean } = {}) {
  seq += 1;
  return prisma.room.create({
    data: {
      code: `r${seq}`,
      displayName: name,
      color: "#0F766E",
      maxGuests,
      isActive: extra.isActive ?? true,
      calendarSortIndex: seq,
    },
  });
}

async function booking(
  guestName: string,
  checkin: string,
  checkout: string,
  extra: { status?: BookingStatus; roomId?: string } = {},
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
      guestAdults: 2,
      guestChildren: 0,
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

describe("checkAvailability", () => {
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

  it("lists free apartments first (one recommended) and busy ones with the reason", async () => {
    const onar = await room("Onar");
    await room("Cosmos");
    await room("Iris", 4, { isActive: false });
    const helios = await room("Helios");
    await booking("Nikos P", "2030-06-10", "2030-06-14", { roomId: onar.id });
    await prisma.manualBlock.create({
      data: {
        roomId: helios.id,
        startDate: new Date("2030-06-11T00:00:00Z"),
        endDate: new Date("2030-06-12T00:00:00Z"),
        reason: "paint",
      },
    });

    const result = await checkAvailability(d("2030-06-11"), d("2030-06-13"), 2);
    const free = result.rooms.filter((r) => r.available);
    expect(free.map((r) => r.name)).toEqual(["Cosmos"]);
    expect(free[0]?.recommended).toBe(true);
    expect(result.rooms.slice(0, free.length)).toEqual(free);
    const byName = Object.fromEntries(result.rooms.map((r) => [r.name, r]));
    expect(byName.Onar).toMatchObject({ available: false, blockedByGuest: "Nikos P" });
    expect(byName.Helios).toMatchObject({ available: false, blockedByGuest: null });
    expect(byName.Helios?.reasons).toContain("ROOM_CLOSED");
    expect(byName.Iris?.reasons).toContain("ROOM_INACTIVE");
    expect(result.unassignedBookings).toBe(0);
  });

  it("lets stays touch back to back, and warns about a small apartment", async () => {
    const small = await room("Small", 2);
    const onar = await room("Onar");
    await booking("Leaving", "2030-06-08", "2030-06-11", { roomId: onar.id });
    await booking("Arriving", "2030-06-13", "2030-06-15", { roomId: small.id });

    const result = await checkAvailability(d("2030-06-11"), d("2030-06-13"), 4);
    expect(result.rooms.every((r) => r.available)).toBe(true);
    const smallRoom = result.rooms.find((r) => r.name === "Small");
    expect(smallRoom?.warnings).toContain("OVER_CAPACITY");
    expect(smallRoom?.capacity).toBe(2);
    expect(result.rooms.filter((r) => r.recommended)).toHaveLength(1);
    expect(result.rooms[0]).toMatchObject({ name: "Onar", recommended: true });
  });

  it("works without a guest count", async () => {
    await room("Onar");
    const result = await checkAvailability(d("2030-06-11"), d("2030-06-12"), null);
    expect(result.guests).toBeNull();
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0]?.available).toBe(true);
  });

  it("counts confirmed bookings without an apartment on those dates, and nothing else", async () => {
    await room("Onar");
    await booking("No Room", "2030-06-10", "2030-06-12");
    await booking("Needs Move", "2030-06-12", "2030-06-20", { status: BookingStatus.needs_reassignment });
    await booking("Pending", "2030-06-10", "2030-06-12", { status: BookingStatus.pending });
    await booking("Cancelled", "2030-06-10", "2030-06-12", { status: BookingStatus.cancelled });
    // Ends the day the enquiry starts / starts the day it ends: no overlap.
    await booking("Before", "2030-06-08", "2030-06-11");
    await booking("Later", "2030-06-13", "2030-06-15");

    const result = await checkAvailability(d("2030-06-11"), d("2030-06-13"), 2);
    expect(result.unassignedBookings).toBe(2);
  });

  it("is not blocked by a pending booking: only assignments and closed periods occupy", async () => {
    await room("Onar");
    await booking("Pending", "2030-06-10", "2030-06-14", { status: BookingStatus.pending });
    const result = await checkAvailability(d("2030-06-11"), d("2030-06-13"), 2);
    expect(result.rooms[0]?.available).toBe(true);
  });
});
