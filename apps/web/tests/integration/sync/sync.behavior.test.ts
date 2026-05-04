/**
 * Postgres + Redis (DB 2). Apply migrations: `pnpm --filter @stay-ops/db migrate:deploy`.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { Worker, Queue } from "bullmq";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { isDryRunRollback } from "@stay-ops/shared";
import {
  applyHosthubReservation,
  bullmqConnectionFromUrl,
  processSyncHosthubJob,
  SYNC_HOSTHUB_QUEUE_NAME,
  JOB_HOSTHUB_INBOUND,
} from "@stay-ops/sync";
import { handleHosthubWebhookPost } from "../../../src/modules/sync/hosthubWebhook";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops_test";
process.env.REDIS_URL ??= "redis://localhost:6379/2";

const prisma = new PrismaClient();

async function truncateSyncDomain() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
      "webhook_inbound_events",
      "import_errors",
      "sync_runs",
      "audit_events",
      "assignments",
      "cleaning_tasks",
      "manual_blocks",
      "bookings",
      "source_listings",
      "rooms"
    RESTART IDENTITY CASCADE;
  `);
}

const baseReservation = {
  reservationId: "sync-test-b1",
  listingId: "sync-test-l1",
  status: "confirmed" as const,
  checkIn: "2026-08-01",
  checkOut: "2026-08-05",
  listingChannel: "airbnb",
};

describe("sync pipeline — booking upsert and cancellation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncateSyncDomain();
  });

  it("applyHosthubReservation dryRun rolls back and leaves DB counts unchanged", async () => {
    const dto = { ...baseReservation, reservationId: "sync-dryrun-b1" };
    const raw = { ...dto };
    const before = {
      bookings: await prisma.booking.count(),
      listings: await prisma.sourceListing.count(),
      rooms: await prisma.room.count(),
      audits: await prisma.auditEvent.count(),
    };
    try {
      await applyHosthubReservation(prisma, dto, raw, undefined, { dryRun: true });
      expect.fail("expected DryRunRollback");
    } catch (e: unknown) {
      expect(isDryRunRollback(e)).toBe(true);
    }
    expect(await prisma.booking.count()).toBe(before.bookings);
    expect(await prisma.sourceListing.count()).toBe(before.listings);
    expect(await prisma.room.count()).toBe(before.rooms);
    expect(await prisma.auditEvent.count()).toBe(before.audits);
  });

  it("upserts once and maps cancellation to BookingStatus.cancelled", async () => {
    const raw = { ...baseReservation };
    await applyHosthubReservation(prisma, baseReservation, raw);
    await applyHosthubReservation(
      prisma,
      { ...baseReservation, status: "cancelled" },
      { ...raw, status: "cancelled" },
    );

    const rows = await prisma.booking.findMany({
      where: { externalBookingId: "sync-test-b1", channel: Channel.airbnb },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(BookingStatus.cancelled);
  });

  it("cancellation removes assignment and cancels pending cleaning tasks", async () => {
    const dto = { ...baseReservation, reservationId: "sync-cancel-cascade-1" };
    const raw = { ...dto };
    await applyHosthubReservation(prisma, dto, raw);

    const booking = await prisma.booking.findFirstOrThrow({
      where: { externalBookingId: "sync-cancel-cascade-1", channel: Channel.airbnb },
    });
    const room = await prisma.room.create({ data: { code: "cancel-cascade-R1" } });
    await prisma.assignment.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        startDate: booking.checkinDate,
        endDate: booking.checkoutDate,
      },
    });
    const task = await prisma.cleaningTask.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        status: "todo",
      },
    });

    await applyHosthubReservation(
      prisma,
      { ...dto, status: "cancelled" },
      { ...raw, status: "cancelled" },
    );

    const after = await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: { assignment: true },
    });
    expect(after.status).toBe(BookingStatus.cancelled);
    expect(after.assignment).toBeNull();

    const updatedTask = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe("cancelled");

    const audits = await prisma.auditEvent.findMany({
      where: {
        OR: [
          { entityId: task.id, action: "cleaning_task.cancelled_on_booking_cancel" },
          { action: "assignment.released_on_cancel" },
        ],
      },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });
});

describe("sync — revalidate assignment after date change", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncateSyncDomain();
  });

  it("keeps assignment while updating non-date fields", async () => {
    const resId = "reval-preserve-b1";
    const listId = "reval-preserve-l1";
    const raw1 = {
      reservationId: resId,
      listingId: listId,
      status: "confirmed" as const,
      checkIn: "2026-10-01",
      checkOut: "2026-10-05",
      listingChannel: "airbnb",
      guestTotal: 2,
      totalAmountCents: 50000,
    };
    await applyHosthubReservation(prisma, raw1, raw1);

    const booking = await prisma.booking.findFirstOrThrow({
      where: { externalBookingId: resId, channel: Channel.airbnb },
    });
    const room = await prisma.room.create({ data: { code: "reval-preserve-R1" } });
    const assignmentRow = await prisma.assignment.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        startDate: booking.checkinDate,
        endDate: booking.checkoutDate,
      },
    });

    const raw2 = {
      ...raw1,
      guestTotal: 4,
      totalAmountCents: 73000,
    };
    await applyHosthubReservation(prisma, raw2, raw2);

    const updated = await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: { assignment: true },
    });
    expect(updated.status).toBe(BookingStatus.confirmed);
    expect(updated.guestTotal).toBe(4);
    expect(updated.totalAmountCents).toBe(73000);
    expect(updated.assignment?.id).toBe(assignmentRow.id);
    expect(updated.assignment?.roomId).toBe(room.id);
  });

  it("marks needs_reassignment and removes assignment when stay dates drift", async () => {
    const resId = "reval-b1";
    const listId = "reval-l1";
    const raw1 = {
      reservationId: resId,
      listingId: listId,
      status: "confirmed" as const,
      checkIn: "2026-10-01",
      checkOut: "2026-10-05",
      listingChannel: "airbnb",
    };
    await applyHosthubReservation(prisma, raw1, raw1);

    const booking = await prisma.booking.findFirstOrThrow({
      where: { externalBookingId: resId, channel: Channel.airbnb },
    });
    const room = await prisma.room.create({ data: { code: "reval-R1" } });
    const assignmentRow = await prisma.assignment.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        startDate: booking.checkinDate,
        endDate: booking.checkoutDate,
      },
    });

    const raw2 = {
      ...raw1,
      checkIn: "2026-10-02",
      checkOut: "2026-10-06",
    };
    await applyHosthubReservation(prisma, raw2, raw2);

    const updated = await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: { assignment: true },
    });
    expect(updated.status).toBe(BookingStatus.needs_reassignment);
    expect(updated.assignment).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: {
        action: "assignment.cleared_on_sync_revalidation",
        entityId: assignmentRow.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe("assignment");
  });
});

describe("sync inbound job — malformed payload records import_errors", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncateSyncDomain();
  });

  it("persists ImportError and throws UnrecoverableError for invalid JSON", async () => {
    const job = {
      id: "job-1",
      name: JOB_HOSTHUB_INBOUND,
      data: { dedupeKey: "bad-json", rawBody: "{" },
    } as unknown as Job;

    await expect(processSyncHosthubJob(job)).rejects.toBeInstanceOf(UnrecoverableError);

    const runs = await prisma.syncRun.findMany({ where: { source: "hosthub_webhook" } });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const errs = await prisma.importError.findMany({
      where: { syncRunId: runs[0]!.id },
    });
    expect(errs.length).toBe(1);
    expect(errs[0]?.code).toBe("MISSING_REQUIRED_FIELD");
  });
});

describe("sync webhook + queue — idempotent dedupe", () => {
  /** `handleHosthubWebhookPost` skips signature when NODE_ENV is development and WEBHOOK_SECRET is unset (see hosthubWebhook.ts). Vitest defaults NODE_ENV=test, which otherwise returns 503 without a configured secret. */
  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WEBHOOK_SECRET", "");
    await prisma.$connect();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateSyncDomain();
    const connection = bullmqConnectionFromUrl(process.env.REDIS_URL!);
    const q = new Queue(SYNC_HOSTHUB_QUEUE_NAME, { connection });
    await q.obliterate({ force: true });
    await q.close();
  });

  it("duplicate POST with same event id does not double-book after worker processes once", async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL required");
    }
    const connection = bullmqConnectionFromUrl(redisUrl);

    const worker = new Worker(SYNC_HOSTHUB_QUEUE_NAME, processSyncHosthubJob, {
      connection,
      concurrency: 1,
    });

    const waitOneJob = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("worker timeout")), 15_000);
      worker.on("completed", () => {
        clearTimeout(t);
        resolve();
      });
      worker.on("failed", (_job, err) => {
        clearTimeout(t);
        reject(err);
      });
    });

    const body = JSON.stringify({
      id: "evt-dedupe-single",
      reservation: baseReservation,
    });

    const res1 = await handleHosthubWebhookPost(
      new Request("http://local.test/api/sync/hosthub/webhook", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res1.status).toBe(200);

    await waitOneJob;

    const res2 = await handleHosthubWebhookPost(
      new Request("http://local.test/api/sync/hosthub/webhook", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res2.status).toBe(200);

    const bookings = await prisma.booking.findMany({
      where: { externalBookingId: "sync-test-b1", channel: Channel.airbnb },
    });
    expect(bookings).toHaveLength(1);

    await worker.close();
  });

  it("two webhook deliveries with different event ids but same reservation stay one row", async () => {
    const connection = bullmqConnectionFromUrl(process.env.REDIS_URL!);

    const worker = new Worker(SYNC_HOSTHUB_QUEUE_NAME, processSyncHosthubJob, {
      connection,
      concurrency: 1,
    });

    let remaining = 2;
    const waitTwo = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("worker timeout")), 20_000);
      worker.on("completed", () => {
        remaining -= 1;
        if (remaining <= 0) {
          clearTimeout(t);
          resolve();
        }
      });
      worker.on("failed", (_job, err) => {
        clearTimeout(t);
        reject(err);
      });
    });

    const b1 = JSON.stringify({ id: "evt-multi-1", reservation: baseReservation });
    const b2 = JSON.stringify({ id: "evt-multi-2", reservation: baseReservation });

    expect(
      (
        await handleHosthubWebhookPost(
          new Request("http://local.test/api/sync/hosthub/webhook", {
            method: "POST",
            body: b1,
            headers: { "Content-Type": "application/json" },
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleHosthubWebhookPost(
          new Request("http://local.test/api/sync/hosthub/webhook", {
            method: "POST",
            body: b2,
            headers: { "Content-Type": "application/json" },
          }),
        )
      ).status,
    ).toBe(200);

    await waitTwo;

    const bookings = await prisma.booking.findMany({
      where: { externalBookingId: "sync-test-b1", channel: Channel.airbnb },
    });
    expect(bookings).toHaveLength(1);

    await worker.close();
  });

  it("flat calendar event webhook upserts by Hosthub event id", async () => {
    const connection = bullmqConnectionFromUrl(process.env.REDIS_URL!);

    const worker = new Worker(SYNC_HOSTHUB_QUEUE_NAME, processSyncHosthubJob, {
      connection,
      concurrency: 1,
    });

    const waitOneJob = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("worker timeout")), 15_000);
      worker.on("completed", () => {
        clearTimeout(t);
        resolve();
      });
      worker.on("failed", (_job, err) => {
        clearTimeout(t);
        reject(err);
      });
    });

    const body = JSON.stringify({
      id: "evt-cal-flat",
      type: "Booking",
      date_from: "2026-09-10",
      date_to: "2026-09-14",
      rental: { id: "sync-test-l-cal" },
      source: { name: "booking.com" },
    });

    const res = await handleHosthubWebhookPost(
      new Request("http://local.test/api/sync/hosthub/webhook", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);

    await waitOneJob;

    const bookings = await prisma.booking.findMany({
      where: { externalBookingId: "evt-cal-flat", channel: Channel.booking },
    });
    expect(bookings).toHaveLength(1);

    await worker.close();
  });
});
