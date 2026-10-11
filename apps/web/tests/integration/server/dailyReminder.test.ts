/**
 * P4-3: the daily reminder against a real database, and auth of its cron route.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import type { Notifier } from "@/server/monitoring/notifier";
import {
  buildDailyReminder,
  loadReminderSetting,
  reminderNotifiersFromEnv,
  runDailyReminder,
  setReminderEnabled,
} from "@/server/reminders/dailyReminder";
import type { TodaySummary } from "@/server/useCases/todaySummary";

const prisma = new PrismaClient();
const MORNING = new Date("2030-06-10T05:00:00Z"); // 08:00 in Athens
let seq = 0;

function fakeNotifier(ok = true) {
  const send = vi.fn().mockResolvedValue(ok);
  const notifier: Notifier = { name: "fake", send };
  return { notifier, send };
}

async function reset() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms", "users", "settings"
    RESTART IDENTITY CASCADE;
  `);
}

async function booking(guestName: string, checkin: string, checkout: string, roomId?: string) {
  seq += 1;
  const b = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `rem-${seq}`,
      status: BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 0,
      guestName,
      guestAdults: 3,
    },
  });
  if (roomId) {
    await prisma.assignment.create({
      data: { bookingId: b.id, roomId, startDate: b.checkinDate, endDate: b.checkoutDate },
    });
  }
  return b;
}

beforeEach(reset);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("buildDailyReminder", () => {
  const empty: TodaySummary = {
    today: "2030-06-10" as TodaySummary["today"],
    tomorrow: "2030-06-11" as TodaySummary["tomorrow"],
    arrivals: [],
    departures: [],
    tomorrowArrivals: [],
    tomorrowDepartures: [],
    needsApartment: 0,
  };

  it("says nothing on a quiet day", () => {
    expect(buildDailyReminder(empty)).toBeNull();
  });

  it("leads with departures when they are all there is", () => {
    const stay = {
      id: "b",
      guestName: null,
      partySize: null,
      nights: 2,
      checkin: "2030-06-08" as TodaySummary["today"],
      checkout: "2030-06-10" as TodaySummary["today"],
      status: "confirmed" as const,
      room: null,
    };
    const alert = buildDailyReminder({ ...empty, departures: [stay] })!;
    expect(alert.subject).toBe("Stay Ops: σήμερα φεύγει 1 επισκέπτης");
    expect(alert.body).toContain("• χωρίς διαμέρισμα: Χωρίς όνομα");
  });
});

describe("runDailyReminder", () => {
  it("sends today's arrivals and departures, tomorrow's arrivals and the unplaced count, once a day", async () => {
    const onar = await prisma.room.create({ data: { code: "onar", displayName: "Onar" } });
    await booking("Maria", "2030-06-10", "2030-06-12", onar.id);
    await booking("Nikos", "2030-06-08", "2030-06-10", onar.id);
    await booking("Eleni", "2030-06-11", "2030-06-13");
    const { notifier, send } = fakeNotifier();

    expect(await runDailyReminder({ notifiers: [notifier], now: MORNING })).toEqual({ status: "sent" });
    const alert = send.mock.calls[0]![0] as { subject: string; body: string };
    expect(alert.subject).toBe(
      "Stay Ops: 1 κράτηση χωρίς διαμέρισμα · σήμερα έρχεται 1 επισκέπτης · αύριο έρχεται 1 επισκέπτης",
    );
    expect(alert.body).toContain("Φεύγουν σήμερα (1):\n• Onar: Nikos (3 άτομα)");
    expect(alert.body).toContain("Έρχονται σήμερα (1):\n• Onar: Maria (3 άτομα)");
    expect(alert.body).toContain("Έρχονται αύριο (1):\n• χωρίς διαμέρισμα: Eleni (3 άτομα)");

    // A retried run the same morning does not send it again.
    expect(await runDailyReminder({ notifiers: [notifier], now: MORNING })).toEqual({ status: "already_sent" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not record a failed or unconfigured delivery, so the next run tries again", async () => {
    await booking("Eleni", "2030-06-11", "2030-06-13");
    const failing = fakeNotifier(false);
    expect(await runDailyReminder({ notifiers: [failing.notifier], now: MORNING })).toEqual({ status: "failed" });
    expect(await runDailyReminder({ notifiers: [], now: MORNING })).toEqual({ status: "unconfigured" });
    expect((await loadReminderSetting()).lastSentOn).toBeNull();
  });

  it("stays quiet with nothing to say or when switched off, and a test always sends", async () => {
    const actor = await prisma.user.create({ data: { email: "a@example.com", passwordHash: "x" } });
    const { notifier, send } = fakeNotifier();
    expect(await runDailyReminder({ notifiers: [notifier], now: MORNING })).toEqual({ status: "nothing" });

    await booking("Eleni", "2030-06-11", "2030-06-13");
    await setReminderEnabled(false, actor.id);
    expect(await runDailyReminder({ notifiers: [notifier], now: MORNING })).toEqual({ status: "disabled" });
    expect(await prisma.auditEvent.count({ where: { entityId: "dailyReminder" } })).toBe(1);

    expect(await runDailyReminder({ notifiers: [notifier], now: MORNING, test: true })).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    // A test does not count as the day's message.
    expect((await loadReminderSetting()).lastSentOn).toBeNull();
  });

  it("sends a test line on a quiet day", async () => {
    const { notifier, send } = fakeNotifier();
    expect(await runDailyReminder({ notifiers: [notifier], now: MORNING, test: true })).toEqual({ status: "sent" });
    expect((send.mock.calls[0]![0] as { subject: string }).subject).toBe("Stay Ops: δοκιμαστικό μήνυμα");
  });
});

describe("reminder recipients", () => {
  it("uses REMINDER_EMAIL_TO when set, else the alert address", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const env = { RESEND_API_KEY: "k", ALERT_EMAIL_TO: "stelios@example.com", REMINDER_EMAIL_TO: "father@example.com" };
    await reminderNotifiersFromEnv(env)[0]!.send({ subject: "s", body: "b" });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body)).to).toEqual(["father@example.com"]);
    expect(reminderNotifiersFromEnv({ RESEND_API_KEY: "k", ALERT_EMAIL_TO: "stelios@example.com" })).toHaveLength(1);
    expect(reminderNotifiersFromEnv({})).toEqual([]);
  });
});

describe("GET /api/cron/daily-reminders auth", () => {
  it("refuses a call without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "daily-reminder-secret-0123456789");
    const { GET } = await import("../../../src/app/api/cron/daily-reminders/route");
    const res = await GET(new NextRequest("http://localhost/api/cron/daily-reminders"));
    expect(res.status).toBe(401);
  });
});
