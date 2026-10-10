/**
 * P1B-6: calendar.range, booking.move and booking.suggestions against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient, TURNOVER_TASK_TYPE } from "@stay-ops/db";
import { DomainError, isoDate } from "@stay-ops/domain";

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T09:00:00Z");

let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users"
    RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, capacity: number, large = false, isActive = true) {
  return prisma.room.create({
    data: {
      code: name.toLowerCase(),
      displayName: name,
      maxGuests: capacity,
      preferredForLargeParty: large,
      isActive,
      calendarSortIndex: seq++,
    },
  });
}

async function booking(
  guestName: string,
  checkin: string,
  checkout: string,
  extra: { adults?: number; status?: BookingStatus } = {},
) {
  seq += 1;
  return prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `ext-${seq}`,
      status: extra.status ?? BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 0,
      guestName,
      guestAdults: extra.adults ?? 2,
    },
  });
}

async function errorCode(promise: Promise<unknown>): Promise<{ code: string; params: unknown }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return { code: err.code, params: err.params };
    throw err;
  }
  throw new Error("expected a DomainError");
}

describe("calendar range and move command", () => {
  let actorId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
    actorId = (await prisma.user.create({ data: { email: `move-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });

  const move = async (input: {
    bookingId: string;
    roomId: string | null;
    expectedVersion: number;
    confirmStarted?: boolean;
  }) => {
    const { moveBooking } = await import("@/server/useCases/moveBooking");
    return moveBooking({ ...input, actorUserId: actorId }, NOW);
  };

  it("places a booking, records audit and turnover, and returns the new version", async () => {
    const onar = await room("Onar", 3);
    const b = await booking("Maria", "2030-07-01", "2030-07-05");
    const result = await move({ bookingId: b.id, roomId: onar.id, expectedVersion: 0 });
    expect(result.warnings).toEqual([]);
    expect(result.booking).toMatchObject({
      id: b.id,
      version: 1,
      nights: 4,
      assignment: { roomId: onar.id, pinned: true },
    });
    const db = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(db.version).toBe(result.booking.version);
    expect(await prisma.auditEvent.count({ where: { action: "booking.move", entityId: b.id } })).toBe(1);
    expect(
      await prisma.cleaningTask.count({ where: { bookingId: b.id, taskType: TURNOVER_TASK_TYPE, roomId: onar.id } }),
    ).toBe(1);
  });

  it("moves to another room, then takes it out again", async () => {
    const onar = await room("Onar", 3);
    const cosmos = await room("Cosmos", 4, true);
    const b = await booking("Maria", "2030-07-01", "2030-07-05");
    const placed = await move({ bookingId: b.id, roomId: onar.id, expectedVersion: 0 });
    const moved = await move({ bookingId: b.id, roomId: cosmos.id, expectedVersion: placed.booking.version });
    expect(moved.booking.assignment?.roomId).toBe(cosmos.id);
    const out = await move({ bookingId: b.id, roomId: null, expectedVersion: moved.booking.version });
    expect(out.booking.assignment).toBeNull();
    // The open cleaning is cancelled, not left to be done in an apartment nobody is in (E4-4).
    const tasks = await prisma.cleaningTask.findMany({ where: { bookingId: b.id, taskType: TURNOVER_TASK_TYPE } });
    expect(tasks.map((t) => t.status)).toEqual(["cancelled"]);
  });

  it("names the guest when the room is taken, and reports closed or inactive rooms", async () => {
    const onar = await room("Onar", 3);
    const iris = await room("Iris", 3, false, false);
    const nikos = await booking("Nikos P.", "2030-07-03", "2030-07-08");
    await move({ bookingId: nikos.id, roomId: onar.id, expectedVersion: 0 });
    const b = await booking("Maria", "2030-07-01", "2030-07-05");
    expect(await errorCode(move({ bookingId: b.id, roomId: onar.id, expectedVersion: 0 }))).toEqual({
      code: "ROOM_TAKEN",
      params: { guestName: "Nikos P." },
    });
    expect((await errorCode(move({ bookingId: b.id, roomId: iris.id, expectedVersion: 0 }))).code).toBe(
      "ROOM_INACTIVE",
    );

    const helios = await room("Helios", 4, true);
    await prisma.manualBlock.create({
      data: {
        roomId: helios.id,
        startDate: new Date("2030-06-30T00:00:00Z"),
        endDate: new Date("2030-07-02T00:00:00Z"),
      },
    });
    expect((await errorCode(move({ bookingId: b.id, roomId: helios.id, expectedVersion: 0 }))).code).toBe(
      "ROOM_CLOSED",
    );
  });

  it("treats a move sent again after its answer was lost as done (E2-7)", async () => {
    const onar = await room("Onar", 3);
    const cosmos = await room("Cosmos", 3);
    const b = await booking("Maria", "2030-07-01", "2030-07-05");
    const placed = await move({ bookingId: b.id, roomId: onar.id, expectedVersion: 0 });
    const again = await move({ bookingId: b.id, roomId: onar.id, expectedVersion: 0 });
    expect(again.booking.version).toBe(placed.booking.version);
    expect(again.booking.assignment?.roomId).toBe(onar.id);
    expect((await errorCode(move({ bookingId: b.id, roomId: cosmos.id, expectedVersion: 0 }))).code).toBe(
      "BOOKING_CHANGED",
    );
  });

  it("rejects a stale version, a pending booking and an unknown booking", async () => {
    const onar = await room("Onar", 3);
    const b = await booking("Maria", "2030-07-01", "2030-07-05");
    expect((await errorCode(move({ bookingId: b.id, roomId: onar.id, expectedVersion: 3 }))).code).toBe(
      "BOOKING_CHANGED",
    );
    const pending = await booking("Pending", "2030-07-10", "2030-07-12", { status: BookingStatus.pending });
    expect((await errorCode(move({ bookingId: pending.id, roomId: onar.id, expectedVersion: 0 }))).code).toBe(
      "NOT_CONFIRMED",
    );
    expect((await errorCode(move({ bookingId: "nope", roomId: onar.id, expectedVersion: 0 }))).code).toBe("NOT_FOUND");
  });

  it("asks before moving a guest who has arrived, and refuses a stay that is over", async () => {
    const onar = await room("Onar", 3);
    const cosmos = await room("Cosmos", 4, true);
    const here = await booking("Giorgos A.", "2030-06-08", "2030-06-12");
    const placed = await move({ bookingId: here.id, roomId: onar.id, expectedVersion: 0, confirmStarted: true });
    expect(
      await errorCode(move({ bookingId: here.id, roomId: cosmos.id, expectedVersion: placed.booking.version })),
    ).toEqual({
      code: "STAY_STARTED",
      params: { guestName: "Giorgos A.", roomName: "Onar" },
    });
    const moved = await move({
      bookingId: here.id,
      roomId: cosmos.id,
      expectedVersion: placed.booking.version,
      confirmStarted: true,
    });
    expect(moved.booking.assignment?.roomId).toBe(cosmos.id);

    const past = await booking("Past", "2030-06-01", "2030-06-10");
    expect((await errorCode(move({ bookingId: past.id, roomId: onar.id, expectedVersion: 0 }))).code).toBe(
      "STAY_ENDED",
    );
  });

  it("allows a party bigger than the room with a warning, and clears needs_reassignment", async () => {
    const onar = await room("Onar", 3);
    const b = await booking("Big family", "2030-07-01", "2030-07-05", {
      adults: 4,
      status: BookingStatus.needs_reassignment,
    });
    const result = await move({ bookingId: b.id, roomId: onar.id, expectedVersion: 0 });
    expect(result.warnings).toEqual(["OVER_CAPACITY"]);
    expect(result.booking.status).toBe(BookingStatus.confirmed);
  });

  it("lets exactly one of two racing moves into the same room win", async () => {
    const onar = await room("Onar", 3);
    const a = await booking("A", "2030-07-01", "2030-07-05");
    const b = await booking("B", "2030-07-03", "2030-07-06");
    const results = await Promise.allSettled([
      move({ bookingId: a.id, roomId: onar.id, expectedVersion: 0 }),
      move({ bookingId: b.id, roomId: onar.id, expectedVersion: 0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(DomainError);
    expect(["ROOM_TAKEN", "BOOKING_CHANGED"]).toContain((failed.reason as DomainError).code);
    expect(await prisma.assignment.count({ where: { roomId: onar.id } })).toBe(1);
  });

  it("returns the range with rooms in order, the tray and overbooked nights", async () => {
    const { getCalendarRange } = await import("@/server/useCases/calendarRange");
    const onar = await room("Onar", 3);
    await room("Cosmos", 4, true);
    const placed = await booking("Placed", "2030-06-28", "2030-07-03");
    await move({ bookingId: placed.id, roomId: onar.id, expectedVersion: 0 });
    const tray1 = await booking("Tray 1", "2030-07-01", "2030-07-04");
    await booking("Tray 2", "2030-07-02", "2030-07-03");
    await booking("Cancelled", "2030-07-02", "2030-07-03", { status: BookingStatus.cancelled });
    await booking("Outside", "2030-08-02", "2030-08-03");

    const range = await getCalendarRange(isoDate("2030-07-01"), isoDate("2030-08-01"), NOW);
    expect(range.today).toBe("2030-06-10");
    expect(range.rooms.map((r) => r.name)).toEqual(["Onar", "Cosmos"]);
    expect(range.bookings.map((b) => b.guestName)).toEqual(["Placed", "Tray 1", "Tray 2"]);
    expect(range.unassigned).toEqual([tray1.id, range.bookings[2]!.id]);
    expect(range.overbookedNights).toEqual(["2030-07-02"]);
  });

  it("adds the price per night only when asked (Dev mode)", async () => {
    const { getCalendarRange } = await import("@/server/useCases/calendarRange");
    const b = await booking("Priced", "2030-07-01", "2030-07-05");
    await prisma.booking.update({ where: { id: b.id }, data: { totalAmountCents: 40_000 } });
    await booking("Unpriced", "2030-07-02", "2030-07-04");
    const plain = await getCalendarRange(isoDate("2030-07-01"), isoDate("2030-08-01"), NOW);
    expect(plain.bookings.every((x) => x.nightlyCents === undefined)).toBe(true);
    const dev = await getCalendarRange(isoDate("2030-07-01"), isoDate("2030-08-01"), NOW, { withPrices: true });
    expect(dev.bookings.map((x) => [x.guestName, x.nightlyCents])).toEqual([
      ["Priced", 10_000],
      ["Unpriced", undefined],
    ]);
  });

  it("suggests rooms for the whole stay with the guest in the way", async () => {
    const { bookingSuggestions } = await import("@/server/useCases/bookingSuggestions");
    const onar = await room("Onar", 3);
    const cosmos = await room("Cosmos", 4, true);
    const helios = await room("Helios", 4, true);
    const nikos = await booking("Nikos P.", "2030-07-04", "2030-07-08");
    await move({ bookingId: nikos.id, roomId: cosmos.id, expectedVersion: 0 });
    const family = await booking("Family", "2030-06-28", "2030-07-06", { adults: 4 });
    const ranked = await bookingSuggestions(family.id);
    expect(ranked.map((r) => r.roomId)).toEqual([helios.id, onar.id, cosmos.id]);
    expect(ranked[0]).toMatchObject({
      recommended: true,
      reasons: expect.arrayContaining(["FITS_PARTY", "LARGE_PARTY_ROOM"]),
    });
    expect(ranked[1]!.warnings).toEqual(["OVER_CAPACITY"]);
    expect(ranked[2]).toMatchObject({ available: false, blockedByGuest: "Nikos P." });
  });
});
