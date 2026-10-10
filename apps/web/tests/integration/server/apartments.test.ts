/**
 * P2-5: the Dev mode Apartments table against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T09:00:00Z");
let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms",
      "source_listings", "users" RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, data: { isActive?: boolean; maxGuests?: number | null; color?: string | null } = {}) {
  return prisma.room.create({
    data: {
      code: `rental-${name.toLowerCase()}`,
      displayName: name,
      maxGuests: data.maxGuests === undefined ? 3 : data.maxGuests,
      color: data.color === undefined ? "#336699" : data.color,
      isActive: data.isActive ?? true,
      calendarSortIndex: seq++,
    },
  });
}

async function placed(roomId: string, checkin: string, checkout: string, status = BookingStatus.confirmed) {
  seq += 1;
  const b = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `ext-${seq}`,
      status,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 0,
      guestName: "Guest",
    },
  });
  await prisma.assignment.create({
    data: { bookingId: b.id, roomId, startDate: b.checkinDate, endDate: b.checkoutDate },
  });
  return b;
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return { code: err.code, params: err.params };
    throw err;
  }
  throw new Error("expected a DomainError");
}

describe("Dev mode apartments", () => {
  let actorUserId: string;
  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => {
    await truncate();
    actorUserId = (await prisma.user.create({ data: { email: `admin-${Date.now()}@example.com`, passwordHash: "x" } }))
      .id;
  });

  it("lists every apartment in calendar order with its rental, upcoming bookings and setup state", async () => {
    const { listApartments } = await import("@/server/useCases/apartments");
    const onar = await room("Onar");
    const fresh = await room("New rental", { isActive: false, maxGuests: null, color: null });
    await prisma.sourceListing.create({
      data: { channel: Channel.airbnb, externalListingId: onar.code!, title: "Onar studio" },
    });
    await placed(onar.id, "2030-06-09", "2030-06-12");
    await placed(onar.id, "2030-05-01", "2030-05-03"); // over
    const rows = await listApartments(NOW);
    expect(rows.map((r) => r.id)).toEqual([onar.id, fresh.id]);
    expect(rows[0]).toMatchObject({
      name: "Onar",
      rental: { id: "rental-onar", title: "Onar studio" },
      upcomingBookings: 1,
      needsSetup: false,
    });
    expect(rows[1]).toMatchObject({ needsSetup: true, isActive: false, upcomingBookings: 0 });
  });

  it("saves changes with an audit event", async () => {
    const { updateApartment } = await import("@/server/useCases/apartments");
    const fresh = await room("New rental", { isActive: false, maxGuests: null, color: null });
    const row = await updateApartment(
      {
        id: fresh.id,
        patch: { name: "Iris", color: "#aa3366", capacity: 3, preferredForLargeParty: false, isActive: true },
        actorUserId,
      },
      NOW,
    );
    expect(row).toMatchObject({ name: "Iris", color: "#aa3366", capacity: 3, isActive: true, needsSetup: false });
    expect(await prisma.auditEvent.count({ where: { action: "room.update", entityId: fresh.id } })).toBe(1);
  });

  it("refuses to take an apartment out of use while bookings are placed in it", async () => {
    const { updateApartment } = await import("@/server/useCases/apartments");
    const onar = await room("Onar");
    await placed(onar.id, "2030-06-20", "2030-06-25");
    await placed(onar.id, "2030-07-01", "2030-07-02");
    expect(await codeOf(updateApartment({ id: onar.id, patch: { isActive: false }, actorUserId }, NOW))).toEqual({
      code: "ROOM_HAS_BOOKINGS",
      params: { count: 2 },
    });
    // Bookings that already ended do not block it.
    const cosmos = await room("Cosmos");
    await placed(cosmos.id, "2030-05-01", "2030-05-04");
    await expect(
      updateApartment({ id: cosmos.id, patch: { isActive: false }, actorUserId }, NOW),
    ).resolves.toMatchObject({
      isActive: false,
    });
  });

  it("reorders, and refuses a stale list", async () => {
    const { listApartments, reorderApartments } = await import("@/server/useCases/apartments");
    const a = await room("A");
    const b = await room("B");
    const c = await room("C");
    await reorderApartments({ ids: [c.id, a.id, b.id], actorUserId });
    expect((await listApartments(NOW)).map((r) => r.name)).toEqual(["C", "A", "B"]);
    expect(await codeOf(reorderApartments({ ids: [a.id, b.id], actorUserId }))).toMatchObject({
      code: "CHANGED_MEANWHILE",
    });
  });

  it("is admin-only through the API, whatever the Dev mode switch says", async () => {
    const { appRouter } = await import("@/server/api/root");
    await room("Onar");
    const as = (role: "admin" | "operator" | "viewer") =>
      appRouter.createCaller({ headers: new Headers(), user: { userId: actorUserId, role, sessionExpiresAt: NOW } });
    await expect(as("admin").dev.apartments.list()).resolves.toHaveLength(1);
    await expect(as("operator").dev.apartments.list()).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(as("viewer").dev.apartments.reorder({ ids: ["x"] })).rejects.toMatchObject({ message: "FORBIDDEN" });
  });
});
