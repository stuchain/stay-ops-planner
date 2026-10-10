/**
 * P4-2: same-day turnovers fit, Athens time, manual reschedules survive, finished cleanings survive (E4-1..E4-5).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cancelOpenTurnoverTasks,
  ensureTurnoverCleaningTask,
  PrismaClient,
  validateCleaningSchedule,
} from "@stay-ops/db";
import { makeAssignment, makeBooking, makeRoom } from "../helpers/cleaningFixtures";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

const prisma = new PrismaClient();

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users"
    RESTART IDENTITY CASCADE;
  `);
}

const d = (day: string) => new Date(`${day}T00:00:00.000Z`);

async function stay(roomId: string, id: string, checkin: string, checkout: string) {
  const b = await makeBooking(prisma, {
    externalBookingId: id,
    checkinDate: d(checkin),
    checkoutDate: d(checkout),
  });
  await makeAssignment(prisma, { bookingId: b.id, roomId, startDate: b.checkinDate, endDate: b.checkoutDate });
  return b;
}

const ensure = (bookingId: string, roomId: string, checkoutDate: Date) =>
  prisma.$transaction((tx) => ensureTurnoverCleaningTask(tx, { bookingId, roomId, checkoutDate }));

const turnover = (bookingId: string) =>
  prisma.cleaningTask.findFirstOrThrow({ where: { bookingId, taskType: "turnover" } });

describe("cleaning shared logic (P4-2)", () => {
  const savedZone = process.env.APP_TIMEZONE;
  beforeAll(async () => {
    // The suite default is UTC; these tests are about Athens.
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
  });

  describe("E4-1 same-day turnover", () => {
    it("fits between checkout at 11:00 and the next check-in at 15:00 (summer)", async () => {
      const room = await makeRoom(prisma, "SD1");
      const out = await stay(room.id, "sd-out", "2026-07-10", "2026-07-15");
      await stay(room.id, "sd-in", "2026-07-15", "2026-07-20");
      await ensure(out.id, room.id, out.checkoutDate);
      const task = await turnover(out.id);
      // 11:00-13:00 Athens (UTC+3) is 08:00-10:00 UTC.
      expect(task.plannedStart?.toISOString()).toBe("2026-07-15T08:00:00.000Z");
      await prisma.$transaction((tx) =>
        validateCleaningSchedule(tx, {
          roomId: room.id,
          bookingId: out.id,
          plannedStart: task.plannedStart!,
          plannedEnd: task.plannedEnd!,
        }),
      );
    });

    it("may run until 15:00 Athens and not a minute longer (winter)", async () => {
      const room = await makeRoom(prisma, "SD2");
      const out = await stay(room.id, "sd2-out", "2026-12-10", "2026-12-15");
      await stay(room.id, "sd2-in", "2026-12-15", "2026-12-20");
      const check = (start: string, end: string) =>
        prisma.$transaction((tx) =>
          validateCleaningSchedule(tx, {
            roomId: room.id,
            bookingId: out.id,
            plannedStart: new Date(start),
            plannedEnd: new Date(end),
          }),
        );
      // 15:00 Athens in December is 13:00 UTC.
      await check("2026-12-15T09:00:00.000Z", "2026-12-15T13:00:00.000Z");
      await expect(check("2026-12-15T09:00:00.000Z", "2026-12-15T13:01:00.000Z")).rejects.toMatchObject({
        name: "CleaningWindowInvalidError",
      });
    });

    it("still refuses a cleaning that starts before the checkout day", async () => {
      const room = await makeRoom(prisma, "SD3");
      const out = await stay(room.id, "sd3-out", "2026-12-10", "2026-12-15");
      await expect(
        prisma.$transaction((tx) =>
          validateCleaningSchedule(tx, {
            roomId: room.id,
            bookingId: out.id,
            plannedStart: new Date("2026-12-14T20:00:00.000Z"),
            plannedEnd: new Date("2026-12-14T22:00:00.000Z"),
          }),
        ),
      ).rejects.toMatchObject({ name: "CleaningWindowInvalidError" });
    });
  });

  describe("E4-3 a manual reschedule is kept", () => {
    it("keeps the times when sync or a reassign runs again", async () => {
      const room = await makeRoom(prisma, "MR1");
      const other = await makeRoom(prisma, "MR2");
      const out = await stay(room.id, "mr-out", "2026-07-10", "2026-07-15");
      await ensure(out.id, room.id, out.checkoutDate);
      const task = await turnover(out.id);
      const manualStart = new Date("2026-07-15T09:30:00.000Z");
      const manualEnd = new Date("2026-07-15T11:00:00.000Z");
      await prisma.cleaningTask.update({
        where: { id: task.id },
        data: { plannedStart: manualStart, plannedEnd: manualEnd, assigneeName: "Eleni" },
      });

      await ensure(out.id, room.id, out.checkoutDate); // sync again
      let after = await turnover(out.id);
      expect(after.plannedStart?.toISOString()).toBe(manualStart.toISOString());
      expect(after.plannedEnd?.toISOString()).toBe(manualEnd.toISOString());
      expect(after.assigneeName).toBe("Eleni");

      // Reassigned to another apartment: the times stay, the apartment follows.
      await prisma.assignment.update({ where: { bookingId: out.id }, data: { roomId: other.id } });
      await ensure(out.id, other.id, out.checkoutDate);
      after = await turnover(out.id);
      expect(after.roomId).toBe(other.id);
      expect(after.plannedStart?.toISOString()).toBe(manualStart.toISOString());
      expect(after.id).toBe(task.id);

      // And again in the new apartment.
      await ensure(out.id, other.id, out.checkoutDate);
      expect((await turnover(out.id)).plannedStart?.toISOString()).toBe(manualStart.toISOString());
    });

    it("moves the times when the checkout day changed", async () => {
      const room = await makeRoom(prisma, "MR3");
      const out = await stay(room.id, "mr3-out", "2026-07-10", "2026-07-15");
      await ensure(out.id, room.id, out.checkoutDate);
      const task = await turnover(out.id);
      await prisma.cleaningTask.update({
        where: { id: task.id },
        data: { plannedStart: new Date("2026-07-15T09:30:00.000Z"), plannedEnd: new Date("2026-07-15T11:00:00.000Z") },
      });
      const newCheckout = d("2026-07-17");
      await prisma.booking.update({ where: { id: out.id }, data: { checkoutDate: newCheckout } });
      await ensure(out.id, room.id, newCheckout);
      const after = await turnover(out.id);
      expect(after.plannedStart?.toISOString()).toBe("2026-07-17T08:00:00.000Z");
      expect(after.plannedEnd?.toISOString()).toBe("2026-07-17T10:00:00.000Z");
    });
  });

  describe("E4-4 finished cleanings are never removed", () => {
    it("cancels open turnover tasks and keeps done ones", async () => {
      const room = await makeRoom(prisma, "UN1");
      const open = await stay(room.id, "un-open", "2026-07-10", "2026-07-15");
      const finished = await stay(room.id, "un-done", "2026-08-10", "2026-08-15");
      await ensure(open.id, room.id, open.checkoutDate);
      await ensure(finished.id, room.id, finished.checkoutDate);
      await prisma.cleaningTask.updateMany({ where: { bookingId: finished.id }, data: { status: "done" } });

      for (const b of [open, finished]) {
        await prisma.$transaction((tx) => cancelOpenTurnoverTasks(tx, b.id));
      }
      expect((await turnover(open.id)).status).toBe("cancelled");
      expect((await turnover(finished.id)).status).toBe("done");
    });

    it("brings a cancelled task back when the booking is placed again", async () => {
      const room = await makeRoom(prisma, "UN2");
      const b = await stay(room.id, "un2", "2026-07-10", "2026-07-15");
      await ensure(b.id, room.id, b.checkoutDate);
      await prisma.$transaction((tx) => cancelOpenTurnoverTasks(tx, b.id));
      await ensure(b.id, room.id, b.checkoutDate);
      expect((await turnover(b.id)).status).toBe("todo");
      expect(await prisma.cleaningTask.count({ where: { bookingId: b.id } })).toBe(1);
    });

    it("keeps a done cleaning when the booking is taken out of its apartment", async () => {
      const { moveBooking } = await import("@/server/useCases/moveBooking");
      const actor = await prisma.user.create({ data: { email: "e44@example.com", passwordHash: "x" } });
      const room = await makeRoom(prisma, "UN3");
      const b = await makeBooking(prisma, {
        externalBookingId: "un3",
        checkinDate: d("2030-07-10"),
        checkoutDate: d("2030-07-15"),
      });
      const now = new Date("2030-06-01T09:00:00Z");
      const placed = await moveBooking(
        { bookingId: b.id, roomId: room.id, expectedVersion: 0, actorUserId: actor.id },
        now,
      );
      await prisma.cleaningTask.updateMany({ where: { bookingId: b.id }, data: { status: "done" } });
      await moveBooking(
        { bookingId: b.id, roomId: null, expectedVersion: placed.booking.version, actorUserId: actor.id },
        now,
      );
      expect((await turnover(b.id)).status).toBe("done");
    });
  });

  describe("E4-5 done and cancelled cleanings cannot be rescheduled", () => {
    it("refuses a reschedule of a done or cancelled task, and of a stale view", async () => {
      const { updateCleaningTaskSchedule } = await import("@/modules/cleaning/taskSchedule");
      const actor = await prisma.user.create({ data: { email: "e45@example.com", passwordHash: "x" } });
      const room = await makeRoom(prisma, "RS1");
      const b = await stay(room.id, "rs1", "2026-07-10", "2026-07-15");
      await ensure(b.id, room.id, b.checkoutDate);
      const task = await turnover(b.id);
      const window = {
        plannedStart: new Date("2026-07-15T09:00:00.000Z"),
        plannedEnd: new Date("2026-07-15T10:00:00.000Z"),
        actorUserId: actor.id,
      };

      await expect(
        updateCleaningTaskSchedule({
          taskId: task.id,
          ...window,
          expectedUpdatedAt: new Date(task.updatedAt.getTime() - 1000),
        }),
      ).rejects.toMatchObject({ code: "STALE_TASK" });

      await updateCleaningTaskSchedule({ taskId: task.id, ...window, expectedUpdatedAt: task.updatedAt });
      expect((await turnover(b.id)).plannedStart?.toISOString()).toBe("2026-07-15T09:00:00.000Z");

      for (const status of ["done", "cancelled"]) {
        await prisma.cleaningTask.update({ where: { id: task.id }, data: { status } });
        await expect(updateCleaningTaskSchedule({ taskId: task.id, ...window })).rejects.toMatchObject({
          code: "INVALID_STATE_TRANSITION",
        });
      }
    });
  });
});
