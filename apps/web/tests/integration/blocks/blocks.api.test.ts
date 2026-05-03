/**
 * Manual maintenance blocks API (Phase 4.3).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient, BookingStatus, Channel } from "@stay-ops/db";
import { CookieJar } from "../cookieJar";

const email = "blocks-admin@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

async function truncateBlocksDomain(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
      "audit_events",
      "assignments",
      "cleaning_tasks",
      "manual_blocks",
      "bookings",
      "source_listings",
      "rooms",
      "users"
    RESTART IDENTITY CASCADE;
  `);
}

describe("api /api/blocks", () => {
  const prisma = new PrismaClient();
  let POST_LOGIN: (request: Request) => Promise<Response>;
  let POST_BLOCKS: (request: NextRequest) => Promise<Response>;
  let PATCH_BLOCK: (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  let DELETE_BLOCK: (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();

    POST_LOGIN = (await import("../../../src/app/api/auth/login/route.ts")).POST;
    POST_BLOCKS = (await import("../../../src/app/api/blocks/route.ts")).POST;
    const idRoute = await import("../../../src/app/api/blocks/[id]/route.ts");
    PATCH_BLOCK = idRoute.PATCH;
    DELETE_BLOCK = idRoute.DELETE;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateBlocksDomain(prisma);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email, passwordHash, isActive: true },
    });
  });

  async function loginJar(): Promise<CookieJar> {
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);
    return jar;
  }

  it("returns 401 without session", async () => {
    const res = await POST_BLOCKS(
      new NextRequest("http://localhost/api/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomId: "x",
          startDate: "2026-06-01",
          endDate: "2026-06-05",
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("creates, updates, and deletes a block", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "B1" } });

    const createRes = await POST_BLOCKS(
      new NextRequest("http://localhost/api/blocks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          roomId: room.id,
          startDate: "2026-06-01",
          endDate: "2026-06-05",
          reason: "hvac",
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string; reason: string } };
    expect(created.data.reason).toBe("hvac");

    const patchRes = await PATCH_BLOCK(
      new NextRequest("http://localhost/api/blocks/" + created.data.id, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ reason: "paint" }),
      }),
      { params: Promise.resolve({ id: created.data.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { data: { reason: string } };
    expect(patched.data.reason).toBe("paint");

    const delRes = await DELETE_BLOCK(
      new NextRequest("http://localhost/api/blocks/" + created.data.id, {
        method: "DELETE",
        headers: { cookie: jar.getCookieHeader() },
      }),
      { params: Promise.resolve({ id: created.data.id }) },
    );
    expect(delRes.status).toBe(204);

    const row = await prisma.manualBlock.findUnique({ where: { id: created.data.id } });
    expect(row).toBeNull();

    const audits = await prisma.auditEvent.findMany({
      where: { entityId: created.data.id, entityType: "manual_block" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits).toHaveLength(3);
    expect(audits[0]?.action).toBe("manual_block.create");
    expect(audits[0]?.beforeJson).toBeNull();
    expect((audits[0]?.afterJson as { reason?: string } | null)?.reason).toBe("hvac");
    expect(audits[1]?.action).toBe("manual_block.update");
    expect((audits[1]?.beforeJson as { reason?: string } | null)?.reason).toBe("hvac");
    expect((audits[1]?.afterJson as { reason?: string } | null)?.reason).toBe("paint");
    expect(audits[2]?.action).toBe("manual_block.delete");
    expect(audits[2]?.afterJson).toBeNull();
  });

  it("rejects create overlapping an assignment (CONFLICT_ASSIGNMENT)", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "Rov" } });
    const booking = await prisma.booking.create({
      data: {
        channel: Channel.direct,
        externalBookingId: "ext-1",
        status: BookingStatus.confirmed,
        checkinDate: new Date("2026-07-01T00:00:00.000Z"),
        checkoutDate: new Date("2026-07-05T00:00:00.000Z"),
        nights: 4,
      },
    });
    await prisma.assignment.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        startDate: booking.checkinDate,
        endDate: booking.checkoutDate,
      },
    });

    const res = await POST_BLOCKS(
      new NextRequest("http://localhost/api/blocks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          roomId: room.id,
          startDate: "2026-07-03",
          endDate: "2026-07-04",
        }),
      }),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("CONFLICT_ASSIGNMENT");
  });

  it("rejects create overlapping another block (CONFLICT_BLOCK)", async () => {
    const jar = await loginJar();
    const room = await prisma.room.create({ data: { code: "Rblk" } });
    await prisma.manualBlock.create({
      data: {
        roomId: room.id,
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-10T00:00:00.000Z"),
      },
    });

    const res = await POST_BLOCKS(
      new NextRequest("http://localhost/api/blocks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({
          roomId: room.id,
          startDate: "2026-08-05",
          endDate: "2026-08-06",
        }),
      }),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("CONFLICT_BLOCK");
  });
});
