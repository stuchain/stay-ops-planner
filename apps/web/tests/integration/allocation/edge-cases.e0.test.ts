/**
 * E0-6: assigning clears "needs a new apartment". E0-9: switched-off apartments don't hide stays.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops_test";

const prisma = new PrismaClient();

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings",
      "source_listings", "rooms"
    RESTART IDENTITY CASCADE;
  `);
}

async function makeBooking(status: BookingStatus) {
  return prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `e0-${status}-${Math.random()}`,
      status,
      checkinDate: new Date("2026-08-10T00:00:00.000Z"),
      checkoutDate: new Date("2026-08-13T00:00:00.000Z"),
      nights: 3,
      guestName: "Edge Guest",
    },
  });
}

describe("Phase 0 edge cases", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
  });

  it("assigning a booking that needs a new apartment makes it confirmed again", async () => {
    const { assignBookingToRoom } = await import("../../../src/modules/allocation/service");
    const room = await prisma.room.create({ data: { code: "E0-A", displayName: "Onar", isActive: true } });
    const booking = await makeBooking(BookingStatus.needs_reassignment);

    await assignBookingToRoom({ bookingId: booking.id, roomId: room.id, actorUserId: "" });

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe(BookingStatus.confirmed);
    expect(after.version).toBe(booking.version + 1);
  });

  it("a switched-off apartment still shows with its stays in the month view", async () => {
    const { getCalendarMonthAggregate } = await import("../../../src/modules/calendar/monthAggregate");
    const room = await prisma.room.create({ data: { code: "E0-B", displayName: "Cosmos", isActive: true } });
    const idle = await prisma.room.create({ data: { code: "E0-C", displayName: "Iris", isActive: false } });
    const booking = await makeBooking(BookingStatus.confirmed);
    await prisma.assignment.create({
      data: { bookingId: booking.id, roomId: room.id, startDate: booking.checkinDate, endDate: booking.checkoutDate },
    });
    await prisma.room.update({ where: { id: room.id }, data: { isActive: false } });

    const month = await getCalendarMonthAggregate({ yearMonth: "2026-08", timeZone: "Etc/UTC" });

    expect(month.rooms.map((r) => r.id)).toContain(room.id);
    expect(month.rooms.find((r) => r.id === room.id)?.isActive).toBe(false);
    // An inactive apartment with nothing booked stays hidden.
    expect(month.rooms.map((r) => r.id)).not.toContain(idle.id);
    const item = month.items.find((i) => i.kind === "booking" && i.id === booking.id);
    expect(item && item.kind === "booking" ? item.roomId : null).toBe(room.id);
  });
});
