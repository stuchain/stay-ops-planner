/**
 * P2-3: edit the guest name, party size and notes of a booking; the edit survives a Hosthub sync,
 * reset brings Hosthub's value back, and the history reads the audit rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@stay-ops/db";
import { DomainError, isoDate } from "@stay-ops/domain";
import { applyHosthubBooking } from "@/server/sync/applyBooking";
import { getBookingDetails } from "@/server/useCases/bookingDetails";
import { resetBookingField, updateBookingDetails } from "@/server/useCases/bookingEdit";
import { bookingHistory } from "@/server/useCases/bookingHistory";
import { moveBooking } from "@/server/useCases/moveBooking";

const prisma = new PrismaClient();

type Reservation = Parameters<typeof applyHosthubBooking>[1]["dto"];

const reservation: Reservation = {
  reservationId: "edit-b1",
  listingId: "edit-l1",
  listingName: "Onar",
  status: "confirmed",
  checkIn: "2030-08-01",
  checkOut: "2030-08-05",
  listingChannel: "airbnb",
  guestName: "Hosthub Name",
  guestAdults: 2,
  guestTotal: 2,
  notes: "Hosthub note",
};

function sync(dto: Reservation, updated: number) {
  const raw = { ...dto, updated };
  return prisma.$transaction((tx) => applyHosthubBooking(tx, { dto, raw }));
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  throw new Error("expected a DomainError");
}

describe("booking details edit", () => {
  let actorId: string;
  let bookingId: string;
  let updated = 1_900_000_000;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings",
        "source_listings", "rooms", "users" RESTART IDENTITY CASCADE;
    `);
    actorId = (await prisma.user.create({ data: { email: `edit-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    await sync(reservation, (updated += 10));
    bookingId = (await prisma.booking.findFirstOrThrow({ where: { externalBookingId: "edit-b1" } })).id;
  });

  const version = async () => (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).version;
  const edit = async (fields: { guestName?: string; partySize?: number; notes?: string }) =>
    updateBookingDetails({ bookingId, expectedVersion: await version(), actorUserId: actorId, ...fields });

  it("an edit survives a sync, shows Hosthub's latest value, and reset restores it", async () => {
    await edit({ guestName: "Maria Papadopoulou", partySize: 5, notes: "Late arrival" });

    const edited = await getBookingDetails(bookingId);
    expect(edited.guestName).toBe("Maria Papadopoulou");
    expect(edited.partySize).toBe(5);
    expect(edited.notes).toBe("Late arrival");
    expect(edited.local.guestName).toEqual({ hosthub: "Hosthub Name" });
    expect(edited.local.partySize).toEqual({ hosthub: 2 });
    expect(edited.local.notes).toEqual({ hosthub: "Hosthub note" });

    // Hosthub sends a new payload: other fields follow it, the edited ones stay.
    await sync(
      { ...reservation, guestName: "Renamed In Hosthub", guestAdults: 3, guestTotal: 3, notes: "Newer note" },
      (updated += 10),
    );
    const afterSync = await getBookingDetails(bookingId);
    expect(afterSync.guestName).toBe("Maria Papadopoulou");
    expect(afterSync.partySize).toBe(5);
    expect(afterSync.notes).toBe("Late arrival");
    expect(afterSync.local.guestName).toEqual({ hosthub: "Renamed In Hosthub" });
    expect(afterSync.local.partySize).toEqual({ hosthub: 3 });
    expect(afterSync.local.notes).toEqual({ hosthub: "Newer note" });

    await resetBookingField({
      bookingId,
      field: "guestName",
      expectedVersion: afterSync.version,
      actorUserId: actorId,
    });
    await resetBookingField({
      bookingId,
      field: "partySize",
      expectedVersion: await version(),
      actorUserId: actorId,
    });
    await resetBookingField({ bookingId, field: "notes", expectedVersion: await version(), actorUserId: actorId });

    const reset = await getBookingDetails(bookingId);
    expect(reset.guestName).toBe("Renamed In Hosthub");
    expect(reset.partySize).toBe(3);
    expect(reset.notes).toBe("Newer note");
    expect(reset.local).toEqual({ guestName: null, partySize: null, notes: null });
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.localOverrides).toBeNull();
    expect(row.hosthubValues).toBeNull();

    // And a later sync is applied again.
    await sync({ ...reservation, guestName: "Third Name" }, (updated += 10));
    expect((await getBookingDetails(bookingId)).guestName).toBe("Third Name");
  });

  it("refuses a stale version and an empty name, and changes nothing", async () => {
    const v = await version();
    expect(
      await errorCode(
        updateBookingDetails({ bookingId, expectedVersion: v + 1, guestName: "X", actorUserId: actorId }),
      ),
    ).toBe("BOOKING_CHANGED");
    expect(await errorCode(edit({ guestName: "   " }))).toBe("VALIDATION");
    expect(await errorCode(edit({ partySize: 0 }))).toBe("VALIDATION");
    expect(
      await errorCode(resetBookingField({ bookingId, field: "notes", expectedVersion: v + 5, actorUserId: actorId })),
    ).toBe("BOOKING_CHANGED");
    expect(await version()).toBe(v);
  });

  it("typing Hosthub's own value again resets the field, and an unchanged save does nothing", async () => {
    await edit({ guestName: "Someone Else" });
    await edit({ guestName: "Hosthub Name" });
    expect((await getBookingDetails(bookingId)).local.guestName).toBeNull();
    const v = await version();
    await edit({ guestName: "Hosthub Name", partySize: 2 });
    expect(await version()).toBe(v);
  });

  it("clearing the notes is a change that sticks, and writes an audit row", async () => {
    await edit({ notes: "" });
    const details = await getBookingDetails(bookingId);
    expect(details.notes).toBeNull();
    expect(details.local.notes).toEqual({ hosthub: "Hosthub note" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "booking.details_edit" } });
    expect(audit.entityId).toBe(bookingId);
    expect(audit.userId).toBe(actorId);
    expect(audit.metaJson).toMatchObject({ fields: ["notes"] });
  });

  it("the calendar slice shows the local guest name and party size", async () => {
    await edit({ guestName: "Local Name", partySize: 4 });
    const { getCalendarRange } = await import("@/server/useCases/calendarRange");
    const range = await getCalendarRange(
      isoDate("2030-07-25"),
      isoDate("2030-08-10"),
      new Date("2030-07-20T09:00:00Z"),
    );
    const b = range.bookings.find((x) => x.id === bookingId);
    expect(b?.guestName).toBe("Local Name");
    expect(b?.partySize).toBe(4);
  });

  it("history lists moves, edits and resets as data, newest first", async () => {
    const onar = await prisma.room.create({
      data: { code: "onar", displayName: "Onar", maxGuests: 4, isActive: true },
    });
    const cosmos = await prisma.room.create({
      data: { code: "cosmos", displayName: "Cosmos", maxGuests: 4, isActive: true },
    });
    const now = new Date("2030-07-01T09:00:00Z");
    await moveBooking({ bookingId, roomId: onar.id, expectedVersion: await version(), actorUserId: actorId }, now);
    await moveBooking({ bookingId, roomId: cosmos.id, expectedVersion: await version(), actorUserId: actorId }, now);
    await edit({ guestName: "Local Name" });
    await resetBookingField({ bookingId, field: "guestName", expectedVersion: await version(), actorUserId: actorId });

    const history = await bookingHistory(bookingId);
    expect(history.map((h) => h.event)).toEqual([
      { kind: "reset", field: "guestName" },
      { kind: "edited", fields: ["guestName"] },
      { kind: "moved", from: "Onar", to: "Cosmos" },
      { kind: "moved", from: null, to: "Onar" },
      { kind: "created" },
    ]);
  });
});
