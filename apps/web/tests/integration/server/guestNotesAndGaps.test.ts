/**
 * Guest notes (saved on a booking, shown again when the same guest returns) and gap nights on the Today screen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import { setGuestNote } from "@/server/useCases/guestNote";
import { getPreviousStays } from "@/server/useCases/previousStays";
import { bookingHistory } from "@/server/useCases/bookingHistory";
import { getTodaySummary } from "@/server/useCases/todaySummary";

const prisma = new PrismaClient();
// Midday on 10 June 2030 in Athens.
const NOON = new Date("2030-06-10T12:00:00Z");
let seq = 0;
let actorUserId = "";

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users"
    RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string) {
  seq += 1;
  return prisma.room.create({
    data: { code: `g${seq}`, displayName: name, maxGuests: 4, isActive: true, calendarSortIndex: seq },
  });
}

async function booking(
  guestName: string,
  checkin: string,
  checkout: string,
  extra: { phone?: string; roomId?: string; guestNote?: string; status?: BookingStatus } = {},
) {
  seq += 1;
  const created = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `gn-${seq}`,
      status: extra.status ?? BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 0,
      guestName,
      guestPhone: extra.phone ?? null,
      guestAdults: 2,
      guestNote: extra.guestNote ?? null,
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

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await truncate();
  await prisma.$disconnect();
});
beforeEach(async () => {
  seq = 0;
  await truncate();
  actorUserId = (await prisma.user.create({ data: { email: `notes-${Date.now()}@example.com`, passwordHash: "x" } }))
    .id;
});

describe("setGuestNote", () => {
  it("saves, trims and clears the note, keeps the version, and writes one history line per change", async () => {
    const b = await booking("Maria Papadopoulou", "2030-06-01", "2030-06-04");
    expect(await setGuestNote({ bookingId: b.id, note: "  Πληρώνει με την άφιξη ", actorUserId })).toEqual({
      guestNote: "Πληρώνει με την άφιξη",
    });
    await setGuestNote({ bookingId: b.id, note: "Πληρώνει με την άφιξη", actorUserId });
    const saved = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(saved.guestNote).toBe("Πληρώνει με την άφιξη");
    expect(saved.version).toBe(b.version);

    expect(await setGuestNote({ bookingId: b.id, note: "   ", actorUserId })).toEqual({ guestNote: null });
    const history = await bookingHistory(b.id);
    expect(history.map((h) => h.event.kind)).toEqual(["guestNote", "guestNote"]);
  });

  it("refuses an unknown booking", async () => {
    await expect(setGuestNote({ bookingId: "nope", note: "x", actorUserId })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("guest notes when the guest comes back", () => {
  it("brings the note of an earlier stay with the same phone, and lists it on Today's arrivals", async () => {
    const onar = await room("Onar");
    await booking("Maria Papadopoulou", "2029-08-01", "2029-08-05", {
      phone: "+30 694 000 1111",
      roomId: onar.id,
      guestNote: "Θέλει επιπλέον πετσέτες",
    });
    const now = await booking("Maria P.", "2030-06-10", "2030-06-12", {
      phone: "6940001111",
      guestNote: "Έρχεται αργά",
    });

    const previous = await getPreviousStays(now.id);
    expect(previous.sure).toEqual([
      expect.objectContaining({ checkin: "2029-08-01", apartment: "Onar", note: "Θέλει επιπλέον πετσέτες" }),
    ]);

    const summary = await getTodaySummary(NOON, "Europe/Athens");
    expect(summary.arrivals.map((a) => a.guestNotes)).toEqual([["Έρχεται αργά", "Θέλει επιπλέον πετσέτες"]]);
  });
});

describe("gap nights on Today", () => {
  it("lists single empty nights between stays and closed periods in the coming weeks", async () => {
    const onar = await room("Onar");
    const iris = await room("Iris");
    // Onar: a 1-night gap on 13 June, then back-to-back, then a 2-night gap (can be booked, not flagged).
    await booking("A", "2030-06-09", "2030-06-13", { roomId: onar.id });
    const next = await booking("B", "2030-06-14", "2030-06-16", { roomId: onar.id });
    await booking("C", "2030-06-16", "2030-06-18", { roomId: onar.id });
    await booking("D", "2030-06-20", "2030-06-25", { roomId: onar.id });
    // Iris: a 1-night gap before a closed period; a cancelled stay does not fill it.
    const before = await booking("E", "2030-06-11", "2030-06-15", { roomId: iris.id });
    await booking("F", "2030-06-15", "2030-06-16", { roomId: iris.id, status: BookingStatus.cancelled });
    await prisma.manualBlock.create({
      data: { roomId: iris.id, startDate: new Date("2030-06-16T00:00:00Z"), endDate: new Date("2030-06-20T00:00:00Z") },
    });
    // A gap that is already over is not listed.
    await booking("G", "2030-06-01", "2030-06-05", { roomId: iris.id });
    await booking("H", "2030-06-06", "2030-06-11", { roomId: iris.id });

    const { gaps } = await getTodaySummary(NOON, "Europe/Athens");
    expect(gaps).toEqual([
      {
        room: expect.objectContaining({ name: "Onar" }),
        start: "2030-06-13",
        end: "2030-06-14",
        nights: 1,
        bookingId: next.id,
      },
      {
        room: expect.objectContaining({ name: "Iris" }),
        start: "2030-06-15",
        end: "2030-06-16",
        nights: 1,
        bookingId: before.id,
      },
    ]);
  });
});
