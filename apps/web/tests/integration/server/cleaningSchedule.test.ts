/**
 * P4-2: the cleaning schedule, its changes (version check, closed tasks, double booking) and the cleaner's day.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BookingStatus,
  Channel,
  ensureTurnoverCleaningTask,
  PrismaClient,
  TURNOVER_SET_ASIDE_PREFIX,
} from "@stay-ops/db";
import { DomainError, type IsoDate } from "@stay-ops/domain";
import { addTurnoverTask } from "../helpers/cleaningFixtures";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();
const NOW = new Date("2030-07-01T08:00:00Z");
const iso = (s: string) => s as IsoDate;
let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users"
    RESTART IDENTITY CASCADE;
  `);
}

async function stay(
  roomId: string,
  guest: string,
  checkin: string,
  checkout: string,
  extra: Partial<{ adults: number; children: number; infants: number; status: BookingStatus }> = {},
) {
  seq += 1;
  const b = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `cs-${seq}`,
      status: extra.status ?? BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 1,
      guestName: guest,
      guestEmail: `${guest.toLowerCase()}@example.com`,
      guestPhone: "+30 690 000 0000",
      guestAdults: extra.adults ?? 2,
      guestChildren: extra.children ?? 0,
      guestInfants: extra.infants ?? 0,
      totalAmountCents: 123_456,
    },
  });
  await prisma.assignment.create({
    data: { bookingId: b.id, roomId, startDate: b.checkinDate, endDate: b.checkoutDate },
  });
  await prisma.$transaction((tx) =>
    ensureTurnoverCleaningTask(tx, { bookingId: b.id, roomId, checkoutDate: b.checkoutDate }),
  );
  // Only same-day changeovers get a cleaning by themselves; these tests want one for every stay.
  if ((await prisma.cleaningTask.count({ where: { bookingId: b.id } })) === 0) {
    await addTurnoverTask(prisma, { bookingId: b.id, roomId, checkoutDate: b.checkoutDate });
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

describe("cleaning schedule use cases", () => {
  const savedZone = process.env.APP_TIMEZONE;
  let actorId: string;
  let onar: { id: string };
  let cosmos: { id: string };

  beforeAll(async () => {
    process.env.APP_TIMEZONE = "Europe/Athens";
    await prisma.$connect();
  });
  afterAll(async () => {
    if (savedZone === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = savedZone;
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncate();
    actorId = (await prisma.user.create({ data: { email: `cs-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    onar = await prisma.room.create({ data: { code: "onar", displayName: "Onar", color: "#0F766E" } });
    cosmos = await prisma.room.create({ data: { code: "cosmos", displayName: "Cosmos" } });
  });

  const uc = () => import("@/server/useCases/cleaningSchedule");
  const taskOf = (bookingId: string) => prisma.cleaningTask.findFirstOrThrow({ where: { bookingId } });

  it("creates the missing cleaning for a placement that has none, once", async () => {
    const { loadTurnovers } = await uc();
    const b = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "cs-old",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2030-07-01T00:00:00Z"),
        checkoutDate: new Date("2030-07-03T00:00:00Z"),
        nights: 2,
        guestName: "Old",
      },
    });
    await prisma.assignment.create({
      data: { bookingId: b.id, roomId: onar.id, startDate: b.checkinDate, endDate: b.checkoutDate },
    });
    // The next guest arrives the day Old leaves (A-A); nobody arrives the day Next leaves (A).
    const next = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "cs-next",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2030-07-03T00:00:00Z"),
        checkoutDate: new Date("2030-07-05T00:00:00Z"),
        nights: 2,
        guestName: "Next",
      },
    });
    await prisma.assignment.create({
      data: { bookingId: next.id, roomId: onar.id, startDate: next.checkinDate, endDate: next.checkoutDate },
    });
    const list = await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    expect(list.tasks.map((t) => [t.leaving.guestName, t.kind])).toEqual([
      ["Old", "AA"],
      ["Next", "A"],
    ]);
    expect(list.tasks.map((t) => t.movable)).toEqual([null, { from: "2030-07-05", to: null }]);
    await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    expect(await prisma.cleaningTask.count({ where: { bookingId: b.id } })).toBe(1);
    expect(await prisma.cleaningTask.count({ where: { bookingId: next.id } })).toBe(1);
  });

  it("lists a same-day turnover with who leaves, who arrives and the window in Athens time", async () => {
    const { loadTurnovers } = await uc();
    const out = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await stay(onar.id, "Nikos", "2030-07-05", "2030-07-08", { adults: 2, children: 1, infants: 1 });
    const list = await loadTurnovers(iso("2030-07-01"), 10, { includeCancelled: false }, NOW);
    expect(list.today).toBe("2030-07-01");
    expect(list.tasks).toHaveLength(2);
    const outTask = await taskOf(out.id);
    const first = list.tasks.find((t) => t.id === outTask.id)!;
    expect(first).toMatchObject({
      day: "2030-07-05",
      status: "todo",
      // Numbered in calendar order (here by name: Cosmos, Onar), as the list and the paper show it.
      room: { name: "Onar", label: "2 - Onar", color: "#0F766E" },
      leaving: { guestName: "Maria", time: "11:00" },
      // Who the cleaning is for: the guest who comes next.
      guest: { name: "Nikos", party: { adults: 2, children: 1, infants: 1 } },
      next: {
        checkin: "2030-07-05",
        time: "15:00",
        sameDay: true,
        party: { adults: 2, children: 1, infants: 1 },
      },
      start: "11:00",
      end: "13:00",
      kind: "AA",
      movable: null,
    });
    // The last stay has nobody after it: an A that can go to any later day.
    expect(list.tasks.find((t) => t.leaving.guestName === "Nikos")).toMatchObject({
      kind: "A",
      next: null,
      guest: null,
      movable: { from: "2030-07-08", to: null },
    });
  });

  it("names the guest who is staying on a service cleaning", async () => {
    const { addCleaning, loadTurnovers } = await uc();
    await stay(onar.id, "Nikos", "2030-07-05", "2030-07-08", { adults: 3, children: 1 });
    await addCleaning({ roomId: onar.id, day: iso("2030-07-06"), kind: "S", notes: null, actorUserId: actorId }, NOW);
    const list = await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    expect(list.tasks.find((t) => t.kind === "S")).toMatchObject({
      day: "2030-07-06",
      guest: { name: "Nikos", party: { adults: 3, children: 1, infants: 0 } },
    });
  });

  it("starts at the requested day, hides cancelled cleanings by default and counts them", async () => {
    const { loadTurnovers } = await uc();
    const a = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    const n = await stay(cosmos.id, "Nikos", "2030-07-03", "2030-07-12");
    await prisma.cleaningTask.updateMany({ where: { bookingId: a.id }, data: { status: "cancelled" } });
    await prisma.cleaningTask.updateMany({ where: { bookingId: n.id }, data: { assigneeName: "Eleni" } });

    const week = await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    expect(week.tasks).toHaveLength(0); // Nikos leaves on the 12th, outside this week
    expect(week.cancelledCount).toBe(1);
    const shown = await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: true }, NOW);
    expect(shown.tasks.map((t) => t.status)).toEqual(["cancelled"]);
    const next = await loadTurnovers(iso("2030-07-08"), 7, { includeCancelled: false }, NOW);
    expect(next.tasks.map((t) => t.leaving.guestName)).toEqual(["Nikos"]);
  });

  it("keeps a cancelled booking's arrival out of 'next arrival'", async () => {
    const { loadTurnovers } = await uc();
    const m = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await prisma.cleaningTask.updateMany({ where: { bookingId: m.id }, data: { notes: "Τζάμια" } });
    await stay(onar.id, "Ghost", "2030-07-05", "2030-07-08", { status: BookingStatus.cancelled });
    const list = await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    expect(list.tasks.find((t) => t.leaving.guestName === "Maria")!.next).toBeNull();
  });

  it("brings back the cleanings set aside while only same-day changeovers got one", async () => {
    const { loadTurnovers } = await uc();
    const plain = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    const task = await taskOf(plain.id);
    await prisma.cleaningTask.update({
      where: { id: task.id },
      data: { status: "cancelled", sourceEventId: `${TURNOVER_SET_ASIDE_PREFIX}${task.sourceEventId}` },
    });
    const list = await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    expect(list.tasks.map((t) => [t.leaving.guestName, t.kind, t.day])).toEqual([["Maria", "A", "2030-07-05"]]);
    const back = await taskOf(plain.id);
    expect(back.status).toBe("todo");
    expect(back.sourceEventId).toBe(task.sourceEventId);
  });

  it("changes status, assignee and times with the version, and refuses a stale or closed task", async () => {
    const { rescheduleTurnover, setTurnoverAssignee, setTurnoverStatus } = await uc();
    const b = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await stay(onar.id, "Nikos", "2030-07-05", "2030-07-08");
    let task = await taskOf(b.id);
    const change = () => ({ id: task.id, expectedVersion: task.updatedAt.toISOString(), actorUserId: actorId });

    await setTurnoverAssignee({ ...change(), assigneeName: "  Eleni " });
    task = await taskOf(b.id);
    expect(task.assigneeName).toBe("Eleni");

    // Someone else got there first: the version the screen holds is old.
    const stale = { ...change(), expectedVersion: new Date(task.updatedAt.getTime() - 5000).toISOString() };
    expect(await errorCode(setTurnoverStatus({ ...stale, status: "done" }))).toBe("CHANGED_MEANWHILE");

    await rescheduleTurnover({ ...change(), start: "12:00", end: "14:30" });
    task = await taskOf(b.id);
    expect(task.plannedStart?.toISOString()).toBe("2030-07-05T09:00:00.000Z");
    expect(task.durationMinutes).toBe(150);

    // Not into the next guest's afternoon, and not backwards.
    expect(await errorCode(rescheduleTurnover({ ...change(), start: "12:00", end: "15:30" }))).toBe(
      "CLEANING_DOES_NOT_FIT",
    );
    expect(await errorCode(rescheduleTurnover({ ...change(), start: "14:00", end: "13:00" }))).toBe("VALIDATION");

    await setTurnoverStatus({ ...change(), status: "done" });
    task = await taskOf(b.id);
    expect(task.status).toBe("done");
    expect(await errorCode(rescheduleTurnover({ ...change(), start: "12:00", end: "13:00" }))).toBe("TASK_CLOSED");
    // A done cleaning can be opened again by mistake-proof undo.
    await setTurnoverStatus({ ...change(), status: "todo" });
    expect((await taskOf(b.id)).status).toBe("todo");

    await prisma.cleaningTask.update({ where: { id: task.id }, data: { status: "cancelled" } });
    task = await taskOf(b.id);
    expect(await errorCode(setTurnoverStatus({ ...change(), status: "done" }))).toBe("TASK_CLOSED");
    expect(await errorCode(rescheduleTurnover({ ...change(), start: "12:00", end: "13:00" }))).toBe("TASK_CLOSED");
    expect(await prisma.auditEvent.count({ where: { entityId: task.id } })).toBeGreaterThanOrEqual(4);
  });

  it("warns when one cleaner has two cleanings at the same time", async () => {
    const { loadTurnovers, setTurnoverAssignee } = await uc();
    const a = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    const b = await stay(cosmos.id, "Nikos", "2030-07-03", "2030-07-05");
    for (const booking of [a, b]) {
      const task = await taskOf(booking.id);
      await setTurnoverAssignee({
        id: task.id,
        expectedVersion: task.updatedAt.toISOString(),
        assigneeName: "Eleni",
        actorUserId: actorId,
      });
    }
    const list = await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    const taskA = await taskOf(a.id);
    const taskB = await taskOf(b.id);
    expect(list.tasks.find((t) => t.id === taskA.id)!.conflictsWith).toEqual([taskB.id]);
    expect(list.tasks.find((t) => t.id === taskB.id)!.conflictsWith).toEqual([taskA.id]);
  });

  it("gives the cleaner the day without any guest name, contact or price", async () => {
    const { getCleanerDay } = await import("@/server/useCases/cleaningCleanerDay");
    const a = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await stay(onar.id, "Nikos", "2030-07-05", "2030-07-08", { adults: 2, children: 2, infants: 1 });
    await prisma.cleaningTask.updateMany({ where: { bookingId: a.id }, data: { notes: "Αλλαγή σεντονιών" } });
    const other = await stay(cosmos.id, "Zoe", "2030-07-02", "2030-07-06");
    await prisma.cleaningTask.updateMany({ where: { bookingId: other.id }, data: { status: "cancelled" } });

    const day = await getCleanerDay(iso("2030-07-05"));
    expect(day.tasks).toHaveLength(1);
    expect(day.tasks[0]).toMatchObject({
      kind: "AA",
      // Babies count as children; no times, note or cleaner (Stelios, 2026-10-14).
      people: { adults: 2, children: 3 },
      nobodyBooked: false,
    });
    expect(day.tasks[0]?.apartment).toMatch(/^\d+ - Onar$/);
    const json = JSON.stringify(day);
    for (const secret of ["Maria", "Nikos", "Zoe", "example.com", "690", "123456", "1234.56", "σεντονιών", "11:00"]) {
      expect(json).not.toContain(secret);
    }
    expect((await getCleanerDay(iso("2030-07-09"))).tasks).toEqual([]);
  });

  it("moves a cleaning to another day with the same times, within the gap between guests", async () => {
    const { moveCleaningDay } = await uc();
    const b = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await stay(onar.id, "Nikos", "2030-07-08", "2030-07-10");
    let task = await taskOf(b.id);
    const change = () => ({ id: task.id, expectedVersion: task.updatedAt.toISOString(), actorUserId: actorId });

    await moveCleaningDay({ ...change(), day: iso("2030-07-07") }, NOW);
    task = await taskOf(b.id);
    expect(task.plannedStart?.toISOString()).toBe("2030-07-07T08:00:00.000Z");
    expect(task.plannedEnd?.toISOString()).toBe("2030-07-07T10:00:00.000Z");

    // Not after the next guest has arrived, not before the guest leaves, not in the past.
    expect(await errorCode(moveCleaningDay({ ...change(), day: iso("2030-07-09") }, NOW))).toBe(
      "CLEANING_DOES_NOT_FIT",
    );
    expect(await errorCode(moveCleaningDay({ ...change(), day: iso("2030-07-04") }, NOW))).toBe(
      "CLEANING_DOES_NOT_FIT",
    );
    expect(await errorCode(moveCleaningDay({ ...change(), day: iso("2030-06-30") }, NOW))).toBe("CLEANING_IN_PAST");
    expect(await prisma.auditEvent.count({ where: { entityId: task.id, action: "cleaning_task.day_moved" } })).toBe(1);
  });

  it("keeps a same-day changeover cleaning on its day and on the schedule", async () => {
    const { moveCleaningDay, removeCleaning } = await uc();
    const b = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await stay(onar.id, "Nikos", "2030-07-05", "2030-07-08");
    const task = await taskOf(b.id);
    const change = { id: task.id, expectedVersion: task.updatedAt.toISOString(), actorUserId: actorId };
    expect(await errorCode(moveCleaningDay({ ...change, day: iso("2030-07-06") }, NOW))).toBe("CLEANING_DOES_NOT_FIT");
    expect(await errorCode(removeCleaning(change))).toBe("CLEANING_CHANGEOVER");
  });

  it("adds S during a stay and A after a checkout, by their rules, and removes and restores them", async () => {
    const { addCleaning, loadCleaningCalendar, moveCleaningDay, removeCleaning, restoreCleaning } = await uc();
    const maria = await stay(onar.id, "Maria", "2030-07-02", "2030-07-09");
    await stay(onar.id, "Nikos", "2030-07-12", "2030-07-15");
    const add = (day: string, kind: "AA" | "A" | "S", notes: string | null = null) =>
      addCleaning({ roomId: onar.id, day: iso(day), kind, notes, actorUserId: actorId }, NOW);

    // S: only on a day the guests stay all day, and moves only within the stay.
    const { id } = await add("2030-07-05", "S", " Πετσέτες ");
    let task = await prisma.cleaningTask.findUniqueOrThrow({ where: { id } });
    expect(task).toMatchObject({ taskType: "service", bookingId: maria.id, notes: "Πετσέτες", assigneeName: null });
    expect(task.plannedStart?.toISOString()).toBe("2030-07-05T08:00:00.000Z");
    expect(await errorCode(add("2030-07-02", "S"))).toBe("CLEANING_NOT_IN_STAY");
    expect(await errorCode(add("2030-07-10", "S"))).toBe("CLEANING_NOT_IN_STAY");
    await moveCleaningDay(
      { id, expectedVersion: task.updatedAt.toISOString(), actorUserId: actorId, day: iso("2030-07-03") },
      NOW,
    );
    task = await prisma.cleaningTask.findUniqueOrThrow({ where: { id } });
    expect(
      await errorCode(
        moveCleaningDay(
          { id, expectedVersion: task.updatedAt.toISOString(), actorUserId: actorId, day: iso("2030-07-10") },
          NOW,
        ),
      ),
    ).toBe("CLEANING_NOT_IN_STAY");

    // A: Maria's checkout already has its cleaning; removed, it does not come back by itself, and is added again.
    expect(await errorCode(add("2030-07-10", "A"))).toBe("CLEANING_ALREADY_THERE");
    let turnover = await prisma.cleaningTask.findFirstOrThrow({ where: { bookingId: maria.id, taskType: "turnover" } });
    const removed = await removeCleaning({
      id: turnover.id,
      expectedVersion: turnover.updatedAt.toISOString(),
      actorUserId: actorId,
    });
    let calendar = await loadCleaningCalendar(iso("2030-07-01"), NOW);
    expect(calendar.tasks.map((t) => t.kind)).toEqual(["S", "A"]); // Nikos's A on the 15th
    await restoreCleaning({ id: turnover.id, expectedVersion: removed.version, actorUserId: actorId });
    turnover = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: turnover.id } });
    expect(turnover.status).toBe("todo");
    await removeCleaning({ id: turnover.id, expectedVersion: turnover.updatedAt.toISOString(), actorUserId: actorId });
    expect(await errorCode(add("2030-07-13", "A"))).toBe("CLEANING_NO_CHECKOUT"); // during Nikos's stay
    expect(await errorCode(add("2030-07-10", "AA"))).toBe("CLEANING_NO_CHANGEOVER");
    const again = await add("2030-07-12", "A"); // up to the day Nikos arrives
    expect(again.id).toBe(turnover.id);
    turnover = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: turnover.id } });
    expect(turnover.status).toBe("todo");
    expect(turnover.plannedStart?.toISOString()).toBe("2030-07-12T08:00:00.000Z");

    expect(await errorCode(add("2030-06-20", "A"))).toBe("CLEANING_IN_PAST");
    expect(
      await errorCode(
        addCleaning({ roomId: cosmos.id, day: iso("2030-07-05"), kind: "A", notes: null, actorUserId: actorId }, NOW),
      ),
    ).toBe("CLEANING_NO_CHECKOUT");

    calendar = await loadCleaningCalendar(iso("2030-07-01"), NOW);
    expect(calendar.rooms.map((r) => r.name)).toEqual(["Cosmos", "Onar"]);
    expect(calendar.stays.map((s) => s.guestName)).toEqual(["Maria", "Nikos"]);
    expect(calendar.tasks.map((t) => [t.day, t.kind, t.movable])).toEqual([
      ["2030-07-03", "S", { from: "2030-07-03", to: "2030-07-08" }],
      ["2030-07-12", "A", { from: "2030-07-09", to: "2030-07-12" }],
      ["2030-07-15", "A", { from: "2030-07-15", to: null }],
    ]);
  });

  it("puts an A-A by hand only on the day of a changeover whose cleaning was taken away", async () => {
    const { addCleaning } = await uc();
    const maria = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await stay(onar.id, "Nikos", "2030-07-05", "2030-07-08");
    expect(
      await errorCode(
        addCleaning({ roomId: onar.id, day: iso("2030-07-05"), kind: "AA", notes: null, actorUserId: actorId }, NOW),
      ),
    ).toBe("CLEANING_ALREADY_THERE");
    await prisma.cleaningTask.updateMany({ where: { bookingId: maria.id }, data: { status: "cancelled" } });
    await addCleaning({ roomId: onar.id, day: iso("2030-07-05"), kind: "AA", notes: null, actorUserId: actorId }, NOW);
    expect((await taskOf(maria.id)).status).toBe("todo");
  });
});
