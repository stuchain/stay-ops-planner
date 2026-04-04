/**
 * Postgres + Redis (DB 2). Apply migrations: `pnpm --filter @stay-ops/db migrate:deploy`.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { Worker, Queue } from "bullmq";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import {
  applyHosthubReservation,
  bullmqConnectionFromUrl,
  processSyncHosthubJob,
  SYNC_HOSTHUB_QUEUE_NAME,
  JOB_HOSTHUB_INBOUND,
} from "@stay-ops/sync";
import { handleHosthubWebhookPost } from "../../../src/modules/sync/hosthubWebhook";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";
process.env.REDIS_URL ??= "redis://localhost:6379/2";

const prisma = new PrismaClient();

async function truncateSyncDomain() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
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
});
