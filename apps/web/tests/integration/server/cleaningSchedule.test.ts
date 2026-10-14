/**
 * P4-2: the cleaning schedule, its changes (version check, closed tasks, double booking) and the cleaner's day.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, ensureTurnoverCleaningTask, PrismaClient } from "@stay-ops/db";
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
    // The next guest arrives the day Old leaves; nobody arrives the day Next leaves, so Next gets no cleaning.
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
    expect(list.tasks.map((t) => t.leaving.guestName)).toEqual(["Old"]);
    await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    expect(await prisma.cleaningTask.count({ where: { bookingId: b.id } })).toBe(1);
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
      room: { name: "Onar", color: "#0F766E" },
      leaving: { guestName: "Maria", time: "11:00" },
      next: {
        checkin: "2030-07-05",
        time: "15:00",
        sameDay: true,
        party: { adults: 2, children: 1, infants: 1 },
      },
      start: "11:00",
      end: "13:00",
    });
    // The last stay has nobody after it.
    expect(list.tasks.find((t) => t.leaving.guestName === "Nikos")!.next).toBeNull();
  });

  it("starts at the requested day, hides cancelled cleanings by default and counts them", async () => {
    const { loadTurnovers } = await uc();
    const a = await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await stay(cosmos.id, "Nikos", "2030-07-03", "2030-07-12");
    await prisma.cleaningTask.updateMany({ where: { bookingId: a.id }, data: { status: "cancelled" } });

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
    await stay(onar.id, "Maria", "2030-07-02", "2030-07-05");
    await stay(onar.id, "Ghost", "2030-07-05", "2030-07-08", { status: BookingStatus.cancelled });
    const list = await loadTurnovers(iso("2030-07-01"), 7, { includeCancelled: false }, NOW);
    expect(list.tasks.find((t) => t.leaving.guestName === "Maria")!.next).toBeNull();
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
      apartment: "Onar",
      start: "11:00",
      end: "13:00",
      notes: "Αλλαγή σεντονιών",
      arrival: { sameDay: true, time: "15:00", adults: 2, children: 2, infants: 1 },
    });
    const json = JSON.stringify(day);
    for (const secret of ["Maria", "Nikos", "Zoe", "example.com", "690", "123456", "1234.56"]) {
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

  it("adds a cleaning by hand on any day, during a stay or between stays, and takes it away again", async () => {
    const { addCleaning, loadCleaningCalendar, moveCleaningDay, removeCleaning } = await uc();
    const during = await stay(onar.id, "Maria", "2030-07-02", "2030-07-09");
    const { id } = await addCleaning(
      {
        roomId: onar.id,
        day: iso("2030-07-05"),
        start: "12:00",
        assigneeName: " Eleni ",
        notes: "Πετσέτες",
        actorUserId: actorId,
      },
      NOW,
    );
    let task = await prisma.cleaningTask.findUniqueOrThrow({ where: { id } });
    expect(task).toMatchObject({ taskType: "service", bookingId: during.id, assigneeName: "Eleni", notes: "Πετσέτες" });
    expect(task.plannedStart?.toISOString()).toBe("2030-07-05T09:00:00.000Z");

    // A cleaning added by hand may move to any day from today, also in the middle of a stay.
    await moveCleaningDay(
      { id, expectedVersion: task.updatedAt.toISOString(), actorUserId: actorId, day: iso("2030-07-03") },
      NOW,
    );
    task = await prisma.cleaningTask.findUniqueOrThrow({ where: { id } });
    expect(task.plannedStart?.toISOString()).toBe("2030-07-03T09:00:00.000Z");

    const after = await addCleaning(
      {
        roomId: onar.id,
        day: iso("2030-07-12"),
        start: "10:00",
        assigneeName: null,
        notes: null,
        actorUserId: actorId,
      },
      NOW,
    );
    expect((await prisma.cleaningTask.findUniqueOrThrow({ where: { id: after.id } })).bookingId).toBe(during.id);

    expect(
      await errorCode(
        addCleaning(
          {
            roomId: cosmos.id,
            day: iso("2030-07-05"),
            start: "10:00",
            assigneeName: null,
            notes: null,
            actorUserId: actorId,
          },
          NOW,
        ),
      ),
    ).toBe("CLEANING_NO_STAY");
    expect(
      await errorCode(
        addCleaning(
          {
            roomId: onar.id,
            day: iso("2030-06-20"),
            start: "10:00",
            assigneeName: null,
            notes: null,
            actorUserId: actorId,
          },
          NOW,
        ),
      ),
    ).toBe("CLEANING_IN_PAST");

    const calendar = await loadCleaningCalendar(iso("2030-07-01"), NOW);
    expect(calendar.rooms.map((r) => r.name)).toEqual(["Cosmos", "Onar"]);
    expect(calendar.stays).toEqual([
      expect.objectContaining({ roomId: onar.id, guestName: "Maria", checkin: "2030-07-02", checkout: "2030-07-09" }),
    ]);
    expect(calendar.tasks.map((t) => t.day).sort()).toEqual(["2030-07-03", "2030-07-09", "2030-07-12"]);
    expect(calendar.cleaners).toEqual(["Eleni"]);

    await removeCleaning({ id, expectedVersion: task.updatedAt.toISOString(), actorUserId: actorId });
    expect((await prisma.cleaningTask.findUniqueOrThrow({ where: { id } })).status).toBe("cancelled");
  });
});
