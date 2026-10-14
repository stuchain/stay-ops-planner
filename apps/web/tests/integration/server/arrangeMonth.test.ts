/**
 * P4-1: "Τακτοποίησε τον μήνα" (calendar.arrangePreview / arrangeApply) against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient, TURNOVER_TASK_TYPE } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import { applyArrangement, monthBounds, proposeArrangement } from "@/server/useCases/arrangeMonth";

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T09:00:00Z");

let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users", "settings"
    RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, capacity: number, large = false) {
  return prisma.room.create({
    data: {
      code: name.toLowerCase(),
      displayName: name,
      maxGuests: capacity,
      preferredForLargeParty: large,
      isActive: true,
      calendarSortIndex: seq++,
    },
  });
}

async function booking(
  guestName: string,
  checkin: string,
  checkout: string,
  extra: { adults?: number; status?: BookingStatus; roomId?: string; pinned?: boolean } = {},
) {
  seq += 1;
  const created = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `ext-${seq}`,
      status: extra.status ?? BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 0,
      guestName,
      guestAdults: extra.adults ?? 2,
    },
  });
  if (extra.roomId) {
    await prisma.assignment.create({
      data: {
        bookingId: created.id,
        roomId: extra.roomId,
        startDate: created.checkinDate,
        endDate: created.checkoutDate,
        pinned: extra.pinned ?? false,
      },
    });
  }
  return created;
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

describe("arrange the month", () => {
  let actorId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
    actorId = (await prisma.user.create({ data: { email: `arrange-${Date.now()}@example.com`, passwordHash: "x" } }))
      .id;
  });

  const apply = (placements: { bookingId: string; roomId: string; expectedVersion: number }[]) =>
    applyArrangement({ placements, actorUserId: actorId }, NOW);

  it("works out the month's first day and the next month's", () => {
    expect(monthBounds("2030-12")).toEqual({ start: "2030-12-01", end: "2031-01-01" });
    expect(monthBounds("2030-07-15")).toEqual({ start: "2030-07-01", end: "2030-08-01" });
  });

  it("proposes only bookings without an apartment and keeps every placement where it is", async () => {
    const onar = await room("Onar", 2);
    const cosmos = await room("Cosmos", 4, true);
    // Unpinned but placed: still never moves.
    const placed = await booking("Placed", "2030-07-01", "2030-07-05", { roomId: cosmos.id, pinned: false });
    const big = await booking("Big", "2030-07-02", "2030-07-04", { adults: 4 });
    const couple = await booking("Couple", "2030-07-10", "2030-07-12");
    await booking("Pending", "2030-07-10", "2030-07-12", { status: BookingStatus.pending });
    await booking("Cancelled", "2030-07-10", "2030-07-12", { status: BookingStatus.cancelled });
    await booking("Next month", "2030-08-10", "2030-08-12");

    const proposal = await proposeArrangement("2030-07", NOW);
    expect(proposal.month).toBe("2030-07-01");
    expect(proposal.placements.map((p) => [p.guestName, p.roomId])).toEqual([
      // Cosmos is taken by the placed booking, so the 4-person party goes to Onar with a warning.
      ["Big", onar.id],
      ["Couple", onar.id],
    ]);
    expect(proposal.placements[0]!.warnings).toEqual(["OVER_CAPACITY"]);
    expect(proposal.unplaced).toEqual([]);
    expect(proposal.placements.some((p) => p.bookingId === placed.id)).toBe(false);
    void big;
    void couple;
  });

  it("lists bookings that fit nowhere and leaves out stays that are over", async () => {
    const onar = await room("Onar", 2);
    await booking("In Onar", "2030-06-12", "2030-06-20", { roomId: onar.id });
    await booking("Clash", "2030-06-14", "2030-06-16");
    await booking("Over", "2030-06-01", "2030-06-05");

    const proposal = await proposeArrangement("2030-06", NOW);
    expect(proposal.placements).toEqual([]);
    expect(proposal.unplaced.map((u) => u.guestName)).toEqual(["Clash"]);
  });

  it("proposes nothing for a month that is over", async () => {
    await room("Onar", 2);
    await booking("Old", "2030-05-01", "2030-05-03");
    expect(await proposeArrangement("2030-05", NOW)).toEqual({ month: "2030-05-01", placements: [], unplaced: [] });
  });

  it("applies the whole preview with audit rows, and no cleanings without a same-day arrival", async () => {
    await room("Onar", 2);
    await room("Iris", 2);
    const a = await booking("A", "2030-07-01", "2030-07-05");
    const b = await booking("B", "2030-07-02", "2030-07-04", { status: BookingStatus.needs_reassignment });

    const proposal = await proposeArrangement("2030-07", NOW);
    const result = await apply(
      proposal.placements.map((p) => ({ bookingId: p.bookingId, roomId: p.roomId, expectedVersion: p.version })),
    );
    expect(result).toEqual({ placed: 2 });

    const rows = await prisma.booking.findMany({ where: { id: { in: [a.id, b.id] } }, include: { assignment: true } });
    for (const row of rows) {
      expect(row.assignment?.pinned).toBe(false);
      expect(row.version).toBe(1);
      expect(row.status).toBe(BookingStatus.confirmed);
    }
    expect(new Set(rows.map((r) => r.assignment?.roomId)).size).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: "booking.arrange" } })).toBe(2);
    // Cleanings come by themselves only for same-day changeovers; these two have none.
    expect(await prisma.cleaningTask.count({ where: { taskType: TURNOVER_TASK_TYPE } })).toBe(0);
  });

  it("saves nothing when a booking changed after the preview", async () => {
    const onar = await room("Onar", 2);
    await room("Iris", 2);
    const a = await booking("A", "2030-07-01", "2030-07-05");
    const b = await booking("B", "2030-07-10", "2030-07-12");
    const proposal = await proposeArrangement("2030-07", NOW);

    // Someone placed B by hand meanwhile.
    await prisma.assignment.create({
      data: { bookingId: b.id, roomId: onar.id, startDate: b.checkinDate, endDate: b.checkoutDate, pinned: true },
    });
    const code = await errorCode(
      apply(proposal.placements.map((p) => ({ bookingId: p.bookingId, roomId: p.roomId, expectedVersion: p.version }))),
    );
    expect(code).toBe("CHANGED_MEANWHILE");
    expect(await prisma.assignment.findUnique({ where: { bookingId: a.id } })).toBeNull();
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it("refuses a stale version and an apartment taken meanwhile", async () => {
    const onar = await room("Onar", 2);
    const a = await booking("A", "2030-07-01", "2030-07-05");
    expect(await errorCode(apply([{ bookingId: a.id, roomId: onar.id, expectedVersion: 7 }]))).toBe(
      "CHANGED_MEANWHILE",
    );
    await booking("Other", "2030-07-02", "2030-07-03", { roomId: onar.id });
    expect(await errorCode(apply([{ bookingId: a.id, roomId: onar.id, expectedVersion: 0 }]))).toBe(
      "CHANGED_MEANWHILE",
    );
  });

  it("refuses the same booking twice and does nothing for an empty plan", async () => {
    const onar = await room("Onar", 2);
    const a = await booking("A", "2030-07-01", "2030-07-05");
    const twice = { bookingId: a.id, roomId: onar.id, expectedVersion: 0 };
    expect(await errorCode(apply([twice, twice]))).toBe("VALIDATION");
    expect(await apply([])).toEqual({ placed: 0 });
  });
});
