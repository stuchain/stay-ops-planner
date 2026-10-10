/**
 * P4-4: the data on the printable arrival cards, including notes pulled out of Hosthub's notes JSON.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient, type Prisma } from "@stay-ops/db";
import { extractNoteTexts, getArrivalCards, noteLines } from "@/server/useCases/arrivalCards";

const prisma = new PrismaClient();
let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms",
      "source_listings", "settings", "users" RESTART IDENTITY CASCADE;
  `);
}

async function booking(data: {
  guestName: string | null;
  checkin: string;
  checkout: string;
  roomId?: string;
  notes?: string;
  notesRaw?: Prisma.InputJsonValue;
  phone?: string;
  email?: string;
}) {
  seq += 1;
  return prisma.booking.create({
    data: {
      channel: Channel.airbnb,
      externalBookingId: `card-${seq}`,
      status: BookingStatus.confirmed,
      checkinDate: new Date(`${data.checkin}T00:00:00Z`),
      checkoutDate: new Date(`${data.checkout}T00:00:00Z`),
      nights: 3,
      guestName: data.guestName,
      guestPhone: data.phone ?? null,
      guestEmail: data.email ?? null,
      guestAdults: 2,
      guestChildren: 1,
      guestInfants: 1,
      notes: data.notes ?? null,
      ...(data.notesRaw ? { hosthubNotesRaw: data.notesRaw } : {}),
      ...(data.roomId
        ? {
            assignment: {
              create: {
                roomId: data.roomId,
                startDate: new Date(`${data.checkin}T00:00:00Z`),
                endDate: new Date(`${data.checkout}T00:00:00Z`),
              },
            },
          }
        : {}),
    },
  });
}

describe("extractNoteTexts", () => {
  it("takes the content of notes that are not deleted, oldest first", () => {
    expect(
      extractNoteTexts({
        data: [
          { status: "active", content: " Late arrival " },
          { status: "deleted", content: "Gone" },
          { content: "No status" },
          { status: "active", content: "   " },
          { status: "active", content: 42 },
          null,
        ],
      }),
    ).toEqual(["Late arrival", "No status"]);
  });

  it("gives nothing for shapes it does not know, and never raw JSON", () => {
    for (const raw of [null, undefined, "text", 5, {}, { data: "x" }, { foo: { content: "x" } }]) {
      expect(extractNoteTexts(raw)).toEqual([]);
    }
    expect(extractNoteTexts([{ content: "A plain array works" }])).toEqual(["A plain array works"]);
  });

  it("noteLines puts the booking note first and drops repeats", () => {
    expect(noteLines("Baby cot", { data: [{ content: "baby cot" }, { content: "Arrives 22:00" }] })).toEqual([
      "Baby cot",
      "Arrives 22:00",
    ]);
  });
});

describe("getArrivalCards", () => {
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

  it("returns one card per booking in check-in order, with guest, party, apartment, notes and earlier stays", async () => {
    const room = await prisma.room.create({
      data: { code: "rental-onar", displayName: "Onar", maxGuests: 4, isActive: true, calendarSortIndex: 1 },
    });
    const later = await booking({ guestName: "Zed Later", checkin: "2030-06-12", checkout: "2030-06-14" });
    const first = await booking({
      guestName: "Anna Smith",
      checkin: "2030-06-10",
      checkout: "2030-06-13",
      roomId: room.id,
      phone: " +30 691 234 5678 ",
      email: "anna@example.com",
      notes: "Needs a cot",
      notesRaw: { data: [{ status: "active", content: "Arrives by ferry at 21:30" }] },
    });
    await booking({ guestName: "A. Smith", checkin: "2029-08-01", checkout: "2029-08-05", phone: "6912345678" });

    const cards = await getArrivalCards([later.id, first.id, "unknown-id", first.id]);
    expect(cards.map((c) => c.guestName)).toEqual(["Anna Smith", "Zed Later"]);
    expect(cards[0]).toMatchObject({
      id: first.id,
      phone: "+30 691 234 5678",
      email: "anna@example.com",
      adults: 2,
      children: 1,
      infants: 1,
      partySize: 3,
      checkin: "2030-06-10",
      checkout: "2030-06-13",
      nights: 3,
      apartment: "Onar",
      channel: "airbnb",
      notes: ["Needs a cot", "Arrives by ferry at 21:30"],
    });
    expect(cards[0]!.previousStays.sure.map((s) => s.checkin)).toEqual(["2029-08-01"]);
    expect(cards[1]).toMatchObject({ apartment: null, phone: null, email: null, notes: [] });
  });
});
