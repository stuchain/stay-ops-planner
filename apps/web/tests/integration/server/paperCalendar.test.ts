/**
 * Filling in past apartments from the family's Excel calendar: the preview and saving what was ticked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import { applyPaperCalendar, previewPaperCalendar } from "@/server/useCases/paperCalendar";
import { paperCalendarWorkbook, type PaperEntry } from "../../fixtures/paperCalendarWorkbook";

const prisma = new PrismaClient();
const NOW = new Date("2030-09-01T09:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const APARTMENTS = ["Onar", "Cosmos", "Iris", "Helios"] as const;

let seq = 0;
let actorId: string;
let rooms: Record<(typeof APARTMENTS)[number], string>;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users"
    RESTART IDENTITY CASCADE;
  `);
}

async function booking(guestName: string, checkin: string, checkout: string, roomName?: (typeof APARTMENTS)[number]) {
  seq += 1;
  const b = await prisma.booking.create({
    data: {
      channel: Channel.airbnb,
      externalBookingId: `paper-${seq}`,
      status: BookingStatus.confirmed,
      checkinDate: day(checkin),
      checkoutDate: day(checkout),
      nights: 0,
      guestName,
    },
  });
  if (roomName) {
    await prisma.assignment.create({
      data: { bookingId: b.id, roomId: rooms[roomName], startDate: b.checkinDate, endDate: b.checkoutDate },
    });
  }
  return b;
}

/** `nights` cells for one guest in one apartment from `start`. */
function cells(apartment: 0 | 1 | 2 | 3, start: string, count: number, text: string): PaperEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const date = day(start);
    date.setUTCDate(date.getUTCDate() + i);
    return { date: date.toISOString().slice(0, 10), apartment, text };
  });
}

async function piecesOf(bookingId: string) {
  const rows = await prisma.assignment.findMany({ where: { bookingId }, orderBy: { startDate: "asc" } });
  const names = new Map(Object.entries(rooms).map(([name, id]) => [id, name]));
  return rows.map((r) => `${names.get(r.roomId)} ${r.startDate.toISOString().slice(5, 10)}`);
}

const ticked = (preview: Awaited<ReturnType<typeof previewPaperCalendar>>) =>
  preview.items
    .filter((i) => i.state === "new" || i.state === "change")
    .map((i) => ({
      bookingId: i.booking!.id,
      expectedVersion: i.booking!.version,
      pieces: i.proposed.map((p) => ({ roomId: p.roomId, start: p.start, end: p.end })),
    }));

