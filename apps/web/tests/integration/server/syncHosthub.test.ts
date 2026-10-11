/**
 * P1B-7: Hosthub sync against a real database, fed by the recorded fixtures instead of HTTP.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient, TURNOVER_TASK_TYPE } from "@stay-ops/db";
import { normalizeHosthubReservationPagePayload, parseUpdatedUnix } from "@stay-ops/sync";
import type { HosthubSource } from "@/server/sync/hosthubSource";
import { tryAcquireHosthubReconcileLock } from "@/server/sync/lock";
import { FULL_SYNC_EVERY_MS, SYNC_BATCH_SIZE, syncHosthub } from "@/server/useCases/syncHosthub";

const prisma = new PrismaClient();
const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/sync/fixtures/hosthub",
);

type Event = Record<string, unknown>;

function fixture(name: string): Event {
  return JSON.parse(readFileSync(path.join(fixtures, `${name}.json`), "utf-8")) as Event;
}

/** Hosthub as a list of events; pages of `pageSize`, filtered by `updated_gte` like the API. */
class FakeHosthub implements HosthubSource {
  events = new Map<string, Event>();
  pageSize = 100;
  calls = { list: [] as (number | null | undefined)[], notes: [] as string[], taxes: [] as string[] };

  put(...events: Event[]): this {
    for (const e of events) this.events.set(String(e.id), e);
    return this;
  }

  listCalendarEventsPage: HosthubSource["listCalendarEventsPage"] = async (args) => {
    const offset = args.nextPageUrl ? Number(args.nextPageUrl.split("=")[1]) : 0;
    if (!args.nextPageUrl) this.calls.list.push(args.updatedGte);
    const gte = args.nextPageUrl ? this.lastGte : args.updatedGte;
    this.lastGte = gte;
    const all = [...this.events.values()].filter((e) => gte == null || (parseUpdatedUnix(e) ?? 0) >= gte);
    const slice = all.slice(offset, offset + this.pageSize);
    const next =
      offset + this.pageSize < all.length
        ? `https://hosthub.test/calendar-events?offset=${offset + this.pageSize}`
        : null;
    const page = normalizeHosthubReservationPagePayload({ data: slice, navigation: { next } });
    if (!page) throw new Error("fixture page did not normalise");
    return { ok: true, value: page };
  };
  private lastGte: number | null | undefined;

  listRentalCalendarEventsPage: HosthubSource["listRentalCalendarEventsPage"] = async () => ({
    ok: true,
    value: { data: [], rawData: [], nextPageUrl: null, skipped: 0 },
  });

  getCalendarEventNotes: HosthubSource["getCalendarEventNotes"] = async (id) => {
    this.calls.notes.push(id);
    return { ok: true, value: fixture("notes-response") };
  };

