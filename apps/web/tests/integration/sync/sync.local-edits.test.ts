/**
 * Hosthub sync must not undo what the user changed in the app (P0-6).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { applyHosthubBooking } from "../../../src/server/sync/applyBooking";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops_test";

const prisma = new PrismaClient();

type Reservation = Parameters<typeof applyHosthubBooking>[1]["dto"];

function applyHosthubReservation(db: PrismaClient, dto: Reservation, raw: unknown) {
  return db.$transaction((tx) => applyHosthubBooking(tx, { dto, raw }));
}

const reservation = {
  reservationId: "local-edit-b1",
  listingId: "local-edit-l1",
  listingName: "Onar",
  status: "confirmed" as const,
  checkIn: "2026-08-01",
  checkOut: "2026-08-05",
  listingChannel: "airbnb",
  guestName: "Hosthub Name",
  guestTotal: 2,
  guestAdults: 2,
};

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
      "audit_events",
      "assignments",
      "cleaning_tasks",
      "manual_blocks",
      "bookings",
      "source_listings",
      "rooms",
      "users"
    RESTART IDENTITY CASCADE;
  `);
}

describe("sync keeps the user's edits", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate();
  });

  /** What cancelling in the app records, so the next sync can tell whether Hosthub changed its mind. */
  async function cancelInApp(bookingId: string) {
    const existing = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await prisma.$transaction([
      prisma.assignment.deleteMany({ where: { bookingId } }),
      prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.cancelled,
          hosthubStatus: existing.hosthubStatus ?? existing.status,
          localOverrides: { status: true },
        },
      }),
    ]);
  }

  it("an unchanged sync does not bump the booking version", async () => {
    await applyHosthubReservation(prisma, reservation, { ...reservation });
    const first = await prisma.booking.findFirstOrThrow({ where: { externalBookingId: "local-edit-b1" } });
    await applyHosthubReservation(prisma, reservation, { ...reservation });
    const second = await prisma.booking.findUniqueOrThrow({ where: { id: first.id } });
    expect(second.version).toBe(first.version);
  });

  it("a renamed and switched-off apartment stays that way after sync", async () => {
    await applyHosthubReservation(prisma, reservation, { ...reservation });
    const room = await prisma.room.findFirstOrThrow({ where: { code: "local-edit-l1" } });
    await prisma.room.update({ where: { id: room.id }, data: { displayName: "Cosmos", isActive: false } });

    await applyHosthubReservation(prisma, reservation, { ...reservation });

    const after = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.displayName).toBe("Cosmos");
    expect(after.isActive).toBe(false);
  });

  it("an older Hosthub payload never overwrites newer data", async () => {
    await applyHosthubReservation(prisma, { ...reservation, status: "cancelled" }, { ...reservation, updated: 2_000 });
    await applyHosthubReservation(prisma, reservation, { ...reservation, updated: 1_000 });
    const row = await prisma.booking.findFirstOrThrow({ where: { externalBookingId: "local-edit-b1" } });
    expect(row.status).toBe(BookingStatus.cancelled);
    expect(row.hosthubUpdatedAt?.getTime()).toBe(2_000_000);
  });

  it("a cancel made in the app survives a sync with the same Hosthub data", async () => {
    await applyHosthubReservation(prisma, reservation, { ...reservation, updated: 1_000 });
    const booking = await prisma.booking.findFirstOrThrow({ where: { externalBookingId: "local-edit-b1" } });
    const room = await prisma.room.findFirstOrThrow({ where: { code: "local-edit-l1" } });
    await prisma.assignment.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        startDate: booking.checkinDate,
        endDate: booking.checkoutDate,
      },
    });

    await cancelInApp(booking.id);

    await applyHosthubReservation(prisma, reservation, { ...reservation, updated: 1_500 });
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { assignment: true },
    });
    expect(after.status).toBe(BookingStatus.cancelled);
    expect(after.assignment).toBeNull();
  });

  it("Hosthub wins again once its own status changes after an app cancel", async () => {
    await applyHosthubReservation(prisma, { ...reservation, status: "pending" }, { ...reservation });
    const booking = await prisma.booking.findFirstOrThrow({ where: { externalBookingId: "local-edit-b1" } });
    await cancelInApp(booking.id);

    await applyHosthubReservation(prisma, reservation, { ...reservation });
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe(BookingStatus.confirmed);
    expect(after.localOverrides).toBeNull();
  });

  it("keeps the needs-a-new-apartment flag when Hosthub still says confirmed", async () => {
    await applyHosthubReservation(prisma, reservation, { ...reservation });
    const booking = await prisma.booking.findFirstOrThrow({ where: { externalBookingId: "local-edit-b1" } });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.needs_reassignment },
    });

    await applyHosthubReservation(prisma, reservation, { ...reservation });

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe(BookingStatus.needs_reassignment);
    expect(after.channel).toBe(Channel.airbnb);
  });
});
