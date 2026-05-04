import Redis from "ioredis";
import { beforeEach } from "vitest";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";

// Force integration tests onto a dedicated test database.
// Do not let tests default to the primary local dev DB.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://stayops:stayops@localhost:5432/stayops_test";

// `apps/web/src/lib/prisma.ts` caches a global PrismaClient; reset it so DATABASE_URL changes
// from other test files (or prior runs) cannot leave routes pointed at the wrong database.
const prismaGlobal = globalThis as unknown as { prisma?: unknown };
delete prismaGlobal.prisma;

/** CI sets REDIS_URL; calendar month cache must not survive TRUNCATE across tests. */
async function deleteCalendarMonthCacheKeys(redisUrl: string): Promise<void> {
  const r = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  try {
    let cursor = "0";
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", "cal:month:v1:*", "COUNT", "200");
      cursor = next;
      if (keys.length > 0) {
        await r.del(...keys);
      }
    } while (cursor !== "0");
  } finally {
    await r.quit();
  }
}

beforeEach(async () => {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return;
  await deleteCalendarMonthCacheKeys(redisUrl);
});