  getCalendarEventGrTaxes: HosthubSource["getCalendarEventGrTaxes"] = async (id) => {
    this.calls.taxes.push(id);
    return { ok: true, value: fixture("gr-taxes-response") };
  };
}

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms",
      "source_listings", "import_errors", "sync_runs", "sync_state", "sync_lock"
    RESTART IDENTITY CASCADE;
  `);
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function bookingFor(eventId: string) {
  return prisma.booking.findFirstOrThrow({
    where: { externalBookingId: eventId.toLowerCase() },
    include: { assignment: true },
  });
}

/** Turns the fixture apartment on and places the booking for `eventId` in it, as a person would. */
async function place(eventId: string) {
  const booking = await bookingFor(eventId);
  const room = await prisma.room.update({
    where: { code: "rent-fake-1" },
    data: { isActive: true, displayName: "Onar" },
  });
  await prisma.assignment.create({
    data: { bookingId: booking.id, roomId: room.id, startDate: booking.checkinDate, endDate: booking.checkoutDate },
  });
  await prisma.cleaningTask.create({
    data: {
      bookingId: booking.id,
      roomId: room.id,
      taskType: TURNOVER_TASK_TYPE,
      status: "todo",
      sourceEventId: `turnover-${booking.id}`,
    },
  });
  return { booking, room };
}

beforeEach(truncate);
afterAll(async () => {
  await truncate();
  await prisma.$disconnect();
});

describe("syncHosthub", () => {
  it("replays every fixture: four bookings, the hold skipped, new rentals as switched-off apartments", async () => {
    const hosthub = new FakeHosthub().put(
      fixture("new-booking"),
      fixture("airbnb"),
      fixture("booking-com"),
      fixture("direct"),
      fixture("hold"),
    );
    const result = await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });

    expect(result).toMatchObject({ status: "completed", stats: { fetched: 5, created: 4, skipped: 1, errors: 0 } });
    const bookings = await prisma.booking.findMany({ orderBy: { externalBookingId: "asc" } });
    expect(bookings.map((b) => [b.externalBookingId, b.channel, b.status])).toEqual([
      ["evt-fake-0001", Channel.direct, BookingStatus.confirmed],
      ["evt-fake-0002", Channel.airbnb, BookingStatus.confirmed],
      ["evt-fake-0003", Channel.booking, BookingStatus.confirmed],
      ["evt-fake-0004", Channel.direct, BookingStatus.confirmed],
    ]);
    expect(bookings.every((b) => b.hosthubNotesRaw !== null && b.hosthubGrTaxesRaw !== null)).toBe(true);

    const rooms = await prisma.room.findMany({ orderBy: { code: "asc" } });
    expect(rooms.map((r) => [r.code, r.isActive])).toEqual([
      ["rent-fake-1", false],
      ["rent-fake-2", false],
      ["rent-fake-3", false],
      ["rent-fake-4", false],
    ]);

    const state = await prisma.syncState.findUniqueOrThrow({ where: { id: 1 } });
    const maxUpdated = Math.max(...[...hosthub.events.values()].map((e) => parseUpdatedUnix(e) ?? 0));
    expect(state.cursor).toBe(String(maxUpdated));
    expect(state.lastSuccessAt).not.toBeNull();
    const run = await prisma.syncRun.findUniqueOrThrow({
      where: { id: result.status === "completed" ? result.runId : "" },
    });
    expect(run).toMatchObject({ status: "completed", cursor: String(maxUpdated) });
  });

  it("is idempotent: a second run changes nothing and fetches no notes again", async () => {
    const hosthub = new FakeHosthub().put(fixture("new-booking"), fixture("airbnb"), fixture("booking-com"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    const before = await prisma.booking.findMany({ orderBy: { id: "asc" } });
    const audits = await prisma.auditEvent.count();
    hosthub.calls.notes.length = 0;

    const again = await syncHosthub({ source: hosthub, trigger: "manual", full: true, db: prisma });

    expect(again).toMatchObject({ status: "completed", stats: { created: 0, updated: 0, unchanged: 3 } });
    expect(hosthub.calls.notes).toEqual([]);
    const after = await prisma.booking.findMany({ orderBy: { id: "asc" } });
    expect(after.map((b) => [b.id, b.version, b.status, b.guestName])).toEqual(
      before.map((b) => [b.id, b.version, b.status, b.guestName]),
    );
    expect(await prisma.auditEvent.count()).toBe(audits);
  });

  it("fetches only events changed since the cursor on the next run", async () => {
    const hosthub = new FakeHosthub().put(fixture("new-booking"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    hosthub.put(fixture("date-change"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    expect(hosthub.calls.list).toEqual([undefined, parseUpdatedUnix(fixture("new-booking"))]);
  });

  it("keeps the apartment and moves its dates when the new dates still fit", async () => {
    const hosthub = new FakeHosthub().put(fixture("new-booking"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    const { booking } = await place("Evt-Fake-0001");

    hosthub.put(fixture("date-change"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });

    const moved = await bookingFor("Evt-Fake-0001");
    expect(moved.status).toBe(BookingStatus.confirmed);
    expect(moved.version).toBeGreaterThan(booking.version);
    expect(moved.assignment).toMatchObject({ startDate: day("2030-07-12"), endDate: day("2030-07-17") });
    const task = await prisma.cleaningTask.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(task.plannedStart?.toISOString().slice(0, 10)).toBe("2030-07-17");
  });

  it("takes the booking out of its apartment when the new dates clash", async () => {
    const hosthub = new FakeHosthub().put(fixture("new-booking"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    const { room } = await place("Evt-Fake-0001");
    const other = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "local-1",
        status: BookingStatus.confirmed,
        checkinDate: day("2030-07-15"),
        checkoutDate: day("2030-07-18"),
        nights: 3,
        guestName: "Other Guest",
      },
    });
    await prisma.assignment.create({
      data: { bookingId: other.id, roomId: room.id, startDate: other.checkinDate, endDate: other.checkoutDate },
    });

    hosthub.put(fixture("date-change"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });

    const moved = await bookingFor("Evt-Fake-0001");
    expect(moved.status).toBe(BookingStatus.needs_reassignment);
    expect(moved.assignment).toBeNull();
    expect(await prisma.assignment.count({ where: { bookingId: other.id } })).toBe(1);
  });

  it("releases the apartment and cancels pending cleaning on cancellation", async () => {
    const hosthub = new FakeHosthub().put(fixture("new-booking"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    const { booking } = await place("Evt-Fake-0001");

    hosthub.put(fixture("cancellation"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });

    const cancelled = await bookingFor("Evt-Fake-0001");
    expect(cancelled.status).toBe(BookingStatus.cancelled);
    expect(cancelled.assignment).toBeNull();
    const task = await prisma.cleaningTask.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(task.status).toBe("cancelled");
  });

  it("fetches everything again once a day, so a cancellation the cursor missed still lands", async () => {
    const hosthub = new FakeHosthub().put(fixture("new-booking"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    await place("Evt-Fake-0001");
    // Hosthub cancels it, but the cursor is already past that event's `updated`.
    hosthub.put(fixture("cancellation"));
    await prisma.syncState.update({ where: { id: 1 }, data: { cursor: "4102444800" } });

    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    expect((await bookingFor("Evt-Fake-0001")).status).toBe(BookingStatus.confirmed);

    await prisma.syncState.update({
      where: { id: 1 },
      data: { lastFullSyncAt: new Date(Date.now() - FULL_SYNC_EVERY_MS - 60_000) },
    });
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });

    expect(hosthub.calls.list).toEqual([undefined, 4102444800, undefined]);
    const cancelled = await bookingFor("Evt-Fake-0001");
    expect(cancelled.status).toBe(BookingStatus.cancelled);
    expect(cancelled.assignment).toBeNull();
  });

  it("keeps a local edit and leaves an existing apartment alone", async () => {
    const hosthub = new FakeHosthub().put(fixture("new-booking"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    const { booking, room } = await place("Evt-Fake-0001");
    await prisma.booking.update({
      where: { id: booking.id },
      data: { guestName: "Edited In App", localOverrides: { guestName: true } },
    });

    hosthub.put(fixture("date-change"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });

    expect((await bookingFor("Evt-Fake-0001")).guestName).toBe("Edited In App");
    expect(await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({
      displayName: "Onar",
      isActive: true,
    });
  });

  it("ignores a delivery older than what is stored", async () => {
    const hosthub = new FakeHosthub().put(fixture("date-change"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    hosthub.put(fixture("new-booking"));
    const result = await syncHosthub({ source: hosthub, trigger: "manual", full: true, db: prisma });
    expect(result).toMatchObject({ stats: { stale: 1 } });
    expect((await bookingFor("Evt-Fake-0001")).checkinDate).toEqual(day("2030-07-12"));
  });

  it("applies in batches across pages, and a bad event costs only itself", async () => {
    const hosthub = new FakeHosthub();
    hosthub.pageSize = 30;
    const base = fixture("new-booking");
    for (let i = 0; i < SYNC_BATCH_SIZE + 10; i++) {
      const from = new Date(Date.UTC(2031, 0, 1 + i * 3));
      const to = new Date(from.getTime() + 2 * 86_400_000);
      hosthub.put({
        ...base,
        id: `Evt-Bulk-${i}`,
        updated: 1790000000 + i,
        date_from: from.toISOString().slice(0, 10),
        date_to: (i === 7 ? from : to).toISOString().slice(0, 10),
      });
    }

    const result = await syncHosthub({ source: hosthub, trigger: "open", db: prisma });

    expect(result).toMatchObject({ status: "completed", stats: { created: SYNC_BATCH_SIZE + 9, errors: 1 } });
    expect(hosthub.calls.notes).toEqual([]);
    const errors = await prisma.importError.findMany();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "APPLY_ERROR" });
    const state = await prisma.syncState.findUniqueOrThrow({ where: { id: 1 } });
    expect(state.cursor).toBe(String(1790000000 + 7));
  });

  it("skips an open sync right after a good one, and any sync while another holds the lock", async () => {
    const hosthub = new FakeHosthub().put(fixture("new-booking"));
    await syncHosthub({ source: hosthub, trigger: "manual", db: prisma });
    expect(await syncHosthub({ source: hosthub, trigger: "open", db: prisma })).toEqual({
      status: "skipped",
      reason: "recent",
    });

    expect(await tryAcquireHosthubReconcileLock(prisma)).not.toBeNull();
    expect(await syncHosthub({ source: hosthub, trigger: "manual", db: prisma })).toEqual({
      status: "skipped",
      reason: "locked",
    });
  });

  it("records a Hosthub failure on the run and in sync_state", async () => {
    const hosthub = new FakeHosthub();
    hosthub.listCalendarEventsPage = async () =>
      ({
        ok: false,
        error: { code: "HOSTHUB_HTTP_ERROR", message: "boom", statusCode: 502, retryable: true },
      }) as never;
    await expect(syncHosthub({ source: hosthub, trigger: "manual", db: prisma })).rejects.toThrow(/boom/);
    expect(await prisma.syncRun.findFirstOrThrow()).toMatchObject({ status: "failed" });
    expect((await prisma.syncState.findUniqueOrThrow({ where: { id: 1 } })).lastError).toMatch(/boom/);
    expect(await prisma.importError.count({ where: { code: "SOURCE_CONFLICT" } })).toBe(1);
  });
});
