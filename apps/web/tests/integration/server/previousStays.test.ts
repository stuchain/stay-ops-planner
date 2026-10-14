/**
 * P4-13: earlier stays of a returning guest, matched by phone or e-mail (sure) or by name alone (maybe).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import { getPreviousStays, matchPreviousStays, nameKey, phoneKey } from "@/server/useCases/previousStays";

const prisma = new PrismaClient();
let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms",
      "source_listings", "settings", "users" RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string) {
  seq += 1;
  return prisma.room.create({
    data: {
      code: `rental-${name.toLowerCase()}`,
      displayName: name,
      maxGuests: 4,
      isActive: true,
      calendarSortIndex: seq,
    },
  });
}

async function booking(
  guestName: string | null,
  checkin: string,
  checkout: string,
  extra: {
    phone?: string;
    email?: string;
    status?: BookingStatus;
    roomId?: string;
  } = {},
) {
  seq += 1;
  return prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `prev-${seq}`,
      status: extra.status ?? BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 3,
      guestName,
      guestPhone: extra.phone ?? null,
      guestEmail: extra.email ?? null,
      guestAdults: 2,
      guestTotal: 2,
      ...(extra.roomId
        ? {
            assignments: {
              create: {
                roomId: extra.roomId,
                startDate: new Date(`${checkin}T00:00:00Z`),
                endDate: new Date(`${checkout}T00:00:00Z`),
              },
            },
          }
        : {}),
    },
  });
}

describe("matching helpers", () => {
  it("compares the last 10 digits of a phone and ignores short numbers", () => {
    expect(phoneKey("+30 691 234 5678")).toBe("6912345678");
    expect(phoneKey("0030-6912345678")).toBe("6912345678");
    expect(phoneKey("123456")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it("ignores case, accents and final sigma in names, and needs two words", () => {
    expect(nameKey("  Μαρία  Παπαδοπούλος ")).toBe(nameKey("ΜΑΡΙΑ ΠΑΠΑΔΟΠΟΥΛΟΣ"));
    expect(nameKey("José García")).toBe("jose garcia");
    expect(nameKey("Maria")).toBeNull();
  });

  it("does not match on phone or e-mail that are missing on both sides", () => {
    const earlier = [{ bookingId: "a", checkin: "2029-01-01", apartment: null, name: null, phone: null, email: null }];
    const result = matchPreviousStays({ name: null, phone: null, email: null }, earlier as never);
    expect(result).toEqual({ sure: [], maybe: [] });
  });
});

describe("getPreviousStays", () => {
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

  it("finds earlier stays by phone, whatever the format, most recent first, with the apartment", async () => {
    const cosmos = await room("Cosmos");
    const iris = await room("Iris");
    const now = await booking("Anna Smith", "2030-06-10", "2030-06-13", { phone: "+30 691 234 5678" });
    await booking("A. Smith", "2029-08-01", "2029-08-05", { phone: "00306912345678", roomId: cosmos.id });
    await booking("Anna S", "2030-05-01", "2030-05-04", { phone: "6912345678", roomId: iris.id });
    await booking("Anna S", "2028-05-01", "2028-05-04", { phone: "6912345678" });

    const result = await getPreviousStays(now.id);
    expect(result.sure.map((s) => [s.checkin, s.apartment])).toEqual([
      ["2030-05-01", "Iris"],
      ["2029-08-01", "Cosmos"],
      ["2028-05-01", null],
    ]);
    expect(result.maybe).toEqual([]);
  });

  it("finds earlier stays by e-mail ignoring case and spaces", async () => {
    const now = await booking("Someone New", "2030-06-10", "2030-06-13", { email: "Guest@Example.com" });
    await booking("Other Name", "2029-08-01", "2029-08-05", { email: " guest@example.COM " });
    expect((await getPreviousStays(now.id)).sure).toHaveLength(1);
  });

  it("leaves out this booking, cancelled ones, later ones and ones that end after check-in", async () => {
    const now = await booking("Anna Smith", "2030-06-10", "2030-06-13", { phone: "6912345678" });
    await booking("Anna Smith", "2029-08-01", "2029-08-05", { phone: "6912345678", status: BookingStatus.cancelled });
    await booking("Anna Smith", "2030-06-13", "2030-06-15", { phone: "6912345678" });
    await booking("Anna Smith", "2030-06-08", "2030-06-11", { phone: "6912345678" });
    // Checking out the day this one arrives is fine.
    await booking("Anna Smith", "2030-06-07", "2030-06-10", { phone: "6912345678" });
    const result = await getPreviousStays(now.id);
    expect(result.sure.map((s) => s.checkin)).toEqual(["2030-06-07"]);
  });

  it("does not match short numbers", async () => {
    const now = await booking("Anna Smith", "2030-06-10", "2030-06-13", { phone: "12345" });
    await booking("Other Person", "2029-08-01", "2029-08-05", { phone: "12345" });
    expect(await getPreviousStays(now.id)).toEqual({ sure: [], maybe: [] });
  });

  it("gives a same-name hint (case and accents ignored) only when phone and e-mail do not match", async () => {
    const iris = await room("Iris");
    const now = await booking("Μαρία Παπαδοπούλου", "2030-06-10", "2030-06-13", { phone: "6912345678" });
    await booking("ΜΑΡΙΑ ΠΑΠΑΔΟΠΟΥΛΟΥ", "2024-05-02", "2024-05-06", { roomId: iris.id });
    await booking("Maria Papadopoulou", "2023-05-02", "2023-05-06");
    // Same name and same phone: sure, not maybe.
    await booking("Μαρια Παπαδοπουλου", "2025-05-02", "2025-05-06", { phone: "+306912345678" });
    // Different phone on both sides, same name: still only a hint.
    await booking("Μαρία Παπαδοπούλου", "2022-05-02", "2022-05-06", { phone: "6999999999" });

    const result = await getPreviousStays(now.id);
    expect(result.sure.map((s) => s.checkin)).toEqual(["2025-05-02"]);
    expect(result.maybe.map((s) => [s.checkin, s.apartment])).toEqual([
      ["2024-05-02", "Iris"],
      ["2022-05-02", null],
    ]);
  });

  it("says not found for an unknown booking", async () => {
    await expect(getPreviousStays("nope")).rejects.toBeInstanceOf(DomainError);
  });
});