describe("Excel calendar", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
    actorId = (await prisma.user.create({ data: { email: `paper-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    rooms = {} as typeof rooms;
    for (const [i, name] of APARTMENTS.entries()) {
      rooms[name] = (
        await prisma.room.create({ data: { code: name.toLowerCase(), displayName: name, calendarSortIndex: i } })
      ).id;
    }
  });

  it("previews the changes, then saves them, a guest who moved included, with no cleaning for past stays", async () => {
    const nentwig = await booking("Olaf Nentwig", "2030-07-01", "2030-07-05");
    const dirk = await booking("DIRK - LUT", "2030-07-10", "2030-07-14", "Onar");
    const same = await booking("Maria Hjortstam", "2030-07-20", "2030-07-22", "Iris");
    const notInExcel = await booking("Other Person", "2030-08-01", "2030-08-03");
    await booking("Future Guest", "2030-09-10", "2030-09-12");
    const file = await paperCalendarWorkbook(2030, [
      ...cells(1, "2030-07-01", 4, "NENTWING 2"),
      ...cells(1, "2030-07-10", 1, "DIRK"),
      ...cells(0, "2030-07-11", 3, "DIRK"),
      ...cells(2, "2030-07-20", 2, "HJORTWTAM 2"),
      ...cells(3, "2030-08-05", 2, "GHOST"),
      ...cells(3, "2030-09-10", 2, "FUTURE"),
    ]);

    const preview = await previewPaperCalendar(file, NOW);
    expect(preview.items.map((i) => [i.paperName, i.booking?.id ?? null, i.state, i.kind])).toEqual([
      ["NENTWING", nentwig.id, "new", "sure"],
      ["DIRK", dirk.id, "change", "sure"],
      ["HJORTWTAM", same.id, "same", "sure"],
      ["GHOST", null, "missing", null],
    ]);
    expect(preview.items[1]!.proposed.map((p) => `${p.roomName} ${p.start}`)).toEqual([
      "Cosmos 2030-07-10",
      "Onar 2030-07-11",
    ]);
    expect(preview.notInCalendar.map((b) => b.id)).toEqual([notInExcel.id]);
    // The preview changes nothing.
    expect(await piecesOf(nentwig.id)).toEqual([]);

    const result = await applyPaperCalendar(ticked(preview), actorId, NOW);
    expect(result).toEqual({ saved: 2, skipped: [] });
    expect(await piecesOf(nentwig.id)).toEqual(["Cosmos 07-01"]);
    expect(await piecesOf(dirk.id)).toEqual(["Cosmos 07-10", "Onar 07-11"]);
    expect(await piecesOf(same.id)).toEqual(["Iris 07-20"]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: dirk.id } })).version).toBe(1);
    expect(await prisma.cleaningTask.count()).toBe(0);
    const audit = await prisma.auditEvent.findMany({ where: { action: "booking.move" } });
    expect(audit.map((a) => (a.metaJson as { source: string }).source)).toEqual(["excel-calendar", "excel-calendar"]);

    // Uploading again finds nothing left to do.
    const again = await previewPaperCalendar(file, NOW);
    expect(again.items.filter((i) => i.state === "new" || i.state === "change")).toEqual([]);
  });

  it("swaps two guests' apartments in one go, and skips a stay that changed meanwhile or clashes", async () => {
    const a = await booking("Anna Alpha", "2030-07-01", "2030-07-05", "Onar");
    const b = await booking("Bruno Beta", "2030-07-01", "2030-07-05", "Cosmos");
    const c = await booking("Carla Gamma", "2030-07-10", "2030-07-12");
    const d = await booking("Dora Delta", "2030-07-20", "2030-07-22");
    await booking("Eva Epsilon", "2030-07-10", "2030-07-12", "Iris");
    await prisma.manualBlock.create({
      data: { roomId: rooms.Helios, startDate: day("2030-07-21"), endDate: day("2030-07-23") },
    });
    const file = await paperCalendarWorkbook(2030, [
      ...cells(1, "2030-07-01", 4, "ALPHA"),
      ...cells(0, "2030-07-01", 4, "BETA"),
      ...cells(2, "2030-07-10", 2, "GAMMA"),
      ...cells(3, "2030-07-20", 2, "DELTA"),
    ]);
    const preview = await previewPaperCalendar(file, NOW);
    const items = ticked(preview);
    expect(items).toHaveLength(4);
    await prisma.booking.update({ where: { id: d.id }, data: { version: 7 } });

    const result = await applyPaperCalendar(items, actorId, NOW);
    expect(result.saved).toBe(2);
    expect(result.skipped).toEqual([
      { bookingId: d.id, guestName: "Dora Delta", reason: "BOOKING_CHANGED" },
      { bookingId: c.id, guestName: "Carla Gamma", reason: "ROOM_TAKEN", otherGuest: "Eva Epsilon" },
    ]);
    expect(await piecesOf(a.id)).toEqual(["Cosmos 07-01"]);
    expect(await piecesOf(b.id)).toEqual(["Onar 07-01"]);
    expect(await piecesOf(c.id)).toEqual([]);

    // The closed nights stop Dora once her version is right.
    const retry = await applyPaperCalendar(
      [{ ...items.find((i) => i.bookingId === d.id)!, expectedVersion: 7 }],
      actorId,
      NOW,
    );
    expect(retry.skipped.map((s) => s.reason)).toEqual(["ROOM_CLOSED"]);
  });

  it("refuses pieces that do not cover the stay, and a booking that is gone or cancelled", async () => {
    const a = await booking("Anna Alpha", "2030-07-01", "2030-07-05");
    const cancelled = await booking("Carl Cancel", "2030-07-10", "2030-07-12");
    await prisma.booking.update({ where: { id: cancelled.id }, data: { status: BookingStatus.cancelled } });
    const result = await applyPaperCalendar(
      [
        {
          bookingId: a.id,
          expectedVersion: 0,
          pieces: [{ roomId: rooms.Onar, start: "2030-07-02", end: "2030-07-05" }],
        },
        {
          bookingId: cancelled.id,
          expectedVersion: 0,
          pieces: [{ roomId: rooms.Onar, start: "2030-07-10", end: "2030-07-12" }],
        },
        {
          bookingId: "gone",
          expectedVersion: 0,
          pieces: [{ roomId: rooms.Onar, start: "2030-07-10", end: "2030-07-12" }],
        },
      ] as never,
      actorId,
      NOW,
    );
    expect(result).toEqual({
      saved: 0,
      skipped: [
        { bookingId: a.id, guestName: "Anna Alpha", reason: "INVALID_STAY" },
        { bookingId: cancelled.id, guestName: "Carl Cancel", reason: "NOT_CONFIRMED" },
        { bookingId: "gone", guestName: null, reason: "NOT_FOUND" },
      ],
    });
  });

  it("says when the file is not the calendar or an apartment is missing", async () => {
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (err) {
        return err instanceof DomainError ? err.code : err;
      }
      return null;
    };
    expect(await code(previewPaperCalendar(Buffer.from("nope"), NOW))).toBe("NOT_A_CALENDAR");
    await prisma.room.update({ where: { id: rooms.Iris }, data: { code: "iris-old", displayName: "Ίρις" } });
    const file = await paperCalendarWorkbook(2030, cells(0, "2030-07-01", 2, "ANNA"));
    expect(await code(previewPaperCalendar(file, NOW))).toBe("CALENDAR_APARTMENT_MISSING");
  });
});
