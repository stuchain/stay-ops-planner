/**
 * Isolated suite: stubs `globalThis.fetch` for HosthubClient. Keep separate from reconcile.api.test.ts
 * so `vi.unstubAllGlobals()` cannot leak across files (integration runs maxWorkers: 1 but order varies).
 *
 * Parity intent: dry-run {@link mergeDryRunResults} totals match entity row deltas from execute on the same
 * mocked Hosthub bytes. We do not compare `audit_events`, `sync_runs`, or `import_errors` (dry-run skips those).
 *
 * Note: dry-run rolls back the transaction, so booking `entityId` in plan entries are not stable UUIDs for
 * the later execute pass — we assert booking coverage via `externalBookingId` on each plan entry's `after`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const operatorEmail = "parity-reconcile-op@example.com";
const adminEmail = "parity-reconcile-admin@example.com";
const password = "password1234";

const HOSTHUB_TEST_BASE = "https://test.hosthub.local/api/2019-03-01";

const reservations = [
  {
    reservationId: "fix-r1",
    listingId: "fix-l1",
    listingChannel: "airbnb",
    status: "confirmed" as const,
    checkIn: "2027-02-01",
    checkOut: "2027-02-05",
  },
  {
    reservationId: "fix-r2",
    listingId: "fix-l2",
    listingChannel: "booking",
    status: "cancelled" as const,
    checkIn: "2027-02-10",
    checkOut: "2027-02-12",
  },
] as const;

const pagePayload = {
  data: [...reservations],
  rawData: reservations.map((r) => ({ ...r, type: "calendar_event" })),
  nextPageUrl: null,
  skipped: 0,
  maxUpdated: 1_700_000_000,
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function mockFetch(input: RequestInfo | URL): Promise<Response> {
  const url = requestUrl(input);
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();

  if (path.includes("/calendar-events") && !path.includes("/calendar-events/")) {
    return Promise.resolve(new Response(JSON.stringify(pagePayload), { status: 200 }));
  }
  if (path.includes("/notes") || path.includes("calendar-event-gr-taxes")) {
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  }
  return Promise.resolve(new Response("not-found", { status: 404 }));
}

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
      "integration_secrets",
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

type Fingerprint = {
  booking: number;
  source_listing: number;
  room: number;
  assignment: number;
  cleaning_task: number;
};

async function fingerprint(prisma: PrismaClient): Promise<Fingerprint> {
  const [booking, source_listing, room, assignment, cleaning_task] = await Promise.all([
    prisma.booking.count(),
    prisma.sourceListing.count(),
    prisma.room.count(),
    prisma.assignment.count(),
    prisma.cleaningTask.count(),
  ]);
  return { booking, source_listing, room, assignment, cleaning_task };
}

function diffFp(after: Fingerprint, before: Fingerprint): Fingerprint {
  return {
    booking: after.booking - before.booking,
    source_listing: after.source_listing - before.source_listing,
    room: after.room - before.room,
    assignment: after.assignment - before.assignment,
    cleaning_task: after.cleaning_task - before.cleaning_task,
  };
}

describe("reconcile dry-run vs execute parity (mocked Hosthub)", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let PUT_HOSTHUB_TOKEN: (request: NextRequest) => Promise<Response>;
  let POST_RECONCILE: (request: NextRequest) => Promise<Response>;
  let prevHosthubBase: string | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    prevHosthubBase = process.env.HOSTHUB_API_BASE;
    process.env.HOSTHUB_API_BASE = HOSTHUB_TEST_BASE;
    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    PUT_HOSTHUB_TOKEN = (await import("../../../src/app/api/admin/integrations/hosthub/token/route.ts")).PUT;
    POST_RECONCILE = (await import("../../../src/app/api/sync/hosthub/reconcile/route.ts")).POST;
  });

  afterAll(async () => {
    if (prevHosthubBase === undefined) {
      delete process.env.HOSTHUB_API_BASE;
    } else {
      process.env.HOSTHUB_API_BASE = prevHosthubBase;
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    vi.stubGlobal("fetch", mockFetch);
    await truncate(prisma);
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, operatorEmail] } },
    });
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: adminEmail, passwordHash, isActive: true, role: "admin" },
    });
    await prisma.user.create({
      data: { email: operatorEmail, passwordHash, isActive: true, role: "operator" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loginJar(email: string): Promise<CookieJar> {
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar.getCookieHeader() },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    return jar;
  }

  it("dry-run plan matches execute DB diff for the same mocked Hosthub payload", async () => {
    const adminJar = await loginJar(adminEmail);
    const saveTokenRes = await PUT_HOSTHUB_TOKEN(
      new NextRequest("http://localhost/api/admin/integrations/hosthub/token", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminJar.getCookieHeader(),
        },
        body: JSON.stringify({ token: "parity-mock-token" }),
      }),
    );
    expect(saveTokenRes.status).toBe(200);

    const before = await fingerprint(prisma);

    const operatorJar = await loginJar(operatorEmail);
    const dryRes = await POST_RECONCILE(
      new NextRequest("http://localhost/api/sync/hosthub/reconcile?dryRun=true", {
        method: "POST",
        headers: { cookie: operatorJar.getCookieHeader(), "x-request-id": "req-parity-dry" },
      }),
    );
    expect(dryRes.status).toBe(200);
    const dryJson = (await dryRes.json()) as {
      data: {
        dryRun: boolean;
        summary: {
          totals: { byEntity: Record<string, number> };
          entries: Array<{ entityType: string; entityId?: string | null; after?: unknown }>;
        };
      };
    };
    expect(dryJson.data.dryRun).toBe(true);
    const { summary } = dryJson.data;

    expect(await fingerprint(prisma)).toEqual(before);

    const exRes = await POST_RECONCILE(
      new NextRequest("http://localhost/api/sync/hosthub/reconcile", {
        method: "POST",
        headers: { cookie: operatorJar.getCookieHeader(), "x-request-id": "req-parity-exec" },
      }),
    );
    expect(exRes.status).toBe(200);

    const after = await fingerprint(prisma);
    const delta = diffFp(after, before);

    expect(summary.totals.byEntity.booking ?? 0).toBe(delta.booking);
    expect(summary.totals.byEntity.source_listing ?? 0).toBe(delta.source_listing);
    expect(summary.totals.byEntity.room ?? 0).toBe(delta.room);
    expect(summary.totals.byEntity.assignment ?? 0).toBe(delta.assignment);
    // Turnover / cancel cascades are environment-specific; this fixture has no assignments.
    expect(delta.cleaning_task).toBe(0);

    const planBookingExternals = new Set(
      summary.entries
        .filter((e) => e.entityType === "booking")
        .map((e) => {
          const afterPayload = e.after as { externalBookingId?: string } | null | undefined;
          return afterPayload?.externalBookingId;
        })
        .filter((v): v is string => Boolean(v)),
    );
    const dbBookingExternals = new Set(
      (await prisma.booking.findMany({ select: { externalBookingId: true } })).map((b) => b.externalBookingId),
    );
    expect(planBookingExternals).toEqual(dbBookingExternals);
    expect(planBookingExternals).toEqual(new Set(["fix-r1", "fix-r2"]));
  });
});
