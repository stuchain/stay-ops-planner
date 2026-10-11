/**
 * P4-7: occupancy and price per night by apartment and month, against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";

const prisma = new PrismaClient();
let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "ledger_entries", "assignments", "cleaning_tasks", "bookings",
      "source_listings", "rooms", "users", "tax_rules", "excel_rental_config"
    RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, sort: number, isActive = true) {
  return prisma.room.create({
    data: { code: name.toLowerCase(), displayName: name, calendarSortIndex: sort, color: "#123456", isActive },
  });
}

async function stay(
  roomId: string | null,
  checkin: string,
  checkout: string,
  opts: { status?: BookingStatus; total?: number | null } = {},
) {
  seq += 1;
  const from = new Date(`${checkin}T00:00:00Z`);
  const to = new Date(`${checkout}T00:00:00Z`);
  const b = await prisma.booking.create({
    data: {
      channel: Channel.airbnb,
      externalBookingId: `occ-${seq}`,
      status: opts.status ?? BookingStatus.confirmed,
      checkinDate: from,
      checkoutDate: to,
      nights: Math.round((to.getTime() - from.getTime()) / 86_400_000),
      totalValueCents: opts.total === undefined ? 30_000 : opts.total,
      payoutAmountCents: 20_000,
      currency: "EUR",
    },
  });
  if (roomId) await prisma.assignment.create({ data: { bookingId: b.id, roomId, startDate: from, endDate: to } });
  return b;
}

describe("occupancy", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(truncate);

  const build = async (year: number) => {
    const { buildOccupancy } = await import("@/server/useCases/occupancy");
    return buildOccupancy(year, prisma);
  };

  it("counts confirmed placed nights by month, split across months, for this year and last", async () => {
    const cosmos = await room("Cosmos", 2);
    const onar = await room("Onar", 1);
    await stay(onar.id, "2030-07-30", "2030-08-02"); // 3 nights, 300 €: 2 in July, 1 in August
    await stay(cosmos.id, "2030-07-01", "2030-07-06", { total: 50_000 });
    await stay(onar.id, "2029-12-30", "2030-01-03"); // 4 nights, 300 €: 2 fall in 2030
    await stay(onar.id, "2029-07-01", "2029-07-11"); // last year only

    const o = await build(2030);
    expect(o.apartments.map((a) => a.name)).toEqual(["Onar", "Cosmos"]);
    const [onarNow, cosmosNow] = o.thisYear;
    expect(onarNow!.roomId).toBe(onar.id);
    expect(onarNow!.months[6]).toEqual({ nights: 2, daysInMonth: 31, revenueCents: 20_000 });
    expect(onarNow!.months[7]).toMatchObject({ nights: 1, revenueCents: 10_000 });
    expect(onarNow!.months[0]).toMatchObject({ nights: 2, revenueCents: 15_000 });
    expect(cosmosNow!.months[6]).toMatchObject({ nights: 5, revenueCents: 50_000 });
    expect(o.lastYear[0]!.months[6]).toMatchObject({ nights: 10, revenueCents: 30_000 });
    expect(o.lastYear[0]!.months[11]).toMatchObject({ nights: 2, revenueCents: 15_000 });
  });

  it("leaves out cancelled, pending, unplaced and needs-reassignment stays", async () => {
    const onar = await room("Onar", 1);
    await stay(onar.id, "2030-05-01", "2030-05-03", { status: BookingStatus.cancelled });
    await stay(onar.id, "2030-05-05", "2030-05-07", { status: BookingStatus.pending });
    await stay(onar.id, "2030-05-10", "2030-05-12", { status: BookingStatus.needs_reassignment });
    await stay(null, "2030-05-15", "2030-05-17");
    const o = await build(2030);
    expect(o.thisYear[0]!.months[4]!.nights).toBe(0);
  });

  it("shows an inactive apartment only when it had stays in the two years", async () => {
    const old = await room("Old", 3, false);
    await room("Unused", 4, false);
    await stay(old.id, "2029-06-01", "2029-06-04");
    const o = await build(2030);
    expect(o.apartments.map((a) => a.name)).toEqual(["Old"]);
    expect(o.lastYear[0]!.months[5]!.nights).toBe(3);
  });
});
