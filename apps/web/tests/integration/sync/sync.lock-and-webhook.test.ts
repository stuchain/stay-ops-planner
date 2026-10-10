/**
 * P0-7: sync lock that works through a connection pooler, and webhooks applied without Redis.
 */
import type { NextRequest } from "next/server";
import { NextRequest as NextRequestCtor } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Channel, PrismaClient } from "@stay-ops/db";
import type { HosthubSource } from "@/server/sync/hosthubSource";

/** Hosthub as seen by the cron route: one empty page, held open while `hold` is set. */
const hosthub = vi.hoisted(() => ({
  calls: 0,
  hold: null as Promise<void> | null,
}));

vi.mock("@/server/sync/hosthubSource", () => ({
  hosthubSource: (): HosthubSource => ({
    listCalendarEventsPage: async () => {
      hosthub.calls += 1;
      if (hosthub.hold) await hosthub.hold;
      return { ok: true, value: { data: [], rawData: [], nextPageUrl: null, skipped: 0 } };
    },
    listRentalCalendarEventsPage: async () => ({
      ok: true,
      value: { data: [], rawData: [], nextPageUrl: null, skipped: 0 },
    }),
    getCalendarEventNotes: async () => ({ ok: true, value: null }),
    getCalendarEventGrTaxes: async () => ({ ok: true, value: null }),
  }),
}));

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const CRON_SECRET = "0123456789abcdef0123456789abcdef";

const prisma = new PrismaClient();

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "sync_lock",
      "sync_state",
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

function cronRequest(): NextRequest {
  return new NextRequestCtor("http://localhost/api/cron/sync-hosthub", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("Hosthub sync lock", () => {
  let GET_CRON: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("APP_TIMEZONE", "Etc/UTC");
    vi.stubEnv("HOSTHUB_API_TOKEN", "dummy-token-lock-test");
    GET_CRON = (await import("../../../src/app/api/cron/sync-hosthub/route")).GET;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate();
    hosthub.calls = 0;
    hosthub.hold = null;
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("two overlapping syncs: one runs, the other gets 409", async () => {
    let finish: () => void = () => undefined;
    hosthub.hold = new Promise<void>((resolve) => (finish = resolve));

    const first = GET_CRON(cronRequest());
    await vi.waitFor(() => expect(hosthub.calls).toBe(1));
    const second = await GET_CRON(cronRequest());
    expect(second.status).toBe(409);

    finish();
    expect((await first).status).toBe(200);

    // Released: the next sync runs.
    hosthub.hold = null;
    expect((await GET_CRON(cronRequest())).status).toBe(200);
  });

  it("a lock left behind by a crashed sync is taken over after it expires", async () => {
    await prisma.$executeRaw`
      INSERT INTO sync_lock (name, locked_until, holder)
      VALUES ('hosthub_reconcile', now() - interval '1 minute', 'crashed-holder')
    `;
    expect((await GET_CRON(cronRequest())).status).toBe(200);
    expect(hosthub.calls).toBe(1);
  });

  it("a lock still held by a live sync blocks a new one", async () => {
    await prisma.$executeRaw`
      INSERT INTO sync_lock (name, locked_until, holder)
      VALUES ('hosthub_reconcile', now() + interval '4 minutes', 'live-holder')
    `;
    expect((await GET_CRON(cronRequest())).status).toBe(409);
    expect(hosthub.calls).toBe(0);
  });
});

describe("Hosthub webhook", () => {
  let handleHosthubWebhookPost: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WEBHOOK_SECRET", "");
    vi.stubEnv("HOSTHUB_API_TOKEN", "");
    handleHosthubWebhookPost = (await import("../../../src/modules/sync/hosthubWebhook"))
      .handleHosthubWebhookPost;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate();
  });

  function post(body: unknown): Promise<Response> {
    return handleHosthubWebhookPost(
      new Request("http://local.test/api/sync/hosthub/webhook", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const reservation = {
    reservationId: "webhook-noredis-b1",
    listingId: "webhook-noredis-l1",
    status: "confirmed",
    checkIn: "2026-08-01",
    checkOut: "2026-08-05",
    listingChannel: "airbnb",
    guestName: "First Name",
  };

  it("creates and then updates the booking in the request", async () => {
    const created = await post({ id: "evt-noredis-1", reservation });
    expect(created.status).toBe(200);
    const row = await prisma.booking.findFirstOrThrow({
      where: { externalBookingId: "webhook-noredis-b1", channel: Channel.airbnb },
    });
    expect(row.guestName).toBe("First Name");
    expect(await prisma.webhookInboundEvent.count()).toBe(1);

    const updated = await post({ id: "evt-noredis-2", reservation: { ...reservation, guestName: "Second Name" } });
    expect(updated.status).toBe(200);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.guestName).toBe("Second Name");
  });

  it("a later delivery of the same event with a newer updated time is applied", async () => {
    const event = { id: "evt-same", type: "Booking", updated: 1_000, reservation };
    expect((await post(event)).status).toBe(200);
    const cancelled = { ...event, updated: 2_000, reservation: { ...reservation, status: "cancelled" } };
    expect((await post(cancelled)).status).toBe(200);

    const row = await prisma.booking.findFirstOrThrow({ where: { externalBookingId: "webhook-noredis-b1" } });
    expect(row.status).toBe("cancelled");
    expect(await prisma.webhookInboundEvent.count()).toBe(2);
  });

  it("does not mark the event as seen when applying fails, so Hosthub retries", async () => {
    // Check-out on the check-in day cannot be stored, so applying it throws.
    const failed = await post({ id: "evt-noredis-fail", reservation: { ...reservation, checkOut: reservation.checkIn } });
    expect(failed.status).toBe(500);
    expect(await prisma.webhookInboundEvent.count()).toBe(0);

    const retried = await post({ id: "evt-noredis-fail", reservation });
    expect(retried.status).toBe(200);
    expect(await prisma.booking.count({ where: { externalBookingId: "webhook-noredis-b1" } })).toBe(1);
  });
});
