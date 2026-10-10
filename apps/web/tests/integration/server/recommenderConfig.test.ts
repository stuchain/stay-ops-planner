/**
 * P2-6: Dev mode recommender settings and debug against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { DEFAULT_RECOMMENDER_CONFIG } from "@stay-ops/domain";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T09:00:00Z");
let seq = 0;
let userId: string;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms",
      "source_listings", "settings", "users" RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, data: { large?: boolean } = {}) {
  return prisma.room.create({
    data: {
      code: `rental-${name.toLowerCase()}`,
      displayName: name,
      maxGuests: 4,
      preferredForLargeParty: data.large ?? false,
      isActive: true,
      calendarSortIndex: seq++,
    },
  });
}

async function booking(guestName: string, checkin: string, checkout: string, guests = 2) {
  seq += 1;
  return prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `ext-${seq}`,
      status: BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 3,
      guestName,
      guestAdults: guests,
      guestChildren: 0,
      guestInfants: 0,
      guestTotal: guests,
    },
  });
}

const reordered = (first: string) => ({
  rules: [
    ...DEFAULT_RECOMMENDER_CONFIG.rules.filter((r) => r.rule === first),
    ...DEFAULT_RECOMMENDER_CONFIG.rules.filter((r) => r.rule !== first),
  ],
});

describe("Dev mode recommender", () => {
  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => {
    seq = 0;
    await truncate();
    userId = (await prisma.user.create({ data: { email: `admin-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });

  async function caller(role: "admin" | "operator" | "viewer" = "admin") {
    const { appRouter } = await import("@/server/api/root");
    return appRouter.createCaller({ headers: new Headers(), user: { userId, role, sessionExpiresAt: NOW } });
  }

  it("starts with today's behaviour and stores nothing", async () => {
    const admin = await caller();
    expect(await admin.dev.recommender.config()).toEqual(DEFAULT_RECOMMENDER_CONFIG);
    expect(await prisma.setting.count()).toBe(0);
  });

  it("saves and reads the rules, and reset brings the defaults back", async () => {
    const admin = await caller();
    const config = reordered("roomOrder");
    await admin.dev.recommender.save({ config });
    expect(await admin.dev.recommender.config()).toEqual(config);
    expect(await prisma.auditEvent.count({ where: { action: "setting.update" } })).toBe(1);

    await admin.dev.recommender.reset();
    expect(await admin.dev.recommender.config()).toEqual(DEFAULT_RECOMMENDER_CONFIG);
    expect(await prisma.setting.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "setting.reset" } })).toBe(1);
  });

  it("refuses unknown rules, repeated rules, missing rules and odd weights", async () => {
    const admin = await caller();
    const rules = DEFAULT_RECOMMENDER_CONFIG.rules;
    const bad = [
      { rules: [...rules.slice(1), { rule: "luck", weight: 1 }] },
      { rules: [...rules.slice(1), rules[1]!] },
      { rules: rules.slice(1) },
      { rules: rules.map((r, i) => (i === 0 ? { ...r, weight: 1.5 } : r)) },
      { rules: rules.map((r, i) => (i === 0 ? { ...r, weight: 1000 } : r)) },
      { rules: rules.map((r, i) => (i === 0 ? { ...r, extra: true } : r)) },
    ];
    for (const config of bad) {
      await expect(admin.dev.recommender.save({ config: config as never })).rejects.toBeTruthy();
    }
    expect(await prisma.setting.count()).toBe(0);
  });

  it("falls back to the defaults when the stored value is not valid", async () => {
    await prisma.setting.create({
      data: { key: "recommender.rules", value: { rules: [{ rule: "luck", weight: 1 }] } },
    });
    const { loadRecommenderConfig } = await import("@/server/useCases/recommenderConfig");
    expect(await loadRecommenderConfig()).toEqual(DEFAULT_RECOMMENDER_CONFIG);
  });

  it("booking.suggestions uses the saved rules", async () => {
    const admin = await caller();
    const onar = await room("Onar");
    const cosmos = await room("Cosmos", { large: true });
    const couple = await booking("Maria", "2030-06-20", "2030-06-23", 2);

    const before = await admin.booking.suggestions({ bookingId: couple.id });
    expect(before.map((s) => s.roomId)).toEqual([onar.id, cosmos.id]);
    expect(before[0]).not.toHaveProperty("contributions");

    // Calendar order first: Onar is first on the calendar anyway; reverse the party-size rule instead.
    const config = {
      rules: DEFAULT_RECOMMENDER_CONFIG.rules.map((r) => (r.rule === "partyRoom" ? { ...r, weight: -1 } : r)),
    };
    await admin.dev.recommender.save({ config });
    const after = await admin.booking.suggestions({ bookingId: couple.id });
    expect(after.map((s) => s.roomId)).toEqual([cosmos.id, onar.id]);
    expect(after[0]!.recommended).toBe(true);

    await admin.dev.recommender.reset();
    expect((await admin.booking.suggestions({ bookingId: couple.id })).map((s) => s.roomId)).toEqual([
      onar.id,
      cosmos.id,
    ]);
  });

  it("debug shows every apartment with each rule's contribution, for saved or draft rules", async () => {
    const admin = await caller();
    const onar = await room("Onar");
    const cosmos = await room("Cosmos", { large: true });
    const other = await booking("Nikos", "2030-06-19", "2030-06-24", 2);
    await prisma.assignment.create({
      data: { bookingId: other.id, roomId: onar.id, startDate: other.checkinDate, endDate: other.checkoutDate },
    });
    const couple = await booking("Maria", "2030-06-20", "2030-06-23", 2);

    const rows = await admin.dev.recommender.debug({ bookingId: couple.id });
    expect(rows.map((r) => r.roomId)).toEqual([cosmos.id, onar.id]);
    expect(rows[1]).toMatchObject({ available: false, blockedByGuest: "Nikos" });
    expect(rows[0]!.contributions.map((c) => c.rule)).toEqual(DEFAULT_RECOMMENDER_CONFIG.rules.map((r) => r.rule));
    expect(rows[1]!.contributions.find((c) => c.rule === "free")).toMatchObject({ raw: 1, value: 1 });

    // A draft puts calendar order first without saving it.
    const draft = await admin.dev.recommender.debug({ bookingId: couple.id, config: reordered("roomOrder") });
    expect(draft.map((r) => r.roomId)).toEqual([onar.id, cosmos.id]);
    expect(await prisma.setting.count()).toBe(0);
  });

  it("lists bookings by guest name, or the upcoming ones needing an apartment first", async () => {
    const admin = await caller();
    const onar = await room("Onar");
    const placedBooking = await booking("Eleni", "2030-06-12", "2030-06-15");
    await prisma.assignment.create({
      data: {
        bookingId: placedBooking.id,
        roomId: onar.id,
        startDate: placedBooking.checkinDate,
        endDate: placedBooking.checkoutDate,
      },
    });
    const open = await booking("Giorgos", "2030-06-18", "2030-06-20");
    await booking("Old guest", "2020-01-01", "2020-01-04");

    const upcoming = await admin.dev.recommender.bookings({});
    expect(upcoming.map((b) => b.id)).toEqual([open.id, placedBooking.id]);
    expect(upcoming[0]).toMatchObject({ needsApartment: true, guestName: "Giorgos", partySize: 2 });

    const found = await admin.dev.recommender.bookings({ query: "old" });
    expect(found.map((b) => b.guestName)).toEqual(["Old guest"]);
  });

  it("is admin-only through the API", async () => {
    const operator = await caller("operator");
    const viewer = await caller("viewer");
    await expect(operator.dev.recommender.config()).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(operator.dev.recommender.save({ config: DEFAULT_RECOMMENDER_CONFIG as never })).rejects.toMatchObject({
      message: "FORBIDDEN",
    });
    await expect(viewer.dev.recommender.reset()).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(viewer.dev.recommender.bookings({})).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(viewer.dev.recommender.debug({ bookingId: "x" })).rejects.toMatchObject({ message: "FORBIDDEN" });
  });
});
