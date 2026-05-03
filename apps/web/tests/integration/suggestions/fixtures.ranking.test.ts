import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { rankBookingSuggestions } from "@/modules/suggestions/engine";

process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops";

type FixtureInput = {
  booking: {
    id: string;
    checkinDate: string;
    checkoutDate: string;
  };
  rooms: Array<{ id: string; code: string }>;
  assignments: Array<{ roomId: string; startDate: string; endDate: string }>;
  blocks: Array<{ roomId: string; startDate: string; endDate: string }>;
};

type FixtureExpected = {
  data: Array<{
    roomId: string;
    score: number;
    reasonCodes: string[];
    breakdown: { availability: number; cleaningFit: number; tieBreaker: number };
  }>;
};

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/suggestions",
);

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function truncate(prisma: PrismaClient) {
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

describe("suggestion fixtures remain deterministic", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
  });

  for (const caseName of ["case-01", "case-02", "case-03", "case-04"] as const) {
    it(`matches expected output for ${caseName}`, async () => {
      const input = await readJson<FixtureInput>(path.join(fixturesDir, `${caseName}.json`));
      const expected = await readJson<FixtureExpected>(path.join(fixturesDir, `${caseName}.expected.json`));

      for (const room of input.rooms) {
        await prisma.room.create({
          data: { id: room.id, code: room.code },
        });
      }

      await prisma.booking.create({
        data: {
          id: input.booking.id,
          channel: Channel.direct,
          externalBookingId: `${caseName}-target`,
          status: BookingStatus.confirmed,
          checkinDate: new Date(`${input.booking.checkinDate}T00:00:00.000Z`),
          checkoutDate: new Date(`${input.booking.checkoutDate}T00:00:00.000Z`),
          nights: 2,
        },
      });

      for (let i = 0; i < input.assignments.length; i += 1) {
        const row = input.assignments[i]!;
        const b = await prisma.booking.create({
          data: {
            id: `${caseName}-a-booking-${i}`,
            channel: Channel.direct,
            externalBookingId: `${caseName}-a-${i}`,
            status: BookingStatus.confirmed,
            checkinDate: new Date(`${row.startDate}T00:00:00.000Z`),
            checkoutDate: new Date(`${row.endDate}T00:00:00.000Z`),
            nights: 2,
          },
        });
        await prisma.assignment.create({
          data: {
            bookingId: b.id,
            roomId: row.roomId,
            startDate: new Date(`${row.startDate}T00:00:00.000Z`),
            endDate: new Date(`${row.endDate}T00:00:00.000Z`),
          },
        });
      }

      for (const row of input.blocks) {
        await prisma.manualBlock.create({
          data: {
            roomId: row.roomId,
            startDate: new Date(`${row.startDate}T00:00:00.000Z`),
            endDate: new Date(`${row.endDate}T00:00:00.000Z`),
          },
        });
      }

      const actual = await rankBookingSuggestions(input.booking.id);
      expect(actual).toEqual(expected.data);
      for (const row of actual) {
        expect(row.breakdown.availability + row.breakdown.cleaningFit + row.breakdown.tieBreaker).toBe(row.score);
      }
    });
  }
});
