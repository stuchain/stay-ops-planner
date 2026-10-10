import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@stay-ops/db";
import {
  createAssignment,
  createBooking,
  createPlacedBooking,
  createRoom,
  createUser,
} from "../../factories";

describe("test factories", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates users with unique emails and overridable fields", async () => {
    const a = await createUser(prisma);
    const b = await createUser(prisma, { role: "admin" });
    expect(a.email).not.toBe(b.email);
    expect(a.role).toBe("operator");
    expect(b.role).toBe("admin");
    expect(a.passwordHash).not.toBe("password1234");
  });

  it("creates rooms with unique codes", async () => {
    const a = await createRoom(prisma);
    const b = await createRoom(prisma, { displayName: "Custom", maxGuests: 2 });
    expect(a.code).not.toBe(b.code);
    expect(b.displayName).toBe("Custom");
    expect(b.maxGuests).toBe(2);
  });

  it("creates bookings from YYYY-MM-DD dates with derived nights", async () => {
    const a = await createBooking(prisma, { checkinDate: "2031-01-10", checkoutDate: "2031-01-13" });
    const b = await createBooking(prisma, { channel: "airbnb", status: "pending" });
    expect(a.checkinDate.toISOString().slice(0, 10)).toBe("2031-01-10");
    expect(a.nights).toBe(3);
    expect(a.externalBookingId).not.toBe(b.externalBookingId);
    expect(b.channel).toBe("airbnb");
    expect(b.status).toBe("pending");
  });

  it("creates assignments linking a booking to a room", async () => {
    const room = await createRoom(prisma);
    const user = await createUser(prisma);
    const booking = await createBooking(prisma, {
      checkinDate: "2031-02-01",
      checkoutDate: "2031-02-03",
    });
    const assignment = await createAssignment(prisma, {
      bookingId: booking.id,
      roomId: room.id,
      startDate: booking.checkinDate,
      endDate: booking.checkoutDate,
      createdById: user.id,
    });
    expect(assignment.roomId).toBe(room.id);
    expect(assignment.createdById).toBe(user.id);
  });

  it("creates a booking already placed in a room", async () => {
    const room = await createRoom(prisma);
    const { booking, assignment } = await createPlacedBooking(prisma, room.id, {
      checkinDate: "2031-03-05",
      checkoutDate: "2031-03-08",
    });
    expect(assignment.bookingId).toBe(booking.id);
    expect(assignment.startDate.toISOString().slice(0, 10)).toBe("2031-03-05");
    expect(assignment.endDate.toISOString().slice(0, 10)).toBe("2031-03-08");
  });
});
