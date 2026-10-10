/**
 * P3-3: the money ledger (buildLedger and its edits) against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { cents, DomainError } from "@stay-ops/domain";

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T09:00:00Z");
const YEAR = 2030;

let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "ledger_entries", "assignments", "cleaning_tasks", "bookings",
      "source_listings", "rooms", "users", "tax_rules", "excel_rental_config"
    RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, rentalIndex: number) {
  return prisma.room.create({ data: { code: name.toLowerCase(), displayName: name, rentalIndex, color: "#123456" } });
}

async function listing(channel: Channel, rentalIndex: number | null) {
  seq += 1;
  return prisma.sourceListing.create({ data: { channel, externalListingId: `l-${seq}`, rentalIndex } });
}

async function booking(
  checkin: string,
  money: {
    channel?: Channel;
    status?: BookingStatus;
    listingId?: string;
    total?: number | null;
    payout?: number | null;
    roomId?: string;
  } = {},
) {
  seq += 1;
  const b = await prisma.booking.create({
    data: {
      channel: money.channel ?? Channel.airbnb,
      externalBookingId: `ext-${seq}`,
      status: money.status ?? BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(Date.parse(`${checkin}T00:00:00Z`) + 3 * 86_400_000),
      nights: 3,
      guestName: `Guest ${seq}`,
      totalValueCents: money.total === undefined ? 30_000 : money.total,
      payoutAmountCents: money.payout === undefined ? 27_000 : money.payout,
      currency: "EUR",
      sourceListingId: money.listingId ?? null,
    },
  });
  if (money.roomId) {
    await prisma.assignment.create({
      data: { bookingId: b.id, roomId: money.roomId, startDate: b.checkinDate, endDate: b.checkoutDate },
    });
  }
  return b;
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

describe("money ledger", () => {
  let actorUserId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
    actorUserId = (await prisma.user.create({ data: { email: `money-${Date.now()}@example.com`, passwordHash: "x" } }))
      .id;
  });

  const ledger = async (year = YEAR) => {
    const { buildLedger } = await import("@/server/useCases/buildLedger");
    return buildLedger(year, prisma, NOW);
  };
  const edits = () => import("@/server/useCases/updateLedger");

  it("counts each booking for the listing booked, direct ones for the apartment stayed in", async () => {
    const onar = await room("Onar", 1);
    const cosmos = await room("Cosmos", 2);
    const cosmosListing = await listing(Channel.airbnb, 2);
    await booking("2030-07-01", { listingId: cosmosListing.id, roomId: onar.id });
    await booking("2030-08-01", { channel: Channel.direct, total: 40_000, payout: null, roomId: cosmos.id });
    await booking("2030-08-10", { status: BookingStatus.pending, listingId: cosmosListing.id });
    await booking("2030-09-01", { status: BookingStatus.cancelled, listingId: cosmosListing.id, payout: 5000 });
    await booking("2030-09-10", { status: BookingStatus.cancelled, listingId: cosmosListing.id, payout: null });
    await booking("2031-01-02", { listingId: cosmosListing.id });

    const l = await ledger();
    expect(l.rows).toHaveLength(5);
    const [airbnb, direct, pending, cancelledPaid, cancelledUnpaid] = l.rows;
    expect(airbnb).toMatchObject({ kind: "confirmed", bucketSource: "listing", stayedRentalIndex: 1 });
    expect(airbnb!.shown.rentalCents).toEqual([null, 30_000, null, null]);
    expect(airbnb!.shown.roomLocation).toBe("Onar");
    expect(direct).toMatchObject({ bucketSource: "stayed" });
    expect(direct!.shown.soloCents).toBe(40_000);
    expect(pending).toMatchObject({ kind: "pending", counts: false });
    expect(cancelledPaid).toMatchObject({ kind: "cancelled_paid", counts: true });
    expect(cancelledPaid!.shown.airbnbCents).toBe(5000);
    expect(cancelledUnpaid).toMatchObject({ kind: "cancelled_unpaid", counts: false });

    expect(l.totals.byRentalCents).toEqual([0, 30_000 + 40_000 + 5000, 0, 0]);
    expect(l.totals.totalCents).toBe(75_000);
    expect(l.rules).toMatchObject({ year: YEAR, confirmed: false, scope: "total" });
    expect(l.tax.taxCents).toBe(11_250); // 15% of 750 €
    expect(l.years).toEqual([2030, 2031]);
    expect(l.apartments[0]).toEqual({ index: 1, label: "Onar", color: "#123456" });
    expect(l.apartments[3]).toMatchObject({ index: 4, color: null });
  });

  it("flags rows that count but have no apartment", async () => {
    const unmapped = await listing(Channel.booking, null);
    await booking("2030-07-01", { channel: Channel.booking, listingId: unmapped.id });
    const l = await ledger();
    expect(l.totals.unbucketedCount).toBe(1);
    expect(l.totals.totalCents).toBe(0);
  });

  it("saves corrections, flows them into the totals and refuses a stale edit", async () => {
    const cosmosListing = await listing(Channel.airbnb, 2);
    const b = await booking("2030-07-01", { listingId: cosmosListing.id });
    const { updateLedgerRow } = await edits();

    const first = await updateLedgerRow({
      target: { bookingId: b.id },
      expectedVersion: 0,
      patch: { airbnbCents: 35_000 as never, rentalIndex: 4 },
      actorUserId,
    });
    expect(first.version).toBe(1);
    let row = (await ledger()).rows[0]!;
    expect(row.shown.rentalCents).toEqual([null, null, null, 35_000]);
    expect([...row.overridden].sort()).toEqual(["airbnbCents", "rentalIndex"]);
    expect(row.bucketSource).toBe("override");
    expect(row.hosthubChanged).toBe(false);

    expect(
      await errorCode(
        updateLedgerRow({ target: { bookingId: b.id }, expectedVersion: 0, patch: { nights: 2 }, actorUserId }),
      ),
    ).toBe("BOOKING_CHANGED");

    await updateLedgerRow({
      target: { bookingId: b.id },
      expectedVersion: 1,
      patch: { airbnbCents: "revert" },
      actorUserId,
    });
    row = (await ledger()).rows[0]!;
    expect(row.shown.airbnbCents).toBe(30_000);
    expect(row.version).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: "ledger.update" } })).toBe(2);

    // Hosthub changes the price after the correction (E3-6).
    await prisma.booking.update({ where: { id: b.id }, data: { totalValueCents: 31_000 } });
    expect((await ledger()).rows[0]!.hosthubChanged).toBe(true);
  });

  it("keeps corrections when the booking moves to another year, and drops them with the booking", async () => {
    const b = await booking("2030-12-30", { listingId: (await listing(Channel.airbnb, 1)).id });
    const { updateLedgerRow } = await edits();
    await updateLedgerRow({ target: { bookingId: b.id }, expectedVersion: 0, patch: { name: "KEPT" }, actorUserId });
    await prisma.booking.update({ where: { id: b.id }, data: { checkinDate: new Date("2031-01-02T00:00:00Z") } });
    expect((await ledger(2030)).rows).toHaveLength(0);
    expect((await ledger(2031)).rows[0]!.shown.name).toBe("KEPT");
    await prisma.booking.delete({ where: { id: b.id } });
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it("adds, edits and deletes manual rows", async () => {
    const { addManualLedgerRow, editManualLedgerRow, deleteManualLedgerRow, updateLedgerRow } = await edits();
    const added = await addManualLedgerRow({
      year: YEAR,
      month: 3,
      label: " cash guest ",
      patch: { soloCents: 20_000 as never, rentalIndex: 3 },
      actorUserId,
    });
    let row = (await ledger()).rows[0]!;
    expect(row).toMatchObject({ manual: true, month: 3, counts: true, bucketSource: "override" });
    expect(row.shown.name).toBe("CASH GUEST");
    expect(row.shown.rentalCents).toEqual([null, null, 20_000, null]);

    const edited = await editManualLedgerRow({
      entryId: added.entryId,
      expectedVersion: added.version,
      month: 5,
      label: "Refund",
      actorUserId,
    });
    const corrected = await updateLedgerRow({
      target: { entryId: added.entryId },
      expectedVersion: edited.version,
      patch: { soloCents: -5000 as never },
      actorUserId,
    });
    row = (await ledger()).rows[0]!;
    expect(row).toMatchObject({ month: 5, version: corrected.version });
    expect(row.shown.rentalCents).toEqual([null, null, -5000, null]);
    expect((await ledger()).totals.totalCents).toBe(-5000);

    expect(await errorCode(deleteManualLedgerRow({ entryId: added.entryId, expectedVersion: 1, actorUserId }))).toBe(
      "BOOKING_CHANGED",
    );
    await deleteManualLedgerRow({ entryId: added.entryId, expectedVersion: corrected.version, actorUserId });
    expect((await ledger()).rows).toHaveLength(0);
    expect(
      await errorCode(updateLedgerRow({ target: { entryId: "nope" }, expectedVersion: 0, patch: {}, actorUserId })),
    ).toBe("NOT_FOUND");
  });

  it("treats a save sent again after a lost answer as done", async () => {
    const { addManualLedgerRow, editManualLedgerRow, deleteManualLedgerRow, updateLedgerRow } = await edits();
    const add = {
      year: YEAR,
      month: 5,
      label: "Cash",
      patch: { soloCents: cents(10_000) },
      requestId: "req-12345678",
      actorUserId,
    };
    const first = await addManualLedgerRow(add);
    expect(await addManualLedgerRow(add)).toEqual(first);
    const [a, b] = await Promise.all([
      addManualLedgerRow({ ...add, requestId: "req-race-0001" }),
      addManualLedgerRow({ ...add, requestId: "req-race-0001" }),
    ]);
    expect(a).toEqual(b);
    expect((await ledger()).rows).toHaveLength(2);

    const patch = { soloCents: cents(12_000) };
    const corrected = await updateLedgerRow({
      target: { entryId: first.entryId },
      expectedVersion: 1,
      patch,
      actorUserId,
    });
    expect(
      await updateLedgerRow({ target: { entryId: first.entryId }, expectedVersion: 1, patch, actorUserId }),
    ).toEqual(corrected);
    expect(
      await errorCode(
        updateLedgerRow({
          target: { entryId: first.entryId },
          expectedVersion: 1,
          patch: { soloCents: cents(1) },
          actorUserId,
        }),
      ),
    ).toBe("BOOKING_CHANGED");

    const renamed = await editManualLedgerRow({
      entryId: first.entryId,
      expectedVersion: 2,
      label: "Cash box",
      actorUserId,
    });
    expect(
      await editManualLedgerRow({ entryId: first.entryId, expectedVersion: 2, label: "Cash box", actorUserId }),
    ).toEqual(renamed);
    expect(
      await errorCode(editManualLedgerRow({ entryId: first.entryId, expectedVersion: 2, month: 6, actorUserId })),
    ).toBe("BOOKING_CHANGED");

    await deleteManualLedgerRow({ entryId: first.entryId, expectedVersion: renamed.version, actorUserId });
    await deleteManualLedgerRow({ entryId: first.entryId, expectedVersion: renamed.version, actorUserId });
    expect((await ledger()).rows).toHaveLength(1);
  });

  it("reads tax rules from settings", async () => {
    const { saveTaxRules, taxRulesForEditing } = await import("@/server/useCases/taxRules");
    const before = await taxRulesForEditing(YEAR, new Date("2030-03-01T12:00:00Z"));
    expect(before).toMatchObject({ saved: false, note: null, years: [2029, 2030, 2031] });
    expect(before.rules.confirmed).toBe(false);
    const saved = await saveTaxRules({
      year: YEAR,
      brackets: [
        { upToCents: 1_000_000, rateBps: 1000 },
        { upToCents: null, rateBps: 2000 },
      ],
      scope: "per_apartment",
      incomeBasis: "payout",
      confirmed: true,
      note: "From the accountant",
      actorUserId,
    });
    expect(saved).toMatchObject({ scope: "per_apartment", incomeBasis: "payout", confirmed: true });
    const after = await taxRulesForEditing(YEAR - 5, new Date("2030-03-01T12:00:00Z"));
    expect(after.years).toEqual([2025, 2029, 2030, 2031]);
    expect((await taxRulesForEditing(YEAR)).note).toBe("From the accountant");
    await booking("2030-07-01", { listingId: (await listing(Channel.airbnb, 1)).id });
    const l = await ledger();
    expect(l.totals.byRentalCents[0]).toBe(27_000); // payout basis
    expect(l.tax.calculations).toHaveLength(4);
    expect(l.tax.taxCents).toBe(2700);
  });
});
