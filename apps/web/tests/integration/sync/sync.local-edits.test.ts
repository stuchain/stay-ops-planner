/**
 * Hosthub sync must not undo what the user changed in the app (P0-6).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { applyHosthubReservation } from "@stay-ops/sync";
import { CookieJar } from "../cookieJar";

const email = "sync-local-edits@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops_test";

const prisma = new PrismaClient();

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
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let PATCH_BOOKING: (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route")).POST;
    PATCH_BOOKING = (await import("../../../src/app/api/bookings/[id]/route")).PATCH;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate();
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { email, passwordHash, isActive: true, role: "operator" } });
  });

  async function loginJar(): Promise<CookieJar> {
    const jar = new CookieJar();
    const res = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(res.status).toBe(200);
    jar.applySetCookieHeader(res);
    return jar;
  }

  it("guest name and guest count edited in the app survive the next sync", async () => {
    await applyHosthubReservation(prisma, reservation, { ...reservation });
    const booking = await prisma.booking.findFirstOrThrow({ where: { externalBookingId: "local-edit-b1" } });

    const jar = await loginJar();
    const res = await PATCH_BOOKING(
      new NextRequest(`http://localhost/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ editable: { guestName: "Corrected Name", totalGuests: 4 } }),
      }),
      { params: Promise.resolve({ id: booking.id }) },
    );
    expect(res.status).toBe(200);

    const edited = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(edited.localOverrides).toEqual({ guestName: true, guestTotal: true });
    expect(edited.rawPayload).toEqual(booking.rawPayload);

    await applyHosthubReservation(prisma, { ...reservation, guestAdults: 3 }, { ...reservation });

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.guestName).toBe("Corrected Name");
    expect(after.guestTotal).toBe(4);
    // Fields the user did not touch still follow Hosthub, and the change bumps the version.
    expect(after.guestAdults).toBe(3);
    expect(after.version).toBe(edited.version + 1);
  });

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
